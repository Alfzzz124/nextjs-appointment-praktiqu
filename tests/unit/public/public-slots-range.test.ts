// tests/unit/public/public-slots-range.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// The mock list is wider than this test strictly uses. vi.mock replaces a module
// wholesale, so every name public-catalog.service.ts (and availability.service.ts,
// which it imports for dayOfWeekFor) pulls from these modules has to exist here or
// the import fails. Anything left unmocked reaches the real Prisma client.
vi.mock('@/repositories/wp/doctors.repo', () => ({
  PROFESSIONAL_STATUS: { ACTIVE: 1 },
  findDoctorById: vi.fn(),
  listDoctors: vi.fn(),
}));
vi.mock('@/repositories/wp/clinics.repo', () => ({
  findClinicById: vi.fn(),
  listClinics: vi.fn(),
}));
vi.mock('@/repositories/wp/static-data.repo', () => ({
  STATIC_DATA_TYPE: {},
  listStaticData: vi.fn(),
}));
vi.mock('@/repositories/wp/services.repo', () => ({
  listServicesForDoctor: vi.fn(),
}));
vi.mock('@/repositories/wp/clinic-sessions.repo', () => ({
  DAYS_OF_WEEK: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'],
  listClinicSessions: vi.fn(),
  getWeeklyAvailability: vi.fn(),
  replaceWeeklySchedule: vi.fn(),
}));
vi.mock('@/repositories/wp/off-days.repo', () => ({
  OFF_DAY_MODULE: 'doctor',
  createOffDay: vi.fn(),
  deleteOffDay: vi.fn(),
  isOffOn: vi.fn(() => false),
  listDoctorOffDays: vi.fn(),
}));
vi.mock('@/repositories/wp/appointments.repo', () => ({
  ACTIVE_STATUSES: [1, 2, 4, 5],
  // Pulled in transitively by appointments.write.ts (imported off the chain through
  // public-booking.service.ts -> public-catalog.service.ts), not used by this test.
  APPOINTMENT_STATUS: { CANCELLED: 0, BOOKED: 1, PENDING: 2, CHECK_OUT: 3, CHECK_IN: 4 },
  listAppointments: vi.fn(),
}));

import {
  getPublicSlotsForRange,
  getPublicProfessionalSummary,
} from '@/services/public/public-catalog.service';
import * as doctors from '@/repositories/wp/doctors.repo';
import * as services from '@/repositories/wp/services.repo';
import * as sessions from '@/repositories/wp/clinic-sessions.repo';
import * as offDays from '@/repositories/wp/off-days.repo';
import * as appts from '@/repositories/wp/appointments.repo';

const DOCTOR_ID = 7;
const SERVICE_ID = 3;

/** 2026-08-31 is a Monday. */
const MONDAY = '2026-08-31';
const TUESDAY = '2026-09-01';

/**
 * Every call passes an explicit `now`. The reader hides slots that have already
 * started, so without one these dates would silently start emptying themselves the
 * moment the wall clock passed them.
 */
const MONDAY_MIDNIGHT = new Date('2026-08-31T00:00:00');

function happyPath() {
  (doctors.findDoctorById as any).mockResolvedValue({ id: 7n, status: 1 });
  (services.listServicesForDoctor as any).mockResolvedValue([
    { serviceId: 3n, clinicId: 1n, durationMinutes: 60, isActive: true, isPublic: true },
  ]);
  (sessions.listClinicSessions as any).mockResolvedValue([
    { day: 'mon', startTime: '09:00:00', endTime: '12:00:00', slotDurationMinutes: 30 },
  ]);
  (offDays.listDoctorOffDays as any).mockResolvedValue([]);
  (offDays.isOffOn as any).mockReturnValue(false);
  (appts.listAppointments as any).mockResolvedValue({ items: [] });
}

beforeEach(() => {
  vi.clearAllMocks();
  happyPath();
});

