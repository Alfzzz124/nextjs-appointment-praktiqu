/**
 * Auto-retry, exercised through the REAL service instead of a mock of it.
 *
 * This suite exists because of a near-miss. `tests/public-booking/transient-failure.test.ts`
 * mocks `createPublicAppointment` and throws `WpEndpointError` straight at the route, so
 * it never runs the service's own error wrapping. When `UpstreamWriteError` was
 * introduced it converted exactly those failures into a class that `isRetrySafeFailure`
 * did not recognise — auto-retry would have stopped working in production while every
 * route-level retry test stayed green, because none of them crossed the boundary where
 * the conversion happens.
 *
 * So these tests mock only the repositories, let the service wrap failures for real, and
 * assert on how many times the write was actually attempted. If the wrapping and the
 * retry gate ever disagree again, this is what fails.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/repositories/wp/doctors.repo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/repositories/wp/doctors.repo')>()),
  findDoctorById: vi.fn(),
}));
vi.mock('@/repositories/wp/services.repo', () => ({
  listServicesForDoctor: vi.fn(),
  findServiceById: vi.fn(),
}));
vi.mock('@/repositories/wp/patients.repo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/repositories/wp/patients.repo')>()),
  findPatientByEmail: vi.fn(),
}));
vi.mock('@/repositories/wp/patients.write', () => ({
  createPatient: vi.fn(),
  updatePatient: vi.fn(),
}));
vi.mock('@/repositories/wp/appointments.repo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/repositories/wp/appointments.repo')>()),
  findConflictingAppointments: vi.fn(),
}));
vi.mock('@/repositories/wp/appointments.write', () => ({
  createAppointment: vi.fn(),
  cancelAppointment: vi.fn(),
}));

import { POST } from '@/app/api/v1/public/appointments/route';
import { slotHoldService } from '@/services/booking/slot-hold.service';
import { WpEndpointError } from '@/lib/wp-endpoint';
import { findDoctorById } from '@/repositories/wp/doctors.repo';
import { listServicesForDoctor } from '@/repositories/wp/services.repo';
import { findPatientByEmail } from '@/repositories/wp/patients.repo';
import { createPatient, updatePatient } from '@/repositories/wp/patients.write';
import { findConflictingAppointments } from '@/repositories/wp/appointments.repo';
import { createAppointment } from '@/repositories/wp/appointments.write';
import { APPOINTMENT_STATUS as STATUS } from '@/repositories/wp/appointments.repo';

const DOCTOR = 34;
const SERVICE = 488;
const CLINIC = 4;
const PATIENT = 911;
const APPOINTMENT = 6001;

const BASE = {
  professionalId: DOCTOR,
  serviceId: SERVICE,
  date: '2026-09-20',
  startTime: '10:00',
  clientName: 'Rafiq Adha',
  clientEmail: 'rafiqadha2001@gmail.com',
  clientMobile: '08120001111',
};

/** WordPress core's bootstrap failure — proof the plugin never ran. */
function wpBootstrapDbFailure(): WpEndpointError {
  return new WpEndpointError(
    '/appointments failed 500: <h1>Error establishing a database connection</h1>',
    500,
  );
}

let ip = 0;
function makeHold(): string {
  const key = slotHoldService.buildKey(
    String(DOCTOR),
    String(SERVICE),
    BASE.date,
    BASE.startTime,
  );
  slotHoldService.create({
    professionalId: String(DOCTOR),
    serviceId: String(SERVICE),
    date: BASE.date,
    startTime: BASE.startTime,
    key,
  });
  return key;
}

function post(holdKey: string): Promise<Response> {
  ip += 1;
  return POST(
    new NextRequest('http://x/api/v1/public/appointments', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.1.0.${ip}` },
      body: JSON.stringify({ ...BASE, holdKey }),
    }),
  ) as unknown as Promise<Response>;
}

function primeReads() {
  vi.mocked(findDoctorById).mockResolvedValue({
    id: BigInt(DOCTOR),
    firstName: 'Dianda',
    lastName: 'Psikolog',
    displayName: 'dianda',
    status: 'ACTIVE',
  } as never);

  vi.mocked(listServicesForDoctor).mockResolvedValue([
    {
      mappingId: 19n,
      serviceId: BigInt(SERVICE),
      doctorId: BigInt(DOCTOR),
      clinicId: BigInt(CLINIC),
      name: 'konseling',
      type: 'KONSELING',
      charges: '425000',
      durationMinutes: 60,
      isPublic: true,
      isActive: true,
      telemedService: null,
      nameAlias: null,
    },
  ]);

  vi.mocked(findConflictingAppointments).mockResolvedValue([]);
  vi.mocked(findPatientByEmail).mockResolvedValue({ id: BigInt(PATIENT) } as never);
  vi.mocked(updatePatient).mockResolvedValue(undefined as never);
}

function bookedRow() {
  return {
    id: APPOINTMENT,
    status: STATUS.PENDING,
    clinicId: CLINIC,
    doctorId: DOCTOR,
    patientId: PATIENT,
    startDate: BASE.date,
    startTime: '10:00:00',
    timezone: 'Asia/Jakarta',
    serviceIds: [SERVICE],
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  primeReads();
});

describe('auto-retry survives the service’s own error wrapping', () => {
  it('still replays the appointment write after it is wrapped', async () => {
    let calls = 0;
    vi.mocked(createAppointment).mockImplementation(async () => {
      calls += 1;
      if (calls < 3) throw wpBootstrapDbFailure();
      return bookedRow();
    });

    const res = await post(makeHold());

    expect(res.status).toBe(201);
    expect(calls).toBe(3);
  });

  it('answers 503 upstream_write_failed once the retries are spent', async () => {
    let calls = 0;
    vi.mocked(createAppointment).mockImplementation(async () => {
      calls += 1;
      throw wpBootstrapDbFailure();
    });

    const res = await post(makeHold());
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.code).toBe('upstream_write_failed');
    expect(res.headers.get('Retry-After')).toBeTruthy();
    expect(calls).toBe(3);
  });

  it('never replays a write WordPress itself refused', async () => {
    let calls = 0;
    vi.mocked(createAppointment).mockImplementation(async () => {
      calls += 1;
      // WordPress answered 500 with its own body — it was alive, so it may have
      // written. One attempt only; a duplicate appointment is worse than a 503.
      throw new WpEndpointError('/appointments failed 500: save returned no id', 500);
    });

    const res = await post(makeHold());

    expect(res.status).toBe(503);
    expect(calls).toBe(1);
  });

  it('answers 409 upstream_write_rejected for a 4xx refusal, without Retry-After', async () => {
    vi.mocked(createAppointment).mockRejectedValue(
      new WpEndpointError('/appointments failed 422: unprocessable', 422),
    );

    const res = await post(makeHold());
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.code).toBe('upstream_write_rejected');
    expect(res.headers.get('Retry-After')).toBeNull();
  });

  it('replays a patient write that never reached WordPress', async () => {
    vi.mocked(findPatientByEmail).mockResolvedValue(null);
    let calls = 0;
    vi.mocked(createPatient).mockImplementation(async () => {
      calls += 1;
      if (calls < 2) throw new WpEndpointError('/patients unreachable: ECONNREFUSED', 0);
      return { id: PATIENT } as never;
    });
    vi.mocked(createAppointment).mockResolvedValue(bookedRow());

    const res = await post(makeHold());

    expect(res.status).toBe(201);
    expect(calls).toBe(2);
  });
});
