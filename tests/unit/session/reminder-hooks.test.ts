/**
 * Dua kail di session.service: setelah pembuatan, dan setelah transisi status.
 *
 * Yang dipaku di sini bukan logika penjadwalannya — itu sudah dipaku
 * tests/unit/session/reminder-schedule.test.ts — melainkan bahwa kailnya terpasang dan
 * bahwa yang diserahkan adalah baris **hasil baca ulang**. Kalau yang diserahkan baris
 * sebelum perubahan, statusnya masih PENDING dan persetujuan tidak akan pernah
 * menjadwalkan apa pun. Bug seperti itu tidak akan terlihat sampai produksi.
 *
 * `transitionSession` memanggil, berurutan: resolveKcActor, findSessionById (lewat
 * loadForActor), setAppointmentStatus, logging.audit, lalu findSessionById lagi untuk
 * baca ulang. Kelimanya dimock, jadi test ini jalan tanpa database.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { SESSION_STATUS, type SessionRow } from '@/repositories/wp/sessions.repo';

// `vi.mock` factories are hoisted above all top-level `const`s, so each mock's holder
// object must be created inside `vi.hoisted` to be visible from the factory (see
// tests/unit/session/reminder-handler.test.ts:14-16). This file statically imports
// `SESSION_STATUS` from `@/repositories/wp/sessions.repo`, which resolves that module
// during the file's synchronous top-level evaluation — before a plain `const` would
// initialise — so a bare object literal here would be undefined inside the factory.
const schedule = vi.hoisted(() => ({ syncSessionReminders: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/services/session/reminder-schedule', () => schedule);

const repo = vi.hoisted(() => ({ findSessionById: vi.fn() }));
vi.mock('@/repositories/wp/sessions.repo', async (orig) => {
  const actual = await (orig as () => Promise<Record<string, unknown>>)();
  return { ...actual, findSessionById: (...a: unknown[]) => repo.findSessionById(...a) };
});

const writes = vi.hoisted(() => ({
  setAppointmentStatus: vi.fn().mockResolvedValue(undefined),
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

function row(over: Partial<SessionRow> = {}): SessionRow {
  return {
    id: 7,
    clinicId: 1,
    professionalId: 119,
    clientId: 522,
    professionalName: 'Pamela Dewi',
    clientName: 'Ada Lovelace',
    clientEmail: 'ada@contoh.test',
    professionalEmail: 'pamela@klinik.test',
    slotDate: '2026-09-10',
    startTime: '09:30',
    endTime: '10:30',
    timezone: 'Asia/Jakarta',
    status: SESSION_STATUS.BOOKED,
    serviceIds: [3],
    description: null,
    createdAt: new Date('2026-09-01T00:00:00Z'),
    ...over,
  };
}

// SUPER_ADMIN lolos assertCanRead tanpa pemeriksaan cakupan, dan lolos gerbang
// "Not authorized to approve" — jadi test ini menguji kailnya, bukan RBAC-nya.
const ACTOR = { id: 'wpu_1', role: 'SUPER_ADMIN', practiceId: null };

beforeEach(() => {
  schedule.syncSessionReminders.mockClear();
  repo.findSessionById.mockReset();
  writes.setAppointmentStatus.mockClear();
  kcActor.resolveKcActor.mockReset().mockResolvedValue({ actor: ACTOR, wpUserId: 1n, clinicId: 1n });
});

describe('kail di transitionSession', () => {
  it('menyerahkan baris hasil baca ulang, bukan baris sebelum perubahan', async () => {
    const sebelum = row({ status: SESSION_STATUS.PENDING });
    const sesudah = row({ status: SESSION_STATUS.BOOKED });
    repo.findSessionById
      .mockResolvedValueOnce(sebelum) // loadForActor
      .mockResolvedValueOnce(sesudah); // baca ulang setelah tulis

    const { transitionSession } = await import('@/services/session/session.service');
    await transitionSession({ actor: ACTOR as never, sessionId: 7, target: SESSION_STATUS.BOOKED });

    expect(schedule.syncSessionReminders).toHaveBeenCalledTimes(1);
    expect(schedule.syncSessionReminders).toHaveBeenCalledWith(sesudah);
  });

  it('memanggil kail juga saat sesi dibatalkan, supaya job sisanya dibuang', async () => {
    const sebelum = row({ status: SESSION_STATUS.BOOKED });
    const sesudah = row({ status: SESSION_STATUS.CANCELLED });
    repo.findSessionById.mockResolvedValueOnce(sebelum).mockResolvedValueOnce(sesudah);

    const { transitionSession } = await import('@/services/session/session.service');
    await transitionSession({ actor: ACTOR as never, sessionId: 7, target: SESSION_STATUS.CANCELLED });

    expect(schedule.syncSessionReminders).toHaveBeenCalledWith(sesudah);
  });

  it('tidak memanggil kail saat transisinya ditolak', async () => {
    // CANCELLED tidak punya transisi keluar — VALID_TRANSITIONS.CANCELLED kosong.
    repo.findSessionById.mockResolvedValueOnce(row({ status: SESSION_STATUS.CANCELLED }));

    const { transitionSession } = await import('@/services/session/session.service');
    await expect(
      transitionSession({ actor: ACTOR as never, sessionId: 7, target: SESSION_STATUS.BOOKED }),
    ).rejects.toThrow(/Cannot transition/);

    expect(schedule.syncSessionReminders).not.toHaveBeenCalled();
  });
});