describe('getPublicSlotsForRange', () => {
  it('returns one entry per day in the range, inclusive', async () => {
    const days = await getPublicSlotsForRange({
      professionalId: DOCTOR_ID, serviceId: SERVICE_ID, from: MONDAY, to: TUESDAY,
      now: MONDAY_MIDNIGHT,
    });
    expect(days?.map((d) => d.date)).toEqual([MONDAY, TUESDAY]);
  });

  it('uses the service duration, not the window slot size', async () => {
    const days = await getPublicSlotsForRange({
      professionalId: DOCTOR_ID, serviceId: SERVICE_ID, from: MONDAY, to: MONDAY,
      now: MONDAY_MIDNIGHT,
    });
    expect(days?.[0].slots.map((s) => s.startTime)).toEqual([
      '09:00:00', '10:00:00', '11:00:00',
    ]);
  });

  it('leaves a day with no matching session empty', async () => {
    const days = await getPublicSlotsForRange({
      professionalId: DOCTOR_ID, serviceId: SERVICE_ID, from: MONDAY, to: TUESDAY,
      now: MONDAY_MIDNIGHT,
    });
    expect(days?.[1].slots).toEqual([]);
  });

  it('subtracts an existing appointment', async () => {
    (appts.listAppointments as any).mockResolvedValue({
      items: [{ startDate: MONDAY, startTime: '10:00:00', endTime: '11:00:00' }],
    });
    const days = await getPublicSlotsForRange({
      professionalId: DOCTOR_ID, serviceId: SERVICE_ID, from: MONDAY, to: MONDAY,
      now: MONDAY_MIDNIGHT,
    });
    expect(days?.[0].slots.map((s) => s.startTime)).toEqual(['09:00:00', '11:00:00']);
  });

  it('ignores an appointment on a different day in the range', async () => {
    (appts.listAppointments as any).mockResolvedValue({
      items: [{ startDate: TUESDAY, startTime: '10:00:00', endTime: '11:00:00' }],
    });
    const days = await getPublicSlotsForRange({
      professionalId: DOCTOR_ID, serviceId: SERVICE_ID, from: MONDAY, to: TUESDAY,
      now: MONDAY_MIDNIGHT,
    });
    expect(days?.[0].slots).toHaveLength(3);
  });

  it('empties a day covered by a full-day off day', async () => {
    (offDays.listDoctorOffDays as any).mockResolvedValue([{ timeSpecific: false }]);
    (offDays.isOffOn as any).mockReturnValue(true);
    const days = await getPublicSlotsForRange({
      professionalId: DOCTOR_ID, serviceId: SERVICE_ID, from: MONDAY, to: MONDAY,
      now: MONDAY_MIDNIGHT,
    });
    expect(days?.[0].slots).toEqual([]);
  });

  it('subtracts a time-specific off day', async () => {
    (offDays.listDoctorOffDays as any).mockResolvedValue([
      { timeSpecific: true, startTime: '10:00:00', endTime: '11:00:00' },
    ]);
    (offDays.isOffOn as any).mockReturnValue(true);
    const days = await getPublicSlotsForRange({
      professionalId: DOCTOR_ID, serviceId: SERVICE_ID, from: MONDAY, to: MONDAY,
      now: MONDAY_MIDNIGHT,
    });
    expect(days?.[0].slots.map((s) => s.startTime)).toEqual(['09:00:00', '11:00:00']);
  });

  it('returns null for an inactive professional', async () => {
    (doctors.findDoctorById as any).mockResolvedValue({ id: 7n, status: 0 });
    const days = await getPublicSlotsForRange({
      professionalId: DOCTOR_ID, serviceId: SERVICE_ID, from: MONDAY, to: MONDAY,
      now: MONDAY_MIDNIGHT,
    });
    expect(days).toBeNull();
  });

  it('returns null when the service is not offered publicly', async () => {
    (services.listServicesForDoctor as any).mockResolvedValue([]);
    const days = await getPublicSlotsForRange({
      professionalId: DOCTOR_ID, serviceId: SERVICE_ID, from: MONDAY, to: MONDAY,
      now: MONDAY_MIDNIGHT,
    });
    expect(days).toBeNull();
  });

  it('queries the repositories once for the whole range, not once per day', async () => {
    await getPublicSlotsForRange({
      professionalId: DOCTOR_ID, serviceId: SERVICE_ID, from: MONDAY, to: '2026-09-13',
      now: MONDAY_MIDNIGHT,
    });
    expect((appts.listAppointments as any).mock.calls).toHaveLength(1);
    expect((sessions.listClinicSessions as any).mock.calls).toHaveLength(1);
    expect((offDays.listDoctorOffDays as any).mock.calls).toHaveLength(1);
  });

  it('asks for public services only', async () => {
    await getPublicSlotsForRange({
      professionalId: DOCTOR_ID, serviceId: SERVICE_ID, from: MONDAY, to: MONDAY,
      now: MONDAY_MIDNIGHT,
    });
    expect((services.listServicesForDoctor as any).mock.calls[0][0]).toMatchObject({
      publicOnly: true,
    });
  });
});

