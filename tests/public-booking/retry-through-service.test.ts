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
import { writeRereadConfig } from '@/services/public/public-booking.service';
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

/**
 * A date safely past the minimum booking lead time, computed rather than written down.
 * This used to be the literal '2026-09-20'; once that day passed, every booking in the
 * suite was refused as `booking_too_soon` before the retry logic under test ever ran.
 */
function daysFromNowInJakarta(days: number): string {
  const d = new Date(Date.now() + days * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(d);
}

const BASE = {
  professionalId: DOCTOR,
  serviceId: SERVICE,
  date: daysFromNowInJakarta(30),
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
  return slotHoldService.create({
    professionalId: String(DOCTOR),
    serviceId: String(SERVICE),
    date: BASE.date,
    startTime: BASE.startTime,
  }).key;
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
      category: null,
      durationOf: null,
      priceUsd: null,
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

/** Connection dropped after the request left: WordPress may or may not have written. */
function resetAfterSend(): WpEndpointError {
  return new WpEndpointError('/appointments unreachable: ECONNRESET', 0);
}

/** What the re-read sees when the plugin did insert before the connection died. */
function writtenRow(patientId = PATIENT) {
  return {
    id: BigInt(APPOINTMENT),
    clinicId: BigInt(CLINIC),
    doctorId: BigInt(DOCTOR),
    patientId: BigInt(patientId),
    startDate: BASE.date,
    startTime: '10:00:00',
    endDate: BASE.date,
    endTime: '11:00:00',
    status: STATUS.PENDING,
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  // The real wait is for WordPress to finish a write it may still be committing; the
  // mocks have nothing to wait for.
  writeRereadConfig.delayMs = 0;
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
      if (calls < 2) throw new WpEndpointError('/patients unreachable: ECONNREFUSED', 0, undefined, true);
      return { id: PATIENT } as never;
    });
    vi.mocked(createAppointment).mockResolvedValue(bookedRow());

    const res = await post(makeHold());

    expect(res.status).toBe(201);
    expect(calls).toBe(2);
  });
});

describe('an ambiguous appointment write is read back, not replayed', () => {
  it('returns the appointment when the connection dropped after the plugin wrote it', async () => {
    let calls = 0;
    vi.mocked(createAppointment).mockImplementation(async () => {
      calls += 1;
      throw resetAfterSend();
    });
    // First call is the pre-write clash check; the second is the read-back.
    vi.mocked(findConflictingAppointments)
      .mockResolvedValueOnce([])
      .mockResolvedValue([writtenRow()]);
    const key = makeHold();

    const res = await post(key);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(calls).toBe(1);
    expect(body.data.id).toBe(APPOINTMENT);
    expect(body.data.status).toBe('PENDING');
    expect(body.data.startTime).toBe('10:00');
  });

  it('also reads back after a 5xx WordPress itself answered', async () => {
    const calls = vi.mocked(createAppointment).mockRejectedValue(
      new WpEndpointError('/appointments failed 502: bad gateway', 502),
    );
    vi.mocked(findConflictingAppointments)
      .mockResolvedValueOnce([])
      .mockResolvedValue([writtenRow()]);

    const res = await post(makeHold());

    expect(res.status).toBe(201);
    expect(calls).toHaveBeenCalledTimes(1);
  });

  it('is not fooled by another patient’s booking in the same window', async () => {
    const calls = vi.mocked(createAppointment).mockRejectedValue(resetAfterSend());
    vi.mocked(findConflictingAppointments)
      .mockResolvedValueOnce([])
      .mockResolvedValue([writtenRow(PATIENT + 1)]);

    const res = await post(makeHold());

    expect(res.status).toBe(503);
    expect(calls).toHaveBeenCalledTimes(1);
  });

  it('does not replay, and answers upstream_write_failed, when nothing was written', async () => {
    const calls = vi.mocked(createAppointment).mockRejectedValue(resetAfterSend());
    // Pre-check and read-back both find an empty slot.
    vi.mocked(findConflictingAppointments).mockResolvedValue([]);

    const res = await post(makeHold());
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.code).toBe('upstream_write_failed');
    expect(calls).toHaveBeenCalledTimes(1);
  });

  it('falls back to the original failure when the read-back itself fails', async () => {
    const calls = vi.mocked(createAppointment).mockRejectedValue(resetAfterSend());
    vi.mocked(findConflictingAppointments)
      .mockResolvedValueOnce([])
      .mockRejectedValue(new Error('db down'));

    const res = await post(makeHold());

    expect(res.status).toBe(503);
    expect(calls).toHaveBeenCalledTimes(1);
  });

  it('still replays a connection refused, which provably never reached WordPress', async () => {
    let calls = 0;
    vi.mocked(createAppointment).mockImplementation(async () => {
      calls += 1;
      if (calls < 3) throw new WpEndpointError('/appointments unreachable: ECONNREFUSED', 0, undefined, true);
      return bookedRow();
    });

    const res = await post(makeHold());

    expect(res.status).toBe(201);
    expect(calls).toBe(3);
    // No read-back was needed: one pre-write clash check per attempt, nothing more.
    expect(findConflictingAppointments).toHaveBeenCalledTimes(3);
  });
});
