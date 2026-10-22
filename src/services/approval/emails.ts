/**
 * Email bodies for the psychologist-approval flow. Pure: everything arrives as
 * arguments — no database, network or clock — so every copy is testable without a mock.
 * Indonesian, like the session reminders.
 *
 * Source of truth: docs/superpowers/specs/2026-10-19-approval-psikolog-design.md §7.6
 */
import { escapeHtml, formatWaktu, type BuiltEmail } from '@/services/session/reminder-email';

export interface SessionMailFacts {
  clientName: string;
  professionalName: string;
  serviceName: string;
  /** Session start in UTC. */
  startsAtUtc: Date;
  /** Clinic zone, e.g. 'Asia/Jakarta'. */
  timezone: string;
}

function rincian(f: SessionMailFacts): { html: string; text: string } {
  const { tanggal, jam } = formatWaktu(f.startsAtUtc, f.timezone);
  const rows: Array<[string, string]> = [
    ['Layanan', f.serviceName],
    ['Tanggal', tanggal],
    ['Waktu', jam],
    ['Psikolog', f.professionalName],
    ['Klien', f.clientName],
  ];
  return {
    html: `<ul>\n${rows.map(([k, v]) => `  <li>${k}: ${escapeHtml(v)}</li>`).join('\n')}\n</ul>`,
    text: rows.map(([k, v]) => `${k}: ${v}`).join('\n'),
  };
}

function tautan(link: string, label: string): { html: string; text: string } {
  return { html: `<p><a href="${escapeHtml(link)}">${label}</a></p>`, text: `${label}: ${link}` };
}

export function buildClientAwaitingEmail(f: SessionMailFacts): BuiltEmail {
  const r = rincian(f);
  const subject = 'Pembayaran diterima — menunggu konfirmasi psikolog';
  const html = `<p>Halo ${escapeHtml(f.clientName)},</p>
<p>Pembayaran Anda untuk sesi berikut sudah kami terima.</p>
${r.html}
<p>Psikolog ${escapeHtml(f.professionalName)} akan mengonfirmasi jadwal ini. Kami akan mengirim email lagi begitu jadwalnya dikonfirmasi.</p>
<p>Kalau psikolog tidak dapat menerima jadwal ini, klinik akan mengembalikan dana Anda.</p>`;
  const text = `Halo ${f.clientName},

Pembayaran Anda untuk sesi berikut sudah kami terima.

${r.text}

Psikolog ${f.professionalName} akan mengonfirmasi jadwal ini. Kami akan mengirim email lagi begitu jadwalnya dikonfirmasi.

Kalau psikolog tidak dapat menerima jadwal ini, klinik akan mengembalikan dana Anda.`;
  return { subject, html, text };
}

export interface ProfessionalRequestInput extends SessionMailFacts {
  link: string;
  /** Null for the first mail; when the booking was paid, for a reminder. */
  waitingSince: Date | null;
}

export function buildProfessionalRequestEmail(f: ProfessionalRequestInput): BuiltEmail {
  const r = rincian(f);
  const t = tautan(f.link, 'Buka permintaan');
  const { tanggal, jam } = formatWaktu(f.startsAtUtc, f.timezone);

  let subject: string;
  let pembukaHtml: string;
  let pembukaText: string;
  if (f.waitingSince === null) {
    subject = `Booking baru menunggu persetujuan Anda: ${tanggal} pukul ${jam}`;
    pembukaHtml = `${escapeHtml(f.clientName)} sudah membayar sesi berikut dan menunggu persetujuan Anda.`;
    pembukaText = `${f.clientName} sudah membayar sesi berikut dan menunggu persetujuan Anda.`;
  } else {
    const sejak = formatWaktu(f.waitingSince, f.timezone);
    subject = `Pengingat: booking ${f.clientName} masih menunggu persetujuan Anda`;
    pembukaHtml = `Booking dari ${escapeHtml(f.clientName)} masih menunggu persetujuan Anda sejak ${sejak.tanggal} pukul ${sejak.jam}.`;
    pembukaText = `Booking dari ${f.clientName} masih menunggu persetujuan Anda sejak ${sejak.tanggal} pukul ${sejak.jam}.`;
  }

  const penutup = 'Jadwal ini tetap terkunci sampai Anda menyetujui atau menolaknya. Klien baru menerima konfirmasi setelah Anda menyetujui.';
  const html = `<p>Halo ${escapeHtml(f.professionalName)},</p>
<p>${pembukaHtml}</p>
${r.html}
${t.html}
<p>${penutup}</p>`;
  const text = `Halo ${f.professionalName},

${pembukaText}

${r.text}

${t.text}

${penutup}`;
  return { subject, html, text };
}

