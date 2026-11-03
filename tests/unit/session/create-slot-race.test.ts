/**
 * Booking staf yang kalah balapan slot di plugin.
 *
 * `createSession` mengecek bentrok sendiri (findConflictingAppointments), tapi cek itu dan
 * tulisannya dua request berbeda. Booking lain bisa masuk di antaranya, dan sejak plugin
 * mengecek ulang slotnya di bawah lock psikolog, plugin menjawab
 * 409 `praktiqu_schedule_conflict`. Jawaban itu harus sampai ke staf sebagai `slot_taken`
 * yang sudah ada, bukan sebagai kegagalan sistem.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { CLIENT_STATUS } from '@/repositories/wp/patients.repo';
import { PROFESSIONAL_STATUS } from '@/repositories/wp/doctors.repo';
import { WpEndpointError } from '@/lib/wp-endpoint';

// vi.hoisted: lihat catatan di tests/unit/session/reminder-hooks.test.ts.
const schedule = vi.hoisted(() => ({ syncSessionReminders: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/services/session/reminder-schedule', () => schedule);

const writes = vi.hoisted(() => ({
  setAppointmentStatus: vi.fn(),
  createAppointment: vi.fn(),
  cancelAppointment: vi.fn(),
}));
vi.mock('@/repositories/wp/appointments.write', () => writes);

const kcActor = vi.hoisted(() => ({ resolveKcActor: vi.fn() }));
vi.mock('@/services/billing/kc-actor', () => kcActor);

const log = vi.hoisted(() => ({
  logging: { audit: vi.fn(), warn: vi.fn(), error: vi.fn(), activity: vi.fn(), system: vi.fn() },
}));
vi.mock('@/lib/logging', () => log);

const patients = vi.hoisted(() => ({ findPatientById: vi.fn() }));
vi.mock('@/repositories/wp/patients.repo', async (orig) => {
  const actual = await (orig as () => Promise<Record<string, unknown>>)();
  return { ...actual, findPatientById: (...a: unknown[]) => patients.findPatientById(...a) };
});

const doctors = vi.hoisted(() => ({ findDoctorById: vi.fn() }));
vi.mock('@/repositories/wp/doctors.repo', async (orig) => {
  const actual = await (orig as () => Promise<Record<string, unknown>>)();
  return { ...actual, findDoctorById: (...a: unknown[]) => doctors.findDoctorById(...a) };
});

const services = vi.hoisted(() => ({ listServicesForDoctor: vi.fn() }));
vi.mock('@/repositories/wp/services.repo', () => services);

vi.mock('@/repositories/wp/off-days.repo', async (orig) => {
  const actual = await (orig as () => Promise<Record<string, unknown>>)();
  return {
    ...actual,
    listDoctorOffDays: vi.fn().mockResolvedValue([]),
    listClinicOffDays: vi.fn().mockResolvedValue([]),
  };
});

vi.mock('@/repositories/wp/appointments.repo', async (orig) => {
  const actual = await (orig as () => Promise<Record<string, unknown>>)();
  // Cek di BE lolos: booking lain baru masuk sesudahnya.
  return { ...actual, findConflictingAppointments: vi.fn().mockResolvedValue([]) };
});

const ACTOR = { id: 'wpu_1', role: 'SUPER_ADMIN', practiceId: null };
const INPUT = {
  clientId: 522,
  professionalId: 119,
  serviceId: 3,
  clinicId: 1,
  slotDate: '2026-09-10',
  startTime: '09:30:00',
};

beforeEach(() => {
  writes.createAppointment.mockReset();
  log.logging.audit.mockClear();
  kcActor.resolveKcActor.mockReset().mockResolvedValue({ actor: ACTOR, wpUserId: 1n, clinicId: 1n });
  patients.findPatientById.mockReset().mockResolvedValue({ id: 522n, status: CLIENT_STATUS.ACTIVE });
  doctors.findDoctorById.mockReset().mockResolvedValue({ id: 119n, status: PROFESSIONAL_STATUS.ACTIVE });
  services.listServicesForDoctor.mockReset().mockResolvedValue([
    {
      mappingId: 1n,
      serviceId: 3n,
      doctorId: 119n,
      clinicId: 1n,
      name: 'Konsultasi',
      type: null,
      charges: '100000',
      durationMinutes: 60,
      isPublic: true,
      isActive: true,
      telemedService: null,
      nameAlias: null,
    },
  ]);
});

describe('createSession saat plugin menolak slotnya', () => {
  it('menjawab slot_taken 409, sama seperti bentrok yang ketahuan di BE', async () => {
    writes.createAppointment.mockRejectedValueOnce(
      new WpEndpointError('/appointments failed 409: That slot is already booked.', 409, 'praktiqu_schedule_conflict'),
    );
    const { createSession } = await import('@/services/session/session.service');

    await expect(createSession({ actor: ACTOR as never, input: INPUT })).rejects.toMatchObject({
      name: 'SessionServiceError',
      code: 'slot_taken',
      status: 409,
    });
    // Tidak ada sesi yang dibuat, jadi tidak ada jejak audit "session.created".
    expect(log.logging.audit).not.toHaveBeenCalled();
  });

  it('membiarkan penolakan plugin yang lain tetap apa adanya', async () => {
    const other = new WpEndpointError('/appointments failed 503: The schedule is busy, try again.', 503, 'praktiqu_schedule_busy');
    writes.createAppointment.mockRejectedValueOnce(other);
    const { createSession } = await import('@/services/session/session.service');

    await expect(createSession({ actor: ACTOR as never, input: INPUT })).rejects.toBe(other);
  });
});
