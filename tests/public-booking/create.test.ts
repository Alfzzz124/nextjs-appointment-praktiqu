/**
 * createPublicAppointment — contract against KiviCare's tables.
 *
 * The previous version of this suite pinned the opposite contract: cuids, a
 * Professional → Doctor bridge, and "must never touch raw SQL". All three were
 * artefacts of the shadow tables. What survives is the underlying rule — a guest
 * booking must resolve real ids and never reach the database as NaN — restated for
 * `wp_users`, where the professional id IS the doctor id.
 *
 * Repositories are mocked: writes go out over the plugin's REST layer, which is not
 * reachable from a unit test. The repositories themselves have DB-backed coverage.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

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

import { slotHoldService } from '@/services/booking/slot-hold.service';
import { verifyAppointmentIdToken } from '@/lib/public/appointment-token';
import { WpEndpointError } from '@/lib/wp-endpoint';
import { findDoctorById } from '@/repositories/wp/doctors.repo';
import { listServicesForDoctor } from '@/repositories/wp/services.repo';
import { findPatientByEmail } from '@/repositories/wp/patients.repo';
import { createPatient, updatePatient } from '@/repositories/wp/patients.write';
import { findConflictingAppointments } from '@/repositories/wp/appointments.repo';
import { createAppointment } from '@/repositories/wp/appointments.write';
import { APPOINTMENT_STATUS } from '@/repositories/wp/appointments.repo';
import {
  createPublicAppointment,
  createPublicAppointmentSchema,
  EmailConflictError,
  HoldExpiredError,
  ProfessionalNotFoundError,
  ServiceNotFoundError,
  SlotConflictError,
} from '@/services/public/public-booking.service';

const DOCTOR = 29;
const SERVICE = 7;
const CLINIC = 3;
const PATIENT = 461;
const APPOINTMENT = 5150;

const INPUT = {
  professionalId: DOCTOR,
  serviceId: SERVICE,
  date: '2026-07-15',
  startTime: '10:00',
  clientName: 'Budi Test',
  clientEmail: 'budi@test.local',
  clientMobile: '08120001111',
  holdKey: '',
};

function makeHold() {
  const key = slotHoldService.buildKey(
    String(INPUT.professionalId),
    String(INPUT.serviceId),
    INPUT.date,
    INPUT.startTime,
  );
  slotHoldService.create({
    professionalId: String(INPUT.professionalId),
    serviceId: String(INPUT.serviceId),
    date: INPUT.date,
    startTime: INPUT.startTime,
    key,
  });
  return key;
}

function primeHappyPath() {
  vi.mocked(findDoctorById).mockResolvedValue({
    id: BigInt(DOCTOR),
    firstName: 'Dewi',
    lastName: 'Santoso',
    displayName: 'dewi',
    status: 'ACTIVE',
  } as never);

  vi.mocked(listServicesForDoctor).mockResolvedValue([
    {
      mappingId: 11n,
      serviceId: BigInt(SERVICE),
      doctorId: BigInt(DOCTOR),
      clinicId: BigInt(CLINIC),
      name: 'Konseling Individu',
      type: 'KONSELING',
      charges: '350000',
      durationMinutes: 60,
      isPublic: true,
      isActive: true,
      telemedService: null,
      nameAlias: null,
    },
  ]);

  vi.mocked(findConflictingAppointments).mockResolvedValue([]);
  vi.mocked(findPatientByEmail).mockResolvedValue(null);
  vi.mocked(createPatient).mockResolvedValue({
    id: PATIENT,
    email: INPUT.clientEmail,
    firstName: 'Budi',
    lastName: 'Test',
    contactNumber: INPUT.clientMobile,
    patientUniqueId: null,
  });
  vi.mocked(updatePatient).mockResolvedValue({
    id: PATIENT,
    email: INPUT.clientEmail,
    firstName: 'Budi',
    lastName: 'Test',
    contactNumber: INPUT.clientMobile,
    patientUniqueId: null,
  });
  vi.mocked(createAppointment).mockResolvedValue({
    id: APPOINTMENT,
    status: APPOINTMENT_STATUS.PENDING,
    clinicId: CLINIC,
    doctorId: DOCTOR,
    patientId: PATIENT,
    startDate: INPUT.date,
    startTime: '10:00:00',
    timezone: 'Asia/Jakarta',
    serviceIds: [SERVICE],
    notified: false,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  primeHappyPath();
});

describe('createPublicAppointment', () => {
  it('books into wp_kc_appointments with real WordPress ids', async () => {
    const holdKey = makeHold();

    const result = await createPublicAppointment({ ...INPUT, holdKey });

    expect(result.id).toBe(APPOINTMENT);
    expect(result.status).toBe('PENDING');
    expect(result.service).toBe('Konseling Individu');
    expect(result.professionalName).toBe('Dewi Santoso');
    expect(verifyAppointmentIdToken(result.token)).toBe(APPOINTMENT);

    const args = vi.mocked(createAppointment).mock.calls[0][0];
    expect(args.doctorId).toBe(DOCTOR);
    expect(args.patientId).toBe(PATIENT);
    // The clinic comes from the doctor↔service mapping, not from the doctor.
    expect(args.clinicId).toBe(CLINIC);
    expect(args.serviceIds).toEqual([SERVICE]);
    // 10:00 + 60min, with the seconds KiviCare's TIME columns expect.
    expect(args.startTime).toBe('10:00:00');
    expect(args.endTime).toBe('11:00:00');
    // Left at the default so KiviCare withholds the "booked" email until confirmed.
    expect(args.status).toBeUndefined();

    expect(slotHoldService.get(holdKey)).toBeNull();
  });

  it('only offers services the professional has marked public', async () => {
    const holdKey = makeHold();
    await createPublicAppointment({ ...INPUT, holdKey });

    expect(vi.mocked(listServicesForDoctor).mock.calls[0][0].publicOnly).toBe(true);
  });

  it('throws HoldExpiredError when the hold is missing', async () => {
    await expect(
      createPublicAppointment({ ...INPUT, holdKey: 'nonexistent-hold' }),
    ).rejects.toBeInstanceOf(HoldExpiredError);
    expect(createAppointment).not.toHaveBeenCalled();
  });

  it('throws ProfessionalNotFoundError for an unknown or inactive professional', async () => {
    vi.mocked(findDoctorById).mockResolvedValue(null);
    await expect(
      createPublicAppointment({ ...INPUT, holdKey: makeHold() }),
    ).rejects.toBeInstanceOf(ProfessionalNotFoundError);

    vi.mocked(findDoctorById).mockResolvedValue({
      id: BigInt(DOCTOR), firstName: 'X', lastName: 'Y', displayName: 'x', status: 'INACTIVE',
    } as never);
    await expect(
      createPublicAppointment({ ...INPUT, holdKey: makeHold() }),
    ).rejects.toBeInstanceOf(ProfessionalNotFoundError);
  });

  it('throws ServiceNotFoundError when the service is not one of theirs', async () => {
    vi.mocked(listServicesForDoctor).mockResolvedValue([]);
    await expect(
      createPublicAppointment({ ...INPUT, holdKey: makeHold() }),
    ).rejects.toBeInstanceOf(ServiceNotFoundError);
  });

  it('throws SlotConflictError and releases the hold when the slot is taken', async () => {
    vi.mocked(findConflictingAppointments).mockResolvedValue([{ id: 99n }] as never);
    const holdKey = makeHold();

    await expect(createPublicAppointment({ ...INPUT, holdKey })).rejects.toBeInstanceOf(
      SlotConflictError,
    );
    expect(createAppointment).not.toHaveBeenCalled();
    // Released, not kept: a stale hold would lock the guest out of every other time.
    expect(slotHoldService.get(holdKey)).toBeNull();
  });

  it('reuses a returning guest instead of creating a second patient', async () => {
    vi.mocked(findPatientByEmail).mockResolvedValue({
      id: BigInt(PATIENT),
      email: INPUT.clientEmail,
    } as never);

    await createPublicAppointment({ ...INPUT, holdKey: makeHold() });

    expect(createPatient).not.toHaveBeenCalled();
    // Still mapped to the clinic — that is what makes them visible to its staff.
    expect(updatePatient).toHaveBeenCalledWith(PATIENT, { clinicId: CLINIC });
    expect(vi.mocked(createAppointment).mock.calls[0][0].patientId).toBe(PATIENT);
  });

  it('reports a conflict when the email belongs to a non-patient account', async () => {
    // findPatientByEmail is role-filtered, so it misses a doctor's address and the
    // plugin answers 409. Booking against that account would be wrong.
    vi.mocked(findPatientByEmail).mockResolvedValue(null);
    vi.mocked(createPatient).mockRejectedValue(
      new WpEndpointError('That email is already registered.', 409),
    );

    await expect(
      createPublicAppointment({ ...INPUT, holdKey: makeHold() }),
    ).rejects.toBeInstanceOf(EmailConflictError);
  });

});

describe('createPublicAppointmentSchema', () => {
  it('rejects a malformed date rather than letting it reach SQL', () => {
    expect(
      createPublicAppointmentSchema.safeParse({ ...INPUT, date: '15-07-2026' }).success,
    ).toBe(false);
  });

  it('coerces the ids a form posts as strings', () => {
    const parsed = createPublicAppointmentSchema.parse({
      ...INPUT,
      professionalId: '29',
      serviceId: '7',
      holdKey: 'k',
    });
    expect(parsed.professionalId).toBe(29);
    expect(parsed.serviceId).toBe(7);
  });

  it('refuses a non-numeric id instead of coercing it to NaN', () => {
    // The 2026-07-13 crash: a cuid became NaN and reached raw wp_kc_* SQL.
    expect(
      createPublicAppointmentSchema.safeParse({ ...INPUT, professionalId: 'pro-cuid-1' }).success,
    ).toBe(false);
  });
});