export interface AdminEscalationInput extends SessionMailFacts {
  adminName: string;
  link: string;
  requestedAt: Date;
}

export function buildAdminEscalationEmail(f: AdminEscalationInput): BuiltEmail {
  const r = rincian(f);
  const t = tautan(f.link, 'Buka antrean persetujuan');
  const { tanggal } = formatWaktu(f.startsAtUtc, f.timezone);
  const sejak = formatWaktu(f.requestedAt, f.timezone);

  const subject = `Booking menunggu persetujuan psikolog: ${f.professionalName}, ${tanggal}`;
  const isiText = `Booking berikut sudah dibayar klien, tetapi belum disetujui psikolog ${f.professionalName} sejak ${sejak.tanggal} pukul ${sejak.jam}.`;
  const isiHtml = `Booking berikut sudah dibayar klien, tetapi belum disetujui psikolog ${escapeHtml(f.professionalName)} sejak ${sejak.tanggal} pukul ${sejak.jam}.`;
  const penutup = 'Anda bisa menyetujui atau menolaknya atas nama psikolog.';
  const html = `<p>Halo ${escapeHtml(f.adminName)},</p>
<p>${isiHtml}</p>
${r.html}
${t.html}
<p>${penutup}</p>`;
  const text = `Halo ${f.adminName},

${isiText}

${r.text}

${t.text}

${penutup}`;
  return { subject, html, text };
}

export interface ClientRejectedInput extends SessionMailFacts {
  clinicName: string;
  clinicEmail: string | null;
  clinicPhone: string | null;
}

/** The psychologist's reason is internal (spec §2) and deliberately not an input here. */
export function buildClientRejectedEmail(f: ClientRejectedInput): BuiltEmail {
  const r = rincian(f);
  const kontak = [f.clinicEmail, f.clinicPhone].filter((v): v is string => !!v && v.trim() !== '').join(' · ');
  const hubungiText = kontak
    ? `Untuk pertanyaan tentang pengembalian dana atau untuk memilih jadwal lain, hubungi ${f.clinicName}: ${kontak}.`
    : `Untuk pertanyaan tentang pengembalian dana atau untuk memilih jadwal lain, hubungi ${f.clinicName}.`;
  const hubungiHtml = kontak
    ? `Untuk pertanyaan tentang pengembalian dana atau untuk memilih jadwal lain, hubungi ${escapeHtml(f.clinicName)}: ${escapeHtml(kontak)}.`
    : `Untuk pertanyaan tentang pengembalian dana atau untuk memilih jadwal lain, hubungi ${escapeHtml(f.clinicName)}.`;

  const subject = 'Jadwal sesi Anda tidak dapat diterima';
  const html = `<p>Halo ${escapeHtml(f.clientName)},</p>
<p>Mohon maaf, psikolog ${escapeHtml(f.professionalName)} tidak dapat menerima jadwal berikut.</p>
${r.html}
<p>Pembayaran Anda akan dikembalikan oleh ${escapeHtml(f.clinicName)}.</p>
<p>${hubungiHtml}</p>`;
  const text = `Halo ${f.clientName},

Mohon maaf, psikolog ${f.professionalName} tidak dapat menerima jadwal berikut.

${r.text}

Pembayaran Anda akan dikembalikan oleh ${f.clinicName}.

${hubungiText}`;
  return { subject, html, text };
}