describe('getPublicSlotsForRange — slots already past', () => {
  /**
   * A patient is choosing a future appointment, so a slot whose start has gone by is
   * never a valid choice. (The staff reader deliberately keeps them: a receptionist
   * recording this morning's walk-in has to be able to select one.)
   */
  it('hides the slots of today that have already started', async () => {
    const days = await getPublicSlotsForRange({
      professionalId: DOCTOR_ID, serviceId: SERVICE_ID, from: MONDAY, to: MONDAY,
      now: new Date('2026-08-31T10:15:00'),
    });
    expect(days?.[0].slots.map((s) => s.startTime)).toEqual(['11:00:00']);
  });

  it('treats a slot starting exactly now as past', async () => {
    const days = await getPublicSlotsForRange({
      professionalId: DOCTOR_ID, serviceId: SERVICE_ID, from: MONDAY, to: MONDAY,
      now: new Date('2026-08-31T10:00:00'),
    });
    expect(days?.[0].slots.map((s) => s.startTime)).toEqual(['11:00:00']);
  });

  it('keeps a slot that has not started yet', async () => {
    const days = await getPublicSlotsForRange({
      professionalId: DOCTOR_ID, serviceId: SERVICE_ID, from: MONDAY, to: MONDAY,
      now: new Date('2026-08-31T08:59:00'),
    });
    expect(days?.[0].slots.map((s) => s.startTime)).toEqual([
      '09:00:00', '10:00:00', '11:00:00',
    ]);
  });

  it('empties a day that is wholly in the past, without closing later days', async () => {
    (sessions.listClinicSessions as any).mockResolvedValue([
      { day: 'mon', startTime: '09:00:00', endTime: '12:00:00', slotDurationMinutes: 30 },
      { day: 'tue', startTime: '09:00:00', endTime: '12:00:00', slotDurationMinutes: 30 },
    ]);
    const days = await getPublicSlotsForRange({
      professionalId: DOCTOR_ID, serviceId: SERVICE_ID, from: MONDAY, to: TUESDAY,
      now: new Date('2026-09-01T07:00:00'),
    });
    expect(days?.[0].slots).toEqual([]);
    expect(days?.[1].slots).toHaveLength(3);
  });

  it('compares against local clinic time, not UTC', async () => {
    // 23:30 local on the Monday. Read as UTC on a server ahead of UTC this instant
    // belongs to the Tuesday, which would leave the whole Monday on offer.
    const days = await getPublicSlotsForRange({
      professionalId: DOCTOR_ID, serviceId: SERVICE_ID, from: MONDAY, to: MONDAY,
      now: new Date('2026-08-31T23:30:00'),
    });
    expect(days?.[0].slots).toEqual([]);
  });

  it('defaults to the current time when no now is given', async () => {
    // 2020-08-31 is also a Monday, so the session matches and the only thing that can
    // empty the day is the default clock being later than 2020.
    const days = await getPublicSlotsForRange({
      professionalId: DOCTOR_ID, serviceId: SERVICE_ID, from: '2020-08-31', to: '2020-08-31',
    });
    expect(days?.[0].slots).toEqual([]);
  });
});

describe('getPublicProfessionalSummary', () => {
  it('returns the display name of an active professional', async () => {
    (doctors.findDoctorById as any).mockResolvedValue({
      id: 7n, status: 1, displayName: 'Pamela',
    });
    expect(await getPublicProfessionalSummary(DOCTOR_ID)).toEqual({ id: 7, fullName: 'Pamela' });
  });

  it('returns null for an inactive professional', async () => {
    (doctors.findDoctorById as any).mockResolvedValue({
      id: 7n, status: 0, displayName: 'Pamela',
    });
    expect(await getPublicProfessionalSummary(DOCTOR_ID)).toBeNull();
  });

  it('returns null when the professional does not exist', async () => {
    (doctors.findDoctorById as any).mockResolvedValue(null);
    expect(await getPublicProfessionalSummary(DOCTOR_ID)).toBeNull();
  });
});
