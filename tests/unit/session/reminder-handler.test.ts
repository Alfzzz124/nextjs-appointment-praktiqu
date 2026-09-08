/**
 * Handler webhook pengingat sesi.
 *
 * Handler ini berjalan sebagai job latar: tidak ada manusia yang menunggu jawabannya,
 * jadi ia tidak boleh melempar. Setiap penolakan dicatat lalu selesai dengan tenang.
 *
 * Guard-nya bukan hiasan: pembatalan job di sisi WordPress adalah best-effort (komentar
 * plugin-nya sendiri mengakui itu), dan WP-Cron menyala telat. Jadi handler harus
 * menganggap sesi bisa saja sudah dibatalkan atau sudah lewat saat webhook tiba.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { SESSION_STATUS, type SessionRow } from '@/repositories/wp/sessions.repo';

// `vi.mock` factories are hoisted above all top-level `const`s, so each mock's holder
// object must be created inside `vi.hoisted` to be visible from the factory (see
// tests/services/service-catalog.write.test.ts and tests/unit/session/reminder-schedule.test.ts).
const repo = vi.hoisted(() => ({ findSessionById: vi.fn() }));
vi.mock('@/repositories/wp/sessions.repo', async (orig) => {
  const actual = await (orig as () => Promise<Record<string, unknown>>)();
  return { ...actual, findSessionById: (...a: unknown[]) => repo.findSessionById(...a) };
});

const email = vi.hoisted(() => ({ sendEmail: vi.fn() }));
vi.mock('@/lib/email', () => email);

const log = vi.hoisted(() => ({
  logging: { audit: vi.fn(), warn: vi.fn(), error: vi.fn(), activity: vi.fn(), system: vi.fn() },
}));
vi.mock('@/lib/logging', () => log);

vi.mock('@/lib/jobs/webhook-handler', () => ({ registerJobHandler: vi.fn() }));

import { handleSessionReminder } from '@/services/session/reminder-handler';

const STARTS_AT = new Date('2026-09-10T02:30:00Z');
const SEBELUM = new Date('2026-09-09T00:00:00Z');

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

beforeEach(() => {
  repo.findSessionById.mockReset();
  email.sendEmail.mockReset().mockResolvedValue({ ok: true, messageId: 'm1' });
  log.logging.audit.mockReset();
  log.logging.warn.mockReset();
});

describe('handleSessionReminder — jalur normal', () => {
  it('mengirim ke klien dan profesional', async () => {
    repo.findSessionById.mockResolvedValue(row());

    await handleSessionReminder({ sessionId: 7, channel: 'email_24h' }, SEBELUM);

    expect(email.sendEmail).toHaveBeenCalledTimes(2);
    const tujuan = email.sendEmail.mock.calls.map((c) => c[0].to);
    expect(tujuan).toEqual(['ada@contoh.test', 'pamela@klinik.test']);
  });

  it('menandai emailnya sebagai session_reminder untuk penyambungan template nanti', async () => {
    repo.findSessionById.mockResolvedValue(row());

    await handleSessionReminder({ sessionId: 7, channel: 'email_1h' }, SEBELUM);

    for (const call of email.sendEmail.mock.calls) {
      expect(call[0].template).toBe('session_reminder');
    }
  });

  it('mencatat siapa yang terkirim', async () => {
    repo.findSessionById.mockResolvedValue(row());

    await handleSessionReminder({ sessionId: 7, channel: 'email_24h' }, SEBELUM);

    expect(log.logging.audit).toHaveBeenCalledWith(
      'session.reminder.sent',
      expect.objectContaining({
        resourceId: '7',
        metadata: expect.objectContaining({ channel: 'email_24h', sent: ['client', 'professional'] }),
      }),
    );
  });
});

describe('handleSessionReminder — penerima tanpa email', () => {
  it('tetap mengirim ke profesional saat klien tidak punya email', async () => {
    repo.findSessionById.mockResolvedValue(row({ clientEmail: '' }));

    await handleSessionReminder({ sessionId: 7, channel: 'email_24h' }, SEBELUM);

    expect(email.sendEmail).toHaveBeenCalledTimes(1);
    expect(email.sendEmail.mock.calls[0][0].to).toBe('pamela@klinik.test');
  });

  it('tetap mengirim ke klien saat profesional tidak punya email', async () => {
    repo.findSessionById.mockResolvedValue(row({ professionalEmail: '' }));

    await handleSessionReminder({ sessionId: 7, channel: 'email_24h' }, SEBELUM);

    expect(email.sendEmail).toHaveBeenCalledTimes(1);
    expect(email.sendEmail.mock.calls[0][0].to).toBe('ada@contoh.test');
  });

  it('tidak melempar saat keduanya tidak punya email', async () => {
    repo.findSessionById.mockResolvedValue(row({ clientEmail: '', professionalEmail: '' }));

    await expect(
      handleSessionReminder({ sessionId: 7, channel: 'email_24h' }, SEBELUM),
    ).resolves.toBeUndefined();
    expect(email.sendEmail).not.toHaveBeenCalled();
  });
});

describe('handleSessionReminder — guard', () => {
  it('tidak mengirim apa pun untuk sesi yang tidak ada', async () => {
    repo.findSessionById.mockResolvedValue(null);

    await handleSessionReminder({ sessionId: 999, channel: 'email_24h' }, SEBELUM);

    expect(email.sendEmail).not.toHaveBeenCalled();
  });

  it('tidak mengirim apa pun untuk sesi yang sudah dibatalkan', async () => {
    // Pembatalan job adalah best-effort, jadi job untuk sesi yang dibatalkan bisa
    // tetap menyala. Guard inilah yang menahannya, bukan pembatalan job.
    repo.findSessionById.mockResolvedValue(row({ status: SESSION_STATUS.CANCELLED }));

    await handleSessionReminder({ sessionId: 7, channel: 'email_24h' }, SEBELUM);

    expect(email.sendEmail).not.toHaveBeenCalled();
  });

  it('tidak mengirim apa pun bila sesinya sudah dimulai — tanpa masa tenggang', async () => {
    repo.findSessionById.mockResolvedValue(row());
    const setelahMulai = new Date(STARTS_AT.getTime() + 60_000);

    await handleSessionReminder({ sessionId: 7, channel: 'email_1h' }, setelahMulai);

    expect(email.sendEmail).not.toHaveBeenCalled();
  });

  it('menolak channel yang tidak dikenal tanpa menyentuh database', async () => {
    await handleSessionReminder({ sessionId: 7, channel: 'sms' }, SEBELUM);

    expect(repo.findSessionById).not.toHaveBeenCalled();
    expect(email.sendEmail).not.toHaveBeenCalled();
  });

  it('menolak sessionId yang tidak masuk akal tanpa menyentuh database', async () => {
    for (const buruk of [undefined, null, 'abc', 0, -1, 1.5]) {
      await handleSessionReminder({ sessionId: buruk, channel: 'email_24h' }, SEBELUM);
    }

    expect(repo.findSessionById).not.toHaveBeenCalled();
  });
});

describe('handleSessionReminder — kegagalan kirim', () => {
  it('tidak melempar saat sendEmail membalas ok:false', async () => {
    repo.findSessionById.mockResolvedValue(row());
    email.sendEmail.mockResolvedValue({ ok: false, error: 'smtp 550' });

    await expect(
      handleSessionReminder({ sessionId: 7, channel: 'email_24h' }, SEBELUM),
    ).resolves.toBeUndefined();

    expect(log.logging.audit).toHaveBeenCalledWith(
      'session.reminder.sent',
      expect.objectContaining({ metadata: expect.objectContaining({ sent: [] }) }),
    );
  });
});
