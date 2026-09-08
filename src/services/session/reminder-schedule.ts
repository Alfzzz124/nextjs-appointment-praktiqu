/**
 * Menjadwalkan dan membatalkan job pengingat sesi.
 *
 * Satu-satunya modul yang menyentuh `@/lib/jobs`. Menerima `SessionRow` dan memutuskan
 * sendiri dari `row.status`, jadi kedua titik hook di `session.service.ts` memanggil
 * fungsi yang sama tanpa bercabang: BOOKED menjadwalkan, apa pun selain itu membatalkan.
 *
 * Tidak ada tabel state. Idempotensi datang dari selalu membatalkan sebelum menjadwalkan
 * — `as_unschedule_all_actions` di sisi WordPress membuang semua action yang cocok, jadi
 * menyetujui sesi dua kali tidak menghasilkan pengingat kembar. Model `AppointmentReminder`
 * sengaja tidak dipakai: foreign key-nya menunjuk tabel shadow yang antre dihapus.
 *
 * Source of truth: docs/superpowers/specs/2026-09-08-session-reminders-design.md
 */
import { jobs } from '@/lib/jobs/client';
import { logging } from '@/lib/logging';
import { buildUtcDateTime, timeToMinutes } from '@/lib/time';
import { SESSION_STATUS, type SessionRow } from '@/repositories/wp/sessions.repo';
import type { ReminderOffset } from './reminder-email';

export const REMINDER_HOOK = 'praktiqu_session_send_reminder' as const;

export const REMINDER_OFFSETS: readonly ReminderOffset[] = ['email_24h', 'email_1h'];

const LEAD_MS: Record<ReminderOffset, number> = {
  email_24h: 24 * 60 * 60_000,
  email_1h: 60 * 60_000,
};

/**
 * Args untuk hook pengingat.
 *
 * ⚠️ **Urutan kuncinya adalah kontraknya, bukan namanya.** Action Scheduler
 * mengeksekusi action dengan `do_action_ref_array($hook, array_values($args))`
 * (`ActionScheduler_Action.php:86`), jadi `array_values()` membuang kunci dan handler
 * PHP-nya menerima nilainya secara posisional:
 *
 *     handle_session_send_reminder(int $session_id, string $channel = 'email')
 *
 * Menukar urutan kunci di sini akan menukar argumen di sisi WordPress, dan tidak ada
 * yang akan gagal sampai produksi. Ada test yang memaku urutan ini — jangan dilonggarkan.
 */
export function reminderArgs(
  sessionId: number,
  channel: ReminderOffset,
): { sessionId: number; channel: ReminderOffset } {
  return { sessionId, channel };
}

/** Jam mulai sesi dalam UTC, atau null bila tanggal/jamnya tidak lengkap. */
export function sessionStartsAtUtc(row: SessionRow): Date | null {
  if (!row.slotDate || !row.startTime) return null;
  return buildUtcDateTime(row.slotDate, timeToMinutes(row.startTime), row.timezone);
}

/**
 * Selaraskan job pengingat dengan keadaan sesi saat ini.
 *
 * Selalu membatalkan lebih dulu, lalu menjadwalkan ulang hanya bila sesinya BOOKED dan
 * waktunya masih di depan. `now` disuntikkan supaya test bisa memindahkan waktu.
 *
 * Gagal menjadwalkan pengingat tidak boleh pernah menggagalkan booking-nya. `jobs.enqueue`
 * dan `jobs.cancel` sudah menelan error mereka sendiri. Seluruh badan fungsi tetap
 * dibungkus try/catch untuk menutup jalur sisanya — error dicatat lalu ditelan, bukan
 * dilempar ke pemanggil di `session.service.ts`.
 *
 * Zona waktu IANA yang cacat TIDAK melempar: `date-fns-tz@3.2.0`'s `fromZonedTime`
 * menelan `RangeError`-nya sendiri secara internal (lewat `isValidTimezoneIANAString`)
 * dan mengembalikan sebuah `Invalid Date` — objek `Date` yang truthy tapi `getTime()`-nya
 * `NaN`. Itu jadi bug diam-diam berbahaya sendiri: `NaN` lolos dari perbandingan waktu
 * lampau (`NaN <= x` selalu `false`) dan berakhir di `JSON.stringify` sebagai `runAt: null`
 * yang dikirim ke WordPress. Makanya ada pengecekan `Number.isNaN` eksplisit di bawah,
 * terpisah dari guard null/undefined biasa.
 */
export async function syncSessionReminders(row: SessionRow, now: Date = new Date()): Promise<void> {
  try {
    for (const channel of REMINDER_OFFSETS) {
      await jobs.cancel({ hook: REMINDER_HOOK, args: reminderArgs(row.id, channel) });
    }

    if (row.status !== SESSION_STATUS.BOOKED) return;

    const startsAt = sessionStartsAtUtc(row);
    if (!startsAt || Number.isNaN(startsAt.getTime())) {
      if (startsAt) {
        await logging.error('Session has an invalid start time; skipping reminder scheduling', undefined, {
          resource: 'session',
          resourceId: String(row.id),
          metadata: { timezone: row.timezone },
        });
      }
      return;
    }

    for (const channel of REMINDER_OFFSETS) {
      const runAt = new Date(startsAt.getTime() - LEAD_MS[channel]);
      if (runAt.getTime() <= now.getTime()) continue;
      await jobs.enqueue({ hook: REMINDER_HOOK, runAt, args: reminderArgs(row.id, channel) });
    }
  } catch (err) {
    await logging.error('Failed to sync session reminders', err, {
      resource: 'session',
      resourceId: String(row.id),
      metadata: { status: row.status, timezone: row.timezone },
    });
  }
}
