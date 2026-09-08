/**
 * Penerima webhook `session.reminder` dari WordPress Action Scheduler.
 *
 * Ini handler job pertama yang pernah didaftarkan di aplikasi ini. `registerJobHandler`
 * sudah ada di `lib/jobs/webhook-handler.ts` sejak awal tapi belum pernah dipanggil,
 * jadi map dispatcher-nya kosong dan setiap callback jatuh ke cabang "No handler
 * registered" lalu dibalas 200 — WordPress dikabari berhasil dan tidak pernah retry.
 *
 * Handler ini berjalan sebagai job latar. Tidak ada manusia yang menunggu jawabannya,
 * jadi ia **tidak boleh melempar**: setiap penolakan dicatat lalu selesai dengan tenang.
 * `processWebhook` memang menelan error handler, tapi mengandalkan itu berarti kegagalan
 * jadi tak terlihat.
 *
 * Guard-nya bukan hiasan. Pembatalan job di sisi WordPress adalah best-effort — komentar
 * di `class-praktiqu-endpoint-jobs.php:90-96` mengakuinya — dan WP-Cron menyala telat.
 * Jadi sesi bisa saja sudah dibatalkan, atau sudah dimulai, saat webhook-nya tiba.
 *
 * Source of truth: docs/superpowers/specs/2026-09-08-session-reminders-design.md
 */
import { findSessionById, SESSION_STATUS } from '@/repositories/wp/sessions.repo';
import { sendEmail } from '@/lib/email';
import { logging } from '@/lib/logging';
import { registerJobHandler } from '@/lib/jobs/webhook-handler';
import {
  buildSessionReminderEmail,
  type ReminderOffset,
  type ReminderRecipient,
} from './reminder-email';
import { REMINDER_OFFSETS, sessionStartsAtUtc } from './reminder-schedule';

export const REMINDER_EVENT = 'session.reminder' as const;

function isOffset(value: unknown): value is ReminderOffset {
  return typeof value === 'string' && (REMINDER_OFFSETS as readonly string[]).includes(value);
}

function isSessionId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

export async function handleSessionReminder(
  data: Record<string, unknown>,
  now: Date = new Date(),
): Promise<void> {
  const channel = data.channel;
  if (!isOffset(channel)) {
    await logging.warn('session.reminder: channel tidak dikenal', { metadata: { data } });
    return;
  }
  if (!isSessionId(data.sessionId)) {
    await logging.warn('session.reminder: sessionId tidak valid', { metadata: { data } });
    return;
  }
  const sessionId = data.sessionId;

  const row = await findSessionById(sessionId);
  if (!row) {
    await logging.warn('session.reminder: sesi tidak ditemukan', { metadata: { sessionId } });
    return;
  }

  if (row.status !== SESSION_STATUS.BOOKED) {
    await logging.audit('session.reminder.skipped', {
      resource: 'session',
      resourceId: String(sessionId),
      metadata: { channel, reason: 'status', status: row.status },
    });
    return;
  }

  const startsAt = sessionStartsAtUtc(row);
  if (!startsAt || startsAt.getTime() <= now.getTime()) {
    await logging.audit('session.reminder.skipped', {
      resource: 'session',
      resourceId: String(sessionId),
      metadata: { channel, reason: startsAt ? 'sudah_dimulai' : 'jadwal_tidak_lengkap' },
    });
    return;
  }

  const targets: { recipient: ReminderRecipient; to: string }[] = [
    { recipient: 'client', to: row.clientEmail },
    { recipient: 'professional', to: row.professionalEmail },
  ];

  const sent: ReminderRecipient[] = [];
  const skipped: ReminderRecipient[] = [];

  for (const target of targets) {
    if (!target.to) {
      skipped.push(target.recipient);
      continue;
    }
    const mail = buildSessionReminderEmail({
      offset: channel,
      recipient: target.recipient,
      clientName: row.clientName,
      professionalName: row.professionalName,
      startsAtUtc: startsAt,
      timezone: row.timezone,
    });
    // sendEmail tidak pernah melempar — ia membalas { ok: false } dan sudah mencatat
    // kegagalannya lewat audit.emailDeliveryFailed.
    const res = await sendEmail({
      to: target.to,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
      template: 'session_reminder',
    });
    (res.ok ? sent : skipped).push(target.recipient);
  }

  await logging.audit('session.reminder.sent', {
    resource: 'session',
    resourceId: String(sessionId),
    metadata: { channel, sent, skipped },
  });
}

// Efek samping saat modul dimuat. Route webhook mengimpor modul ini justru untuk ini —
// lihat komentar di src/app/api/v1/webhooks/wordpress-jobs/route.ts.
registerJobHandler(REMINDER_EVENT, (data) => handleSessionReminder(data));
