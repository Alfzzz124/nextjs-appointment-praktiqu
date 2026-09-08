/**
 * Isi email pengingat sesi.
 *
 * Murni: tidak menyentuh database, jaringan, atau jam. Semua yang dibutuhkan masuk
 * sebagai argumen, jadi ia bisa diuji tanpa satu pun mock.
 *
 * Salinan berbahasa Indonesia — sengaja berbeda dari empat pengirim email lain yang
 * masih berbahasa Inggris. Menyeragamkan yang lain di luar cakupan; lihat §8 spec.
 *
 * Nama hari dan bulan dipetakan di sini karena `formatDateTimeInTz` tidak menerima
 * locale. Menambah dukungan locale ke `lib/time.ts` akan menyentuh semua pemanggilnya,
 * dan tidak ada yang membutuhkannya selain email ini.
 *
 * Source of truth: docs/superpowers/specs/2026-09-08-session-reminders-design.md
 */
import { formatDateTimeInTz, getDayOfWeekInTz } from '@/lib/time';

export type ReminderOffset = 'email_24h' | 'email_1h';
export type ReminderRecipient = 'client' | 'professional';

export interface SessionReminderEmailInput {
  offset: ReminderOffset;
  recipient: ReminderRecipient;
  clientName: string;
  professionalName: string;
  /** Jam mulai sesi dalam UTC. */
  startsAtUtc: Date;
  /** Zona waktu klinik, mis. 'Asia/Jakarta'. */
  timezone: string;
}

export interface BuiltEmail {
  subject: string;
  html: string;
  text: string;
}

const HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const BULAN = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

/** 'Kamis, 10 September 2026' + '09:30', pada zona waktu klinik. */
function formatWaktu(startsAtUtc: Date, timezone: string): { tanggal: string; jam: string } {
  const [datePart, jam] = formatDateTimeInTz(startsAtUtc, timezone, 'yyyy-MM-dd HH:mm').split(' ');
  const [tahun, bulan, hariAngka] = datePart.split('-').map(Number);
  const hari = HARI[getDayOfWeekInTz(startsAtUtc, timezone)];
  return { tanggal: `${hari}, ${hariAngka} ${BULAN[bulan - 1]} ${tahun}`, jam };
}

/**
 * Nama klien/profesional berasal dari wp_usermeta lewat public booking yang hanya
 * memvalidasi panjang (z.string().min(1).max(255)) — tidak ada larangan karakter.
 * Jadi harus di-escape sebelum masuk ke `html`; `text` tetap apa adanya.
 */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function buildSessionReminderEmail(input: SessionReminderEmailInput): BuiltEmail {
  const { tanggal, jam } = formatWaktu(input.startsAtUtc, input.timezone);

  // Siapa yang disapa, dan siapa lawan bicaranya di sesi itu.
  const sapaan = input.recipient === 'client' ? input.clientName : input.professionalName;
  const lawan = input.recipient === 'client' ? input.professionalName : input.clientName;
  const peranLawan = input.recipient === 'client' ? 'psikolog' : 'klien';

  const kapan = input.offset === 'email_24h' ? 'besok' : '1 jam lagi';
  const subject =
    input.offset === 'email_24h'
      ? `Pengingat: sesi Anda besok, ${tanggal} pukul ${jam}`
      : `Pengingat: sesi Anda 1 jam lagi, pukul ${jam}`;

  const html = `<p>Halo ${escapeHtml(sapaan)},</p>
<p>Ini pengingat bahwa sesi Anda berlangsung <strong>${kapan}</strong>.</p>
<ul>
  <li>Tanggal: ${tanggal}</li>
  <li>Waktu: ${jam}</li>
  <li>Bersama ${peranLawan}: ${escapeHtml(lawan)}</li>
</ul>
<p>Kalau Anda perlu mengubah jadwal, hubungi klinik sesegera mungkin.</p>`;

  const text = `Halo ${sapaan},

Ini pengingat bahwa sesi Anda berlangsung ${kapan}.

Tanggal: ${tanggal}
Waktu: ${jam}
Bersama ${peranLawan}: ${lawan}

Kalau Anda perlu mengubah jadwal, hubungi klinik sesegera mungkin.`;

  return { subject, html, text };
}
