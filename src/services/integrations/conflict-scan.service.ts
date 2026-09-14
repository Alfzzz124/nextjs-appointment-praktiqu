// Pemindaian harian: janji temu mana yang kini tertimpa agenda pribadi psikolog.
//
// Arahnya mundur, dan pembacaan slot tidak menolong: slot dihitung untuk jam yang
// belum dipesan, sementara ini soal janji temu yang SUDAH ada lalu tertimpa.
//
// Tidak pernah membatalkan atau menjadwalkan ulang apa pun. Keputusan itu diambil
// saat perancangan dan disengaja: satu agenda pribadi yang salah ketik tidak boleh
// bisa membatalkan sesi berbayar. Yang dilakukan hanya memberi tahu psikolognya,
// dan dia yang memutuskan.

import { prisma } from '@/lib/prisma';
import { sendEmail } from '@/lib/email';
import { logging } from '@/lib/logging';
import { findDoctorById } from '@/repositories/wp/doctors.repo';
import { ACTIVE_STATUSES, listAppointments } from '@/repositories/wp/appointments.repo';
import { googleBusyForRange } from '@/services/integrations/google-busy.service';
import { findBackwardConflicts, type BackwardConflict } from '@/services/booking/backward-conflicts';
import { localDate } from '@/services/booking/booking-policy';

/**
 * Sejauh mana ke depan janji temu diperiksa.
 *
 * Sama dengan jendela pemesanan publik: di luar itu belum ada yang bisa dipesan,
 * jadi tidak ada yang bisa bentrok.
 */
const LOOKAHEAD_DAYS = 60;

/** Batas janji temu per psikolog dalam satu pemindaian. */
const PAGE_SIZE = 100;
const MAX_PAGES = 100;

export interface ScanResult {
  /** Koneksi aktif yang diperiksa. */
  scanned: number;
  /** Bentrok yang ditemukan, termasuk yang sudah pernah diberitahukan. */
  conflicts: number;
  /** Email peringatan yang benar-benar terkirim. */
  notified: number;
}

/** Menandai bentrok MANA yang sudah diberitahukan, bukan sekadar bahwa ada. */
function fingerprintOf(c: BackwardConflict): string {
  return `${c.date}:${c.busy.start}-${c.busy.end}`;
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function appointmentsInWindow(doctorId: bigint, from: string, to: string) {
  const all: Array<{ id: number; startDate: string | null; startTime: string | null; endTime: string | null }> = [];

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const res = await listAppointments({
      page,
      perPage: PAGE_SIZE,
      doctorId,
      dateFrom: from,
      dateTo: to,
      statuses: ACTIVE_STATUSES,
    });
    for (const a of res.items) {
      all.push({
        id: Number(a.id),
        startDate: a.startDate,
        startTime: a.startTime,
        endTime: a.endTime,
      });
    }
    const size = res.perPage || PAGE_SIZE;
    if (res.items.length < size) break;
    if (all.length >= res.total) break;
  }

  return all;
}

function emailFor(nama: string, conflicts: BackwardConflict[]) {
  const baris = conflicts
    .map((c) => `• ${c.date}, ${c.startTime.slice(0, 5)}–${c.endTime.slice(0, 5)}`)
    .join('\n');

  const text =
    `Halo ${nama},\n\n` +
    `Ada agenda di Google Calendar Anda yang bertabrakan dengan janji temu yang sudah ` +
    `terjadwal di PraktiQu:\n\n${baris}\n\n` +
    `Tidak ada yang kami ubah. Janji temu itu tetap berlaku dan pasiennya tidak ` +
    `diberi tahu apa pun. Anda yang memutuskan mana yang digeser.\n\n` +
    `Kami hanya melihat kapan Anda sibuk, bukan sedang apa — jadi kami tidak bisa ` +
    `menilai mana yang lebih penting.\n\n— PraktiQu`;

  const html =
    `<p>Halo ${nama},</p>` +
    `<p>Ada agenda di Google Calendar Anda yang bertabrakan dengan janji temu yang sudah ` +
    `terjadwal di PraktiQu:</p><ul>` +
    conflicts
      .map((c) => `<li>${c.date}, ${c.startTime.slice(0, 5)}–${c.endTime.slice(0, 5)}</li>`)
      .join('') +
    `</ul><p><strong>Tidak ada yang kami ubah.</strong> Janji temu itu tetap berlaku dan ` +
    `pasiennya tidak diberi tahu apa pun. Anda yang memutuskan mana yang digeser.</p>` +
    `<p>Kami hanya melihat kapan Anda sibuk, bukan sedang apa — jadi kami tidak bisa ` +
    `menilai mana yang lebih penting.</p><p>— PraktiQu</p>`;

  return { text, html };
}

