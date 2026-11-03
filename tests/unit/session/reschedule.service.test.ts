/**
 * rescheduleSession — staf memindah jadwal sesi di tempat (spec 2026-10-21).
 *
 * Yang dipaku: siapa yang boleh, sesi mana yang boleh, slot mana yang ditolak sebelum
 * menyentuh plugin, bagaimana penolakan plugin sampai ke staf, dan apa yang terjadi
 * sesudah pindah (pengingat dari baris baca ulang, dua email, audit). Repositori, plugin,
 * dan email dimock; `sessionStartsAtUtc` dan pembuat email tetap asli.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { SESSION_STATUS, type SessionRow } from '@/repositories/wp/sessions.repo';
import { WpEndpointError } from '@/lib/wp-endpoint';

const repo = vi.hoisted(() => ({ findSessionById: vi.fn() }));
vi.mock('@/repositories/wp/sessions.repo', async (orig) => {
  const actual = await (orig as () => Promise<Record<string, unknown>>)();
  return { ...actual, findSessionById: (...a: unknown[]) => repo.findSessionById(...a) };
});

const writes = vi.hoisted(() => ({
  rescheduleAppointment: vi.fn(),
  setAppointmentStatus: vi.fn(),
  createAppointment: vi.fn(),
  cancelAppointment: vi.fn(),
}));
vi.mock('@/repositories/wp/appointments.write', () => writes);

const conflicts = vi.hoisted(() => ({ findConflictingAppointments: vi.fn() }));
vi.mock('@/repositories/wp/appointments.repo', async (orig) => {
  const actual = await (orig as () => Promise<Record<string, unknown>>)();
  return { ...actual, findConflictingAppointments: (...a: unknown[]) => conflicts.findConflictingAppointments(...a) };
});

const offDays = vi.hoisted(() => ({ listDoctorOffDays: vi.fn(), listClinicOffDays: vi.fn() }));
vi.mock('@/repositories/wp/off-days.repo', async (orig) => {
  const actual = await (orig as () => Promise<Record<string, unknown>>)();
  return {
    ...actual,
    listDoctorOffDays: (...a: unknown[]) => offDays.listDoctorOffDays(...a),
    listClinicOffDays: (...a: unknown[]) => offDays.listClinicOffDays(...a),
  };
});

const kcActor = vi.hoisted(() => ({ resolveKcActor: vi.fn() }));
vi.mock('@/services/billing/kc-actor', () => kcActor);

const reminders = vi.hoisted(() => ({ syncSessionReminders: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/services/session/reminder-schedule', async (orig) => {
  const actual = await (orig as () => Promise<Record<string, unknown>>)();
  return { ...actual, syncSessionReminders: (...a: unknown[]) => reminders.syncSessionReminders(...a) };
});

// reread() melampirkan approval; di sini tidak ada.
vi.mock('@/services/approval/service', async (orig) => {
  const actual = await (orig as () => Promise<Record<string, unknown>>)();
  return {
    ...actual,
    withApprovals: async (rows: Array<Record<string, unknown>>) => rows.map((r) => ({ ...r, approval: null })),
  };
});

vi.mock('@/repositories/wp/services.repo', () => ({
  findServiceById: vi.fn().mockResolvedValue({ name: 'Konseling Individu' }),
  listServicesForDoctor: vi.fn(),
}));

const email = vi.hoisted(() => ({ sendEmail: vi.fn().mockResolvedValue({ ok: true }) }));
vi.mock('@/lib/email', () => email);

const log = vi.hoisted(() => ({
  logging: { audit: vi.fn(), warn: vi.fn(), error: vi.fn(), activity: vi.fn(), system: vi.fn() },
}));
vi.mock('@/lib/logging', () => log);

import { rescheduleSession } from '@/services/session/reschedule.service';

// Sekarang: Selasa 20 Okt 2026 08:00 WIB. Sesi: Rabu 21 Okt 09:00–10:00 WIB.
const NOW = new Date('2026-10-20T01:00:00.000Z');
const ADMIN = { id: 'wpu_24', role: 'CLINIC_ADMIN', practiceId: '3' };

function row(over: Partial<SessionRow> = {}): SessionRow {
  return {
    id: 812,
    clinicId: 3,
    professionalId: 34,
    clientId: 7,
    professionalName: 'Dianda Psikolog',
    clientName: 'Ada Lovelace',
    clientEmail: 'ada@contoh.test',
    professionalEmail: 'dianda@klinik.test',
    slotDate: '2026-10-21',
    startTime: '09:00:00',
    endTime: '10:00:00',
    timezone: 'Asia/Jakarta',
    status: SESSION_STATUS.BOOKED,
    serviceIds: [4],
    description: null,
    createdAt: new Date('2026-10-01T00:00:00Z'),
    ...over,
  };
}

const MOVED = row({ slotDate: '2026-10-22', startTime: '10:00:00', endTime: '11:00:00' });

function move(over: Partial<Parameters<typeof rescheduleSession>[0]> = {}) {
  return rescheduleSession({
    actor: ADMIN as never,
    sessionId: 812,
    slotDate: '2026-10-22',
    startTime: '10:00',
    reason: 'Psikolog berhalangan',
    now: NOW,
    ...over,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  kcActor.resolveKcActor.mockResolvedValue({ actor: ADMIN, wpUserId: 24n, clinicId: 3n });
  repo.findSessionById.mockResolvedValueOnce(row()).mockResolvedValue(MOVED);
  conflicts.findConflictingAppointments.mockResolvedValue([]);
  offDays.listDoctorOffDays.mockResolvedValue([]);
  offDays.listClinicOffDays.mockResolvedValue([]);
  writes.rescheduleAppointment.mockResolvedValue({
    id: 812,
    startDate: '2026-10-22',
    startTime: '10:00:00',
    endTime: '11:00:00',
    syncOk: true,
    meetingUrl: null,
  });
});

describe('rescheduleSession — siapa yang boleh', () => {
  it('menolak klien', async () => {
    kcActor.resolveKcActor.mockResolvedValue({ actor: { ...ADMIN, role: 'CLIENT' }, wpUserId: 7n, clinicId: null });
    await expect(move({ actor: { ...ADMIN, role: 'CLIENT' } as never })).rejects.toMatchObject({ code: 'forbidden', status: 403 });
    expect(writes.rescheduleAppointment).not.toHaveBeenCalled();
  });

  it('menolak psikolog untuk sesi orang lain, menerima untuk sesinya sendiri', async () => {
    const psikolog = { id: 'wpu_99', role: 'PROFESSIONAL', practiceId: null };
    kcActor.resolveKcActor.mockResolvedValue({ actor: psikolog, wpUserId: 99n, clinicId: null });
    await expect(move({ actor: psikolog as never })).rejects.toMatchObject({ code: 'forbidden', status: 403 });

    repo.findSessionById.mockReset().mockResolvedValueOnce(row()).mockResolvedValue(MOVED);
    kcActor.resolveKcActor.mockResolvedValue({ actor: { ...psikolog, id: 'wpu_34' }, wpUserId: 34n, clinicId: null });
    await expect(move({ actor: { ...psikolog, id: 'wpu_34' } as never })).resolves.toMatchObject({ id: 812 });
  });

  it('menerima resepsionis', async () => {
    const resepsionis = { id: 'wpu_50', role: 'RECEPTIONIST', practiceId: '3' };
    kcActor.resolveKcActor.mockResolvedValue({ actor: resepsionis, wpUserId: 50n, clinicId: 3n });
    await expect(move({ actor: resepsionis as never })).resolves.toMatchObject({ id: 812 });
  });
});

describe('rescheduleSession — sesi dan slot yang ditolak sebelum plugin', () => {
  it.each([
    ['CANCELLED', SESSION_STATUS.CANCELLED],
    ['CHECK_IN', SESSION_STATUS.CHECK_IN],
  ])('sesi %s tidak bisa dipindah', async (_label, status) => {
    repo.findSessionById.mockReset().mockResolvedValue(row({ status }));
    await expect(move()).rejects.toMatchObject({ code: 'not_reschedulable', status: 409 });
  });

  it('sesi yang sudah mulai tidak bisa dipindah', async () => {
    await expect(move({ now: new Date('2026-10-21T02:30:00.000Z') })).rejects.toMatchObject({
      code: 'session_already_started',
      status: 409,
    });
  });

  it('jam baru yang sudah lewat ditolak', async () => {
    await expect(move({ slotDate: '2026-10-19' })).rejects.toMatchObject({ code: 'slot_in_past', status: 422 });
  });

  it('slot yang sama ditolak', async () => {
    await expect(move({ slotDate: '2026-10-21', startTime: '09:00' })).rejects.toMatchObject({ code: 'same_slot', status: 400 });
  });

  it('hari libur psikolog ditolak dengan aturan yang sama dengan booking', async () => {
    offDays.listDoctorOffDays.mockResolvedValue([{ startDate: '2026-10-22', endDate: '2026-10-22', timeSpecific: false }]);
    await expect(move()).rejects.toMatchObject({ code: 'unavailable', status: 400 });
  });

  it('slot yang bentrok ditolak, dengan sesi ini sendiri dikecualikan', async () => {
    conflicts.findConflictingAppointments.mockResolvedValue([{ id: 900n }]);
    await expect(move()).rejects.toMatchObject({ code: 'slot_taken', status: 409 });
    expect(conflicts.findConflictingAppointments).toHaveBeenCalledWith({
      doctorId: 34n,
      date: '2026-10-22',
      startTime: '10:00:00',
      endTime: '11:00:00',
      excludeAppointmentId: 812n,
    });
    expect(writes.rescheduleAppointment).not.toHaveBeenCalled();
  });
});

describe('rescheduleSession — penolakan plugin', () => {
  it.each([
    ['praktiqu_schedule_conflict', 409, 'slot_taken', 409],
    ['praktiqu_schedule_stale', 409, 'session_changed', 409],
    ['praktiqu_schedule_terminal', 409, 'not_reschedulable', 409],
    ['praktiqu_schedule_unchanged', 400, 'same_slot', 400],
    ['praktiqu_schedule_unavailable', 422, 'slot_in_past', 422],
    ['praktiqu_schedule_busy', 503, 'schedule_busy', 503],
  ])('%s menjadi %s', async (pluginCode, pluginStatus, code, status) => {
    writes.rescheduleAppointment.mockRejectedValue(new WpEndpointError('x', pluginStatus, pluginCode));
    await expect(move()).rejects.toMatchObject({ code, status });
    expect(reminders.syncSessionReminders).not.toHaveBeenCalled();
    expect(email.sendEmail).not.toHaveBeenCalled();
  });

  it('penolakan lain diteruskan apa adanya', async () => {
    const other = new WpEndpointError('x', 500, 'praktiqu_schedule_db_error');
    writes.rescheduleAppointment.mockRejectedValue(other);
    await expect(move()).rejects.toBe(other);
  });
});

describe('rescheduleSession — sesudah pindah', () => {
  it('mengirim baris yang dibaca dan durasi lama ke plugin', async () => {
    await move();
    expect(writes.rescheduleAppointment).toHaveBeenCalledWith(812, {
      startDate: '2026-10-22',
      startTime: '10:00:00',
      expected: {
        doctorId: 34,
        clinicId: 3,
        status: 1,
        startDate: '2026-10-21',
        startTime: '09:00:00',
        endDate: '2026-10-21',
        endTime: '10:00:00',
      },
      actor: 'wpu_24',
      requestId: expect.any(String),
    });
  });

  it('menjadwal ulang pengingat dari baris hasil baca ulang', async () => {
    await move();
    expect(reminders.syncSessionReminders).toHaveBeenCalledTimes(1);
    expect(reminders.syncSessionReminders).toHaveBeenCalledWith(MOVED);
  });

  it('mengirim email ke klien dan psikolog', async () => {
    await move();
    const to = email.sendEmail.mock.calls.map(([m]) => [m.to, m.subject]);
    expect(to).toEqual([
      ['ada@contoh.test', 'Jadwal sesi Anda dipindah'],
      ['dianda@klinik.test', 'Jadwal sesi dipindah: Ada Lovelace'],
    ]);
    const body = email.sendEmail.mock.calls[0][0].text as string;
    expect(body).toContain('Jadwal lama: Rabu, 21 Oktober 2026, 09:00');
    expect(body).toContain('Jadwal baru: Kamis, 22 Oktober 2026, 10:00');
    expect(body).toContain('Alasan: Psikolog berhalangan');
  });

  it('email yang gagal tidak membatalkan pemindahan', async () => {
    email.sendEmail.mockRejectedValue(new Error('smtp down'));
    await expect(move()).resolves.toMatchObject({ id: 812, slotDate: '2026-10-22' });
    expect(log.logging.error).toHaveBeenCalled();
  });

  it('mencatat audit dari dan ke mana', async () => {
    await move();
    expect(log.logging.audit).toHaveBeenCalledWith(
      'session.rescheduled',
      expect.objectContaining({
        userId: 'wpu_24',
        resource: 'session',
        resourceId: '812',
        metadata: {
          from: { date: '2026-10-21', startTime: '09:00:00' },
          to: { date: '2026-10-22', startTime: '10:00:00' },
          reason: 'Psikolog berhalangan',
          syncOk: true,
        },
      }),
    );
  });

  it('mengembalikan sesi hasil baca ulang', async () => {
    await expect(move()).resolves.toMatchObject({ id: 812, slotDate: '2026-10-22', startTime: '10:00:00' });
  });
});
