// tests/unit/public/public-slots.test.ts
//
// getPublicSlots (single date) — mirrors public-slots-range.test.ts, which covers the
// same past-slot rule for the range reader. See that file for the fuller happy-path
// coverage of the shared resolver; this one focuses on what is specific to the
// single-date reader and the past-slot filter it now shares with the range reader.
import { describe, it, expect, vi, beforeEach } from 'vitest';

// The mock list is wider than this test strictly uses. vi.mock replaces a module
// wholesale, so every name public-catalog.service.ts (and availability.service.ts and
// blocked-ranges.service.ts, which getPublicSlots reaches through generateSlots) pulls
// from these modules has to exist here or the import fails. Anything left unmocked
// reaches the real Prisma client.
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
  APPOINTMENT_STATUS: { CANCELLED: 0, BOOKED: 1, PENDING: 2, CHECK_OUT: 3, CHECK_IN: 4 },
  listAppointments: vi.fn(),
}));

import { getPublicSlots } from '@/services/public/public-catalog.service';
import { generateSlots } from '@/services/professional/availability.service';
import * as doctors from '@/repositories/wp/doctors.repo';
import * as services from '@/repositories/wp/services.repo';
import * as sessions from '@/repositories/wp/clinic-sessions.repo';
import * as offDays from '@/repositories/wp/off-days.repo';
import * as appts from '@/repositories/wp/appointments.repo';

const DOCTOR_ID = 7;
const SERVICE_ID = 3;
const CLINIC_ID = 1;

/** 2026-08-31 is a Monday. */
const MONDAY = '2026-08-31';

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

describe('getPublicSlots', () => {
  it('returns the bookable slots for the date', async () => {
    const slots = await getPublicSlots({
      professionalId: DOCTOR_ID,
      serviceId: SERVICE_ID,
      date: MONDAY,
      clinicId: CLINIC_ID,
      now: new Date('2026-08-31T00:00:00'),
    });
    expect(slots?.map((s) => s.startTime)).toEqual(['09:00:00', '10:00:00', '11:00:00']);
  });

  it('returns null for an inactive professional', async () => {
    (doctors.findDoctorById as any).mockResolvedValue({ id: 7n, status: 0 });
    const slots = await getPublicSlots({
      professionalId: DOCTOR_ID,
      serviceId: SERVICE_ID,
      date: MONDAY,
      now: new Date('2026-08-31T00:00:00'),
    });
    expect(slots).toBeNull();
  });

  it('returns null when the service is not offered publicly', async () => {
    (services.listServicesForDoctor as any).mockResolvedValue([]);
    const slots = await getPublicSlots({
      professionalId: DOCTOR_ID,
      serviceId: SERVICE_ID,
      date: MONDAY,
      now: new Date('2026-08-31T00:00:00'),
    });
    expect(slots).toBeNull();
  });
});

describe('getPublicSlots — slots already past', () => {
  /**
   * A patient is choosing a future appointment, so a slot whose start has gone by is
   * never a valid choice — the same rule `getPublicSlotsForRange` carries, applied here
   * so the two public readers cannot disagree. (The staff reader, `generateSlots`,
   * deliberately keeps past slots: a receptionist recording this morning's walk-in has
   * to be able to select one — pinned by the last test in this block.)
   */
  it('keeps the slots that are far enough ahead, and hides the rest', async () => {
    // 08:59 with a 60-minute notice: 09:00 is one minute away and 10:00 is
    // an hour and a minute, so only the two later slots survive.
    const slots = await getPublicSlots({
      professionalId: DOCTOR_ID,
      serviceId: SERVICE_ID,
      date: MONDAY,
      now: new Date('2026-08-31T08:59:00'),
    });
    expect(slots?.map((s) => s.startTime)).toEqual(['10:00:00', '11:00:00']);
  });

  it('hides a slot that starts sooner than the minimum notice allows', async () => {
    // 10:15 with a 60-minute notice: 11:00 is only 45 minutes off. Nothing is
    // bookable today, even though 11:00 has not started yet.
    const slots = await getPublicSlots({
      professionalId: DOCTOR_ID,
      serviceId: SERVICE_ID,
      date: MONDAY,
      now: new Date('2026-08-31T10:15:00'),
    });
    expect(slots?.map((s) => s.startTime)).toEqual([]);
  });

  it('keeps a slot sitting exactly on the notice boundary', async () => {
    // 10:00 + 60 minutes lands exactly on 11:00. The boundary stays bookable,
    // matching how a slot ending exactly when a block starts stays bookable.
    const slots = await getPublicSlots({
      professionalId: DOCTOR_ID,
      serviceId: SERVICE_ID,
      date: MONDAY,
      now: new Date('2026-08-31T10:00:00'),
    });
    expect(slots?.map((s) => s.startTime)).toEqual(['11:00:00']);
  });

  it('does not reach across midnight into the previous day', async () => {
    // A notice window measured in minutes-of-day alone would compare 23:30
    // against tomorrow's 09:00 and call it too soon. It is nine and a half
    // hours away.
    const slots = await getPublicSlots({
      professionalId: DOCTOR_ID,
      serviceId: SERVICE_ID,
      date: MONDAY,
      now: new Date('2026-08-30T23:30:00'),
    });
    expect(slots?.map((s) => s.startTime)).toEqual(['09:00:00', '10:00:00', '11:00:00']);
  });


  it('returns [] — not null — for a date wholly in the past: open, nothing left', async () => {
    const slots = await getPublicSlots({
      professionalId: DOCTOR_ID,
      serviceId: SERVICE_ID,
      date: MONDAY,
      now: new Date('2026-08-31T23:30:00'),
    });
    expect(slots).not.toBeNull();
    expect(slots).toEqual([]);
  });

  it('defaults to the current time when no now is given', async () => {
    // 2020-08-31 is also a Monday, so the session matches and the only thing that can
    // empty the day is the default clock being later than 2020.
    const slots = await getPublicSlots({
      professionalId: DOCTOR_ID,
      serviceId: SERVICE_ID,
      date: '2020-08-31',
    });
    expect(slots).toEqual([]);
  });

  it('does not change the authenticated staff reader, which still offers past slots', async () => {
    // generateSlots takes no `now` and applies no past-slot filter. Calling it directly
    // (rather than through getPublicSlots) pins that the guard added to the public
    // reader was not accidentally pushed down into the shared staff path.
    const slots = await generateSlots(DOCTOR_ID, MONDAY, SERVICE_ID, CLINIC_ID);
    expect(slots.map((s) => s.startTime)).toEqual(['09:00:00', '10:00:00', '11:00:00']);
  });
});
