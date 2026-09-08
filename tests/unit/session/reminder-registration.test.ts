/**
 * Kalau tidak ada yang mengimpor `reminder-handler`, `registerJobHandler` tidak pernah
 * jalan dan webhook `session.reminder` jatuh ke cabang "No handler registered" — dibalas
 * 200, tidak dikerjakan, tidak di-retry WordPress. Diam total.
 *
 * Test ini masuk lewat `processWebhook`, jalur yang benar-benar dipakai produksi, dan
 * karena itu ia menangkap impor yang dihapus orang karena disangka tidak terpakai.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { SESSION_STATUS, type SessionRow } from '@/repositories/wp/sessions.repo';

const SECRET = 'rahasia-webhook-untuk-test';
process.env.WORDPRESS_WEBHOOK_SECRET = SECRET;

const repo = { findSessionById: vi.fn() };
vi.mock('@/repositories/wp/sessions.repo', async (orig) => {
  const actual = await (orig as () => Promise<Record<string, unknown>>)();
  return { ...actual, findSessionById: (...a: unknown[]) => repo.findSessionById(...a) };
});

const email = { sendEmail: vi.fn().mockResolvedValue({ ok: true }) };
vi.mock('@/lib/email', () => email);
vi.mock('@/lib/logging', () => ({
  logging: { audit: vi.fn(), warn: vi.fn(), error: vi.fn(), activity: vi.fn(), system: vi.fn() },
}));

function sessionRow(): SessionRow {
  // Jauh di masa depan supaya guard "sudah dimulai" tidak ikut menahannya.
  const tahunDepan = new Date().getUTCFullYear() + 1;
  return {
    id: 7,
    clinicId: 1,
    professionalId: 119,
    clientId: 522,
    professionalName: 'Pamela Dewi',
    clientName: 'Ada Lovelace',
    clientEmail: 'ada@contoh.test',
    professionalEmail: 'pamela@klinik.test',
    slotDate: `${tahunDepan}-09-10`,
    startTime: '09:30',
    endTime: '10:30',
    timezone: 'Asia/Jakarta',
    status: SESSION_STATUS.BOOKED,
    serviceIds: [3],
    description: null,
    createdAt: new Date(),
  };
}

beforeEach(() => {
  repo.findSessionById.mockReset().mockResolvedValue(sessionRow());
  email.sendEmail.mockClear();
});

describe('pendaftaran handler session.reminder', () => {
  it('mengimpor modul route membuat webhook session.reminder benar-benar dikerjakan', async () => {
    // Impor route-nya, persis seperti Next.js melakukannya saat request masuk.
    await import('@/app/api/v1/webhooks/wordpress-jobs/route');
    const { processWebhook } = await import('@/lib/jobs/webhook-handler');

    const body = JSON.stringify({ event: 'session.reminder', data: { sessionId: 7, channel: 'email_24h' } });
    const signature = createHmac('sha256', SECRET).update(body).digest('hex');

    const handled = await processWebhook(body, signature);

    expect(handled).toBe(true);
    expect(repo.findSessionById).toHaveBeenCalledWith(7);
    expect(email.sendEmail).toHaveBeenCalledTimes(2);
  });
});
