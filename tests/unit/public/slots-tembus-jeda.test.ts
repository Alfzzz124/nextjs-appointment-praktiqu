// tests/unit/public/slots-tembus-jeda.test.ts
//
// Layanan yang lebih panjang dari satu sesi boleh menembus jeda — tapi hanya untuk
// psikolog yang menyalakan approval, karena di sana setiap janji tetap menunggu
// persetujuannya sebelum terkonfirmasi. Jalur staf (generateSlots, juga dipakai
// getPublicSlots) dan pembaca rentang publik harus sepakat.
//
// Tidak menyentuh database: blok jadwal dan switch approval di-mock, jadi berkas ini
// jalan tanpa MySQL.
import { describe, it, expect, vi, beforeEach } from 'vitest';

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
vi.mock('@/services/booking/blocked-ranges.service', () => ({
  collectBlockedRanges: vi.fn(),
}));
vi.mock('@/services/approval/settings', () => ({
  requiresApproval: vi.fn(),
  professionalsRequiringApproval: vi.fn(async () => new Set()),
  getApprovalSetting: vi.fn(),
  setApprovalSetting: vi.fn(),
}));

import { getPublicSlotsForRange } from '@/services/public/public-catalog.service';
import { generateSlots } from '@/services/professional/availability.service';
import { eachDate } from '@/services/booking/slot-math';
import * as doctors from '@/repositories/wp/doctors.repo';
import * as services from '@/repositories/wp/services.repo';
import * as sessions from '@/repositories/wp/clinic-sessions.repo';
import * as blockedRanges from '@/services/booking/blocked-ranges.service';
import * as approval from '@/services/approval/settings';

const DOCTOR_ID = 34;
const SERVICE_ID = 508;
const CLINIC_ID = 4;
/** 2026-08-31 is a Monday. */
const MONDAY = '2026-08-31';

beforeEach(() => {
  vi.clearAllMocks();
  (doctors.findDoctorById as any).mockResolvedValue({ id: 34n, status: 1 });
  (services.listServicesForDoctor as any).mockResolvedValue([
    { serviceId: 508n, clinicId: 4n, durationMinutes: 180, isActive: true, isPublic: true },
  ]);
  // Sesi 60′ dengan jeda 60′ di antaranya — bentuk jadwal Senin psikolog 34.
  (sessions.listClinicSessions as any).mockResolvedValue(
    ['09', '11', '13', '15'].map((h) => ({
      day: 'mon',
      startTime: `${h}:00:00`,
      endTime: `${String(Number(h) + 1).padStart(2, '0')}:00:00`,
      slotDurationMinutes: 60,
    })),
  );
  (blockedRanges.collectBlockedRanges as any).mockImplementation(
    async (o: { from: string; to: string }) => Object.fromEntries(eachDate(o.from, o.to).map((d) => [d, []])),
  );
});

describe('layanan panjang menembus jeda', () => {
  it('ditawarkan untuk psikolog yang menyalakan approval, tanpa lewat jam kerja terakhir', async () => {
    (approval.requiresApproval as any).mockResolvedValue(true);
    const slots = await generateSlots(DOCTOR_ID, MONDAY, SERVICE_ID, CLINIC_ID);
    expect(slots.map((s) => `${s.startTime}-${s.endTime}`)).toEqual([
      '09:00:00-12:00:00', '11:00:00-14:00:00', '13:00:00-16:00:00',
    ]);
    expect(approval.requiresApproval).toHaveBeenCalledWith(DOCTOR_ID);
  });

  it('tidak ditawarkan untuk psikolog yang approval-nya mati', async () => {
    (approval.requiresApproval as any).mockResolvedValue(false);
    expect(await generateSlots(DOCTOR_ID, MONDAY, SERVICE_ID, CLINIC_ID)).toEqual([]);
  });

  it('pembaca rentang publik memakai aturan yang sama', async () => {
    (approval.requiresApproval as any).mockResolvedValue(true);
    const days = await getPublicSlotsForRange({
      professionalId: DOCTOR_ID, serviceId: SERVICE_ID, from: MONDAY, to: MONDAY,
      now: new Date('2026-08-30T00:00:00'),
    });
    expect(days?.[0].slots.map((s) => s.startTime)).toEqual(['09:00:00', '11:00:00', '13:00:00']);

    (approval.requiresApproval as any).mockResolvedValue(false);
    const off = await getPublicSlotsForRange({
      professionalId: DOCTOR_ID, serviceId: SERVICE_ID, from: MONDAY, to: MONDAY,
      now: new Date('2026-08-30T00:00:00'),
    });
    expect(off?.[0].slots).toEqual([]);
  });
});
