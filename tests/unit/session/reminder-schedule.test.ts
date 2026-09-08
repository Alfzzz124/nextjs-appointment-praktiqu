/**
 * Penjadwalan pengingat, dengan `@/lib/jobs/client` dimock.
 *
 * Test paling penting di berkas ini adalah yang memaku **urutan kunci** `args`.
 * Action Scheduler mengeksekusi dengan `do_action_ref_array($hook, array_values($args))`,
 * jadi `array_values()` membuang kuncinya dan handler PHP menerimanya secara posisional.
 * Menukar urutannya tidak akan membuat apa pun gagal sampai produksi. Kelas bug yang
 * sama membuat SEMUA penjadwalan job gagal diam-diam dari Juli sampai 1 September 2026.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { SESSION_STATUS, type SessionRow } from '@/repositories/wp/sessions.repo';

// `vi.mock` factories are hoisted above all top-level `const`s, so the mock object must
// be created inside `vi.hoisted` to be visible from the factory (see tests/services/service-catalog.write.test.ts).
const jobsClient = vi.hoisted(() => ({ jobs: { enqueue: vi.fn(), cancel: vi.fn() } }));
vi.mock('@/lib/jobs/client', () => jobsClient);

import { syncSessionReminders, reminderArgs, sessionStartsAtUtc } from '@/services/session/reminder-schedule';

// Kamis, 10 September 2026, 09:30 Asia/Jakarta = 02:30 UTC.
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

const STARTS_AT = new Date('2026-09-10T02:30:00Z');
const JAUH_SEBELUM = new Date('2026-09-01T00:00:00Z');

beforeEach(() => {
  jobsClient.jobs.enqueue.mockReset();
  jobsClient.jobs.cancel.mockReset();
});

describe('reminderArgs — urutan kunci adalah kontraknya', () => {
  it('menaruh sessionId lebih dulu, lalu channel', () => {
    // array_values() di sisi PHP membuang kunci, jadi urutan inilah yang menentukan
    // argumen mana yang jadi $session_id dan mana yang jadi $channel.
    expect(Object.keys(reminderArgs(7, 'email_24h'))).toEqual(['sessionId', 'channel']);
    expect(Object.values(reminderArgs(7, 'email_24h'))).toEqual([7, 'email_24h']);
  });
});

describe('sessionStartsAtUtc', () => {
  it('menggabungkan tanggal, jam, dan zona waktu klinik menjadi UTC', () => {
    expect(sessionStartsAtUtc(row())?.toISOString()).toBe(STARTS_AT.toISOString());
  });

  it('mengembalikan null bila tanggal atau jamnya kosong', () => {
    expect(sessionStartsAtUtc(row({ slotDate: null }))).toBeNull();
    expect(sessionStartsAtUtc(row({ startTime: null }))).toBeNull();
  });
});

describe('syncSessionReminders — sesi BOOKED', () => {
  it('membatalkan lebih dulu supaya penjadwalan idempoten', async () => {
    await syncSessionReminders(row(), JAUH_SEBELUM);

    expect(jobsClient.jobs.cancel).toHaveBeenCalledTimes(2);
    const [first] = jobsClient.jobs.cancel.mock.invocationCallOrder;
    const [firstEnqueue] = jobsClient.jobs.enqueue.mock.invocationCallOrder;
    expect(first).toBeLessThan(firstEnqueue);
  });

  it('menjadwalkan dua job pada T-24 jam dan T-1 jam', async () => {
    await syncSessionReminders(row(), JAUH_SEBELUM);

    expect(jobsClient.jobs.enqueue).toHaveBeenCalledTimes(2);
    const calls = jobsClient.jobs.enqueue.mock.calls.map((c) => c[0]);

    expect(calls[0]).toEqual({
      hook: 'praktiqu_session_send_reminder',
      runAt: new Date(STARTS_AT.getTime() - 24 * 60 * 60_000),
      args: { sessionId: 7, channel: 'email_24h' },
    });
    expect(calls[1]).toEqual({
      hook: 'praktiqu_session_send_reminder',
      runAt: new Date(STARTS_AT.getTime() - 60 * 60_000),
      args: { sessionId: 7, channel: 'email_1h' },
    });
  });

  it('melewati pengingat yang waktunya sudah lewat', async () => {
    // 3 jam sebelum sesi: T-24 jam sudah lewat, T-1 jam belum.
    const now = new Date(STARTS_AT.getTime() - 3 * 60 * 60_000);

    await syncSessionReminders(row(), now);

    expect(jobsClient.jobs.enqueue).toHaveBeenCalledTimes(1);
    expect(jobsClient.jobs.enqueue.mock.calls[0][0].args.channel).toBe('email_1h');
  });

  it('tidak menjadwalkan apa pun untuk sesi yang kurang dari satu jam lagi', async () => {
    const now = new Date(STARTS_AT.getTime() - 30 * 60_000);

    await syncSessionReminders(row(), now);

    expect(jobsClient.jobs.enqueue).not.toHaveBeenCalled();
    // Pembatalan tetap jalan — kalau sesi digeser lebih awal, sisa job harus hilang.
    expect(jobsClient.jobs.cancel).toHaveBeenCalledTimes(2);
  });

  it('tidak menjadwalkan bila tanggal atau jamnya kosong', async () => {
    await syncSessionReminders(row({ startTime: null }), JAUH_SEBELUM);

    expect(jobsClient.jobs.enqueue).not.toHaveBeenCalled();
  });
});

describe('syncSessionReminders — sesi yang bukan BOOKED', () => {
  for (const status of [SESSION_STATUS.PENDING, SESSION_STATUS.CANCELLED, SESSION_STATUS.CHECK_IN, SESSION_STATUS.CHECK_OUT] as const) {
    it(`membatalkan dan tidak menjadwalkan apa pun untuk ${status}`, async () => {
      await syncSessionReminders(row({ status }), JAUH_SEBELUM);

      expect(jobsClient.jobs.enqueue).not.toHaveBeenCalled();
      expect(jobsClient.jobs.cancel).toHaveBeenCalledTimes(2);
    });
  }

  it('membatalkan dengan args yang sama persis dengan yang dipakai saat enqueue', async () => {
    await syncSessionReminders(row({ status: SESSION_STATUS.CANCELLED }), JAUH_SEBELUM);

    const args = jobsClient.jobs.cancel.mock.calls.map((c) => c[0].args);
    expect(args).toEqual([
      { sessionId: 7, channel: 'email_24h' },
      { sessionId: 7, channel: 'email_1h' },
    ]);
  });
});
