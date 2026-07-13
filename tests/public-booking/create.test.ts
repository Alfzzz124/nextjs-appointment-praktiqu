/**
 * createPublicAppointment — app-table (Prisma) contract.
 *
 * Regression for the 2026-07-13 finding: the old implementation ran
 * `parseInt(cuid)` → NaN → interpolated into raw wp_kc_* SQL and crashed with
 * "Unknown column 'NaN'". The public catalog serves Professional/Service cuids,
 * so the create path must resolve those via Prisma app tables (bridging
 * Professional → Doctor by userId, same as feature-002 getBookedRanges) and
 * must never touch $queryRawUnsafe.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/prisma', () => {
  const tx = {
    appointment: { findFirst: vi.fn(), create: vi.fn() },
    appointmentServiceMapping: { create: vi.fn() },
  };
  return {
    prisma: {
      $queryRawUnsafe: vi.fn(),
      $transaction: vi.fn(async (fn: any) => fn(tx)),
      professional: { findUnique: vi.fn() },
      professionalServiceAssignment: { findUnique: vi.fn() },
      doctor: { upsert: vi.fn() },
      user: { findUnique: vi.fn(), create: vi.fn() },
      patient: { upsert: vi.fn() },
      patientClinicMapping: { upsert: vi.fn() },
      appointment: { findUnique: vi.fn() },
      __tx: tx,
    },
  };
});

import { prisma } from '@/lib/prisma';
import { slotHoldService } from '@/services/booking/slot-hold.service';
import { verifyAppointmentToken } from '@/lib/public/appointment-token';
import {
  createPublicAppointment,
  HoldExpiredError,
  ProfessionalNotFoundError,
  ServiceNotFoundError,
  SlotConflictError,
} from '@/services/public/public-booking.service';

const p = prisma as any;
const tx = p.__tx;

const INPUT = {
  professionalId: 'pro-cuid-1',
  serviceId: 'svc-cuid-1',
  date: '2026-07-15',
  startTime: '10:00',
  clientName: 'Budi Test',
  clientEmail: 'budi@test.local',
  clientMobile: '08120001111',
  holdKey: '',
};

function makeHold() {
  const key = slotHoldService.buildKey(
    INPUT.professionalId,
    INPUT.serviceId,
    INPUT.date,
    INPUT.startTime,
  );
  slotHoldService.create({
    professionalId: INPUT.professionalId,
    serviceId: INPUT.serviceId,
    date: INPUT.date,
    startTime: INPUT.startTime,
    key,
  });
  return key;
}

function primeHappyPath() {
  p.professional.findUnique.mockResolvedValue({
    id: 'pro-cuid-1',
    userId: 'user-pro-1',
    fullName: 'Dewi Santoso',
    practiceId: 'clinic-cuid-1',
    status: 'ACTIVE',
  });
  p.professionalServiceAssignment.findUnique.mockResolvedValue({
    service: {
      id: 'svc-cuid-1',
      name: 'Konseling Individu',
      durationMinutes: 60,
      price: '350000',
      clinicId: 'clinic-cuid-1',
      status: 'ACTIVE',
      isPrivate: false,
    },
  });
  p.doctor.upsert.mockResolvedValue({ id: 'doc-cuid-1' });
  p.user.findUnique.mockResolvedValue(null); // no existing user (email or username)
  p.user.create.mockResolvedValue({ id: 'user-cli-1' });
  p.patient.upsert.mockResolvedValue({ id: 'pat-cuid-1' });
  p.patientClinicMapping.upsert.mockResolvedValue({});
  tx.appointment.findFirst.mockResolvedValue(null);
  tx.appointment.create.mockResolvedValue({ id: 'appt-cuid-1', status: 'PENDING' });
  tx.appointmentServiceMapping.create.mockResolvedValue({});
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('createPublicAppointment (app-table contract)', () => {
  it('creates a PENDING appointment via Prisma models and never uses raw SQL', async () => {
    primeHappyPath();
    const holdKey = makeHold();

    const result = await createPublicAppointment({ ...INPUT, holdKey });

    expect(p.$queryRawUnsafe).not.toHaveBeenCalled();
    expect(result.id).toBe('appt-cuid-1');
    expect(result.status).toBe('PENDING');
    expect(result.service).toBe('Konseling Individu');
    expect(result.professionalName).toBe('Dewi Santoso');
    expect(verifyAppointmentToken(result.token)).toBe('appt-cuid-1');

    // Appointment is written with bridged/resolved cuids, not parseInt(NaN).
    const createArgs = tx.appointment.create.mock.calls[0][0];
    expect(createArgs.data.doctorId).toBe('doc-cuid-1');
    expect(createArgs.data.patientId).toBe('pat-cuid-1');
    expect(createArgs.data.clinicId).toBe('clinic-cuid-1');
    expect(createArgs.data.status).toBe('PENDING');

    // Doctor bridge keyed by the professional's userId (feature-002 pattern).
    expect(p.doctor.upsert.mock.calls[0][0].where).toEqual({ userId: 'user-pro-1' });

    // Hold is consumed on success.
    expect(slotHoldService.get(holdKey)).toBeNull();
  });

  it('throws HoldExpiredError when the hold is missing', async () => {
    primeHappyPath();
    await expect(
      createPublicAppointment({ ...INPUT, holdKey: 'nonexistent-hold' }),
    ).rejects.toBeInstanceOf(HoldExpiredError);
    expect(tx.appointment.create).not.toHaveBeenCalled();
  });

  it('throws ProfessionalNotFoundError for an unknown or inactive professional', async () => {
    primeHappyPath();
    p.professional.findUnique.mockResolvedValue(null);
    const holdKey = makeHold();
    await expect(createPublicAppointment({ ...INPUT, holdKey })).rejects.toBeInstanceOf(
      ProfessionalNotFoundError,
    );

    p.professional.findUnique.mockResolvedValue({
      id: 'pro-cuid-1', userId: 'u', fullName: 'X', practiceId: 'c', status: 'INACTIVE',
    });
    const holdKey2 = makeHold();
    await expect(createPublicAppointment({ ...INPUT, holdKey: holdKey2 })).rejects.toBeInstanceOf(
      ProfessionalNotFoundError,
    );
  });

  it('throws ServiceNotFoundError when the service is not assigned to the professional', async () => {
    primeHappyPath();
    p.professionalServiceAssignment.findUnique.mockResolvedValue(null);
    const holdKey = makeHold();
    await expect(createPublicAppointment({ ...INPUT, holdKey })).rejects.toBeInstanceOf(
      ServiceNotFoundError,
    );
  });

  it('throws SlotConflictError and consumes the hold when the slot is taken', async () => {
    primeHappyPath();
    tx.appointment.findFirst.mockResolvedValue({ id: 'existing-appt' });
    const holdKey = makeHold();

    await expect(createPublicAppointment({ ...INPUT, holdKey })).rejects.toBeInstanceOf(
      SlotConflictError,
    );
    expect(tx.appointment.create).not.toHaveBeenCalled();
    expect(slotHoldService.get(holdKey)).toBeNull();
  });

  it('reuses an existing user by email instead of creating a duplicate', async () => {
    primeHappyPath();
    p.user.findUnique.mockImplementation(async ({ where }: any) =>
      where.email ? { id: 'user-existing' } : null,
    );
    const holdKey = makeHold();

    await createPublicAppointment({ ...INPUT, holdKey });

    expect(p.user.create).not.toHaveBeenCalled();
    expect(p.patient.upsert.mock.calls[0][0].where).toEqual({ userId: 'user-existing' });
  });
});
