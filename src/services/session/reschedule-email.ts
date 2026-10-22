/**
 * Email bodies for a session moved by staff: one to the client, a copy to the
 * psychologist. Pure: everything arrives as arguments, so the copy is testable without a
 * mock. Indonesian, like the session reminders and the approval emails.
 *
 * Source of truth: docs/superpowers/specs/2026-10-21-reschedule-staf-design.md §5.2
 */
import type { SessionMailFacts } from '@/services/approval/emails';
import { escapeHtml, formatWaktu, type BuiltEmail } from './reminder-email';

export interface RescheduleMailFacts extends SessionMailFacts {
  /** The start it had before the move, in UTC. */
  previousStartsAtUtc: Date;
  /** What staff wrote, if anything. */
  reason?: string;
  /** The online session link after the move, if it has one. */
  meetingUrl?: string | null;
}

function waktu(at: Date, timezone: string): string {
  const { tanggal, jam } = formatWaktu(at, timezone);
  return `${tanggal}, ${jam}`;
}

function rincian(f: RescheduleMailFacts, withClient: boolean): { html: string; text: string } {
  const rows: Array<[string, string]> = [
    ['Jadwal lama', waktu(f.previousStartsAtUtc, f.timezone)],
    ['Jadwal baru', waktu(f.startsAtUtc, f.timezone)],
    ['Layanan', f.serviceName],
    ['Psikolog', f.professionalName],
  ];
  if (withClient) rows.push(['Klien', f.clientName]);
  if (f.reason) rows.push(['Alasan', f.reason]);
  if (f.meetingUrl) rows.push(['Link sesi online', f.meetingUrl]);

  return {
    html: `<ul>\n${rows
      .map(([k, v]) =>
        k === 'Link sesi online'
          ? `  <li>${k}: <a href="${escapeHtml(v)}">${escapeHtml(v)}</a></li>`
          : `  <li>${k}: ${escapeHtml(v)}</li>`,
      )
      .join('\n')}\n</ul>`,
    text: rows.map(([k, v]) => `${k}: ${v}`).join('\n'),
  };
}

export function buildClientRescheduledEmail(f: RescheduleMailFacts): BuiltEmail {
  const r = rincian(f, false);
  const subject = 'Jadwal sesi Anda dipindah';
  const html = `<p>Halo ${escapeHtml(f.clientName)},</p>
<p>Klinik memindahkan jadwal sesi Anda. Berikut jadwal barunya.</p>
${r.html}
<p>Kalau jadwal baru ini tidak sesuai, silakan hubungi klinik.</p>`;
  const text = `Halo ${f.clientName},

Klinik memindahkan jadwal sesi Anda. Berikut jadwal barunya.

${r.text}

Kalau jadwal baru ini tidak sesuai, silakan hubungi klinik.`;
  return { subject, html, text };
}

export function buildProfessionalRescheduledEmail(f: RescheduleMailFacts): BuiltEmail {
  const r = rincian(f, true);
  const subject = `Jadwal sesi dipindah: ${f.clientName}`;
  const html = `<p>Halo ${escapeHtml(f.professionalName)},</p>
<p>Jadwal sesi dengan ${escapeHtml(f.clientName)} sudah dipindah.</p>
${r.html}`;
  const text = `Halo ${f.professionalName},

Jadwal sesi dengan ${f.clientName} sudah dipindah.

${r.text}`;
  return { subject, html, text };
}