/**
 * Memeriksa setiap koneksi aktif, dan memberi tahu psikolognya tentang bentrok
 * yang BELUM pernah diberitahukan.
 *
 * Gagal-terbuka per psikolog: satu koneksi yang bermasalah tidak menghentikan
 * sisanya. Pemindaian yang berhenti di psikolog ketiga akan diam-diam melewatkan
 * semua yang setelahnya, dan tidak ada yang menyadarinya.
 */
export async function scanBackwardConflicts(now: Date = new Date()): Promise<ScanResult> {
  const from = localDate(now);
  const to = addDays(from, LOOKAHEAD_DAYS);

  const connections = await prisma.googleCalendarConnection.findMany({
    where: { status: 'active' },
    select: { professionalId: true },
  });

  const hasil: ScanResult = { scanned: 0, conflicts: 0, notified: 0 };

  for (const { professionalId } of connections) {
    const id = Number(professionalId);
    hasil.scanned += 1;

    try {
      const [doctor, appointments] = await Promise.all([
        findDoctorById(professionalId),
        appointmentsInWindow(professionalId, from, to),
      ]);
      if (appointments.length === 0) {
        await prisma.googleConflictWarning.deleteMany({ where: { professionalId } });
        continue;
      }

      // Langsung ke Google, melewati cache: ini berjalan sekali sehari, dan
      // jawaban semenit lalu tidak sepadan dengan peringatan yang meleset.
      const busyByDate = await googleBusyForRange({
        professionalId: id,
        from,
        to,
        timeZone: doctor?.timezone ?? undefined,
        cache: false,
      });

      const conflicts = findBackwardConflicts({ appointments, busyByDate });
      hasil.conflicts += conflicts.length;

      // Catatan untuk janji temu yang sudah tidak bentrok lagi dibuang, supaya
      // bentrok yang muncul kembali nanti tetap diberitahukan.
      const masihBentrok = conflicts.map((c) => c.appointmentId);
      await prisma.googleConflictWarning.deleteMany({
        where: { professionalId, appointmentId: { notIn: masihBentrok.length ? masihBentrok : [-1] } },
      });

      if (conflicts.length === 0) continue;

      const sudah = await prisma.googleConflictWarning.findMany({ where: { professionalId } });
      const sudahPer = new Map(sudah.map((w) => [w.appointmentId, w.fingerprint]));
      const baru = conflicts.filter((c) => sudahPer.get(c.appointmentId) !== fingerprintOf(c));
      if (baru.length === 0) continue;

      const alamat = doctor?.email;
      if (!alamat) {
        logging.warn('[conflict-scan] psikolog tanpa alamat email, dilewati', {
          resource: 'professional',
          resourceId: String(id),
        });
        continue;
      }

      const { text, html } = emailFor(doctor?.displayName || 'Psikolog', baru);
      const res = await sendEmail({
        to: alamat,
        subject: `${baru.length} janji temu bertabrakan dengan agenda Google Anda`,
        html,
        text,
        template: 'google-conflict-warning',
      });

      // Hanya dicatat kalau emailnya benar-benar terkirim. Mencatatnya lebih dulu
      // berarti percobaan besok menganggapnya sudah diberitahukan, dan psikolognya
      // tidak pernah tahu.
      if (!res.ok) {
        logging.warn('[conflict-scan] email peringatan gagal terkirim', {
          resource: 'professional',
          resourceId: String(id),
          metadata: { error: res.error },
        });
        continue;
      }

      const notifiedAt = new Date();
      for (const c of baru) {
        await prisma.googleConflictWarning.upsert({
          where: { professionalId_appointmentId: { professionalId, appointmentId: c.appointmentId } },
          create: { professionalId, appointmentId: c.appointmentId, fingerprint: fingerprintOf(c), notifiedAt },
          update: { fingerprint: fingerprintOf(c), notifiedAt },
        });
      }
      hasil.notified += baru.length;
    } catch (err) {
      logging.error('[conflict-scan] gagal memeriksa satu psikolog', {
        resource: 'professional',
        resourceId: String(id),
        error: err,
      });
    }
  }

  return hasil;
}
