/**
 * Email for the hourly schedule-conflict scan. Pure: everything arrives as arguments — no
 * database, network or clock. Indonesian, like the session reminders.
 *
 * Source of truth: docs/superpowers/specs/2026-10-21-deteksi-bentrok-jadwal-design.md §6.2
 */
import { escapeHtml, formatWaktu, type BuiltEmail } from '@/services/session/reminder-email';

export interface ConflictMailSide {
  id: number;
  /** Local `HH:MM:SS`. */
  startTime: string;
  endTime: string;
  clientName: string;
  serviceName: string;
  clinicName: string;
  /** Raw KiviCare status. */
  status: number;
}

export interface ConflictMailPair {
  /** Local `YYYY-MM-DD`. */
  date: string;
  professionalName: string;
  low: ConflictMailSide;
  high: ConflictMailSide;
}

const STATUS_LABEL: Record<number, string> = { 1: 'Terjadwal', 2: 'Menunggu', 4: 'Check-in' };

const PEMBUKA = 'Kami menemukan janji temu yang jadwalnya tumpang tindih untuk psikolog yang sama:';
const PENUTUP =
  'Tidak ada yang kami ubah otomatis — kedua janji temu tetap berlaku dan klien tidak diberi tahu. ' +
  'Pindahkan atau batalkan salah satunya.';

/** 'Jumat, 23 Oktober 2026'. The date is already local: noon UTC, read in UTC, is that same day. */
function tanggalPanjang(date: string): string {
  return formatWaktu(new Date(`${date}T12:00:00Z`), 'UTC').tanggal;
}

function judul(p: ConflictMailPair): string {
  return `${tanggalPanjang(p.date)} — ${p.professionalName}`;
}

function baris(s: ConflictMailSide): string {
  return [
    `#${s.id}`,
    `${s.startTime.slice(0, 5)}–${s.endTime.slice(0, 5)}`,
    s.clientName,
    s.serviceName,
    s.clinicName,
    STATUS_LABEL[s.status] ?? `Status ${s.status}`,
  ].join(' · ');
}

export function buildScheduleConflictEmail(input: {
  recipientName: string;
  pairs: ConflictMailPair[];
}): BuiltEmail {
  const subject = `Jadwal bentrok: ${input.pairs.length} pasang janji temu tumpang tindih`;

  const text = [
    `Halo ${input.recipientName},`,
    '',
    PEMBUKA,
    '',
    ...input.pairs.flatMap((p) => [judul(p), `  ${baris(p.low)}`, `  ${baris(p.high)}`, '']),
    PENUTUP,
    '',
    '— PraktiQu',
  ].join('\n');

  const html = [
    `<p>Halo ${escapeHtml(input.recipientName)},</p>`,
    `<p>${PEMBUKA}</p>`,
    ...input.pairs.map(
      (p) =>
        `<p><strong>${escapeHtml(judul(p))}</strong></p>\n<ul>\n` +
        `  <li>${escapeHtml(baris(p.low))}</li>\n  <li>${escapeHtml(baris(p.high))}</li>\n</ul>`,
    ),
    `<p>${PENUTUP}</p>`,
    '<p>— PraktiQu</p>',
  ].join('\n');

  return { subject, html, text };
}
