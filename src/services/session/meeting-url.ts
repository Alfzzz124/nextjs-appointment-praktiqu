/**
 * Tautan Meet sebuah janji, dibaca dari baris sinkronisasi Google (`hangoutLink`).
 *
 * Tidak ada data baru: tautan itu sudah disimpan sapuan event-sync saat membuat acara
 * untuk layanan online. Hanya baris yang acaranya masih diinginkan ada ('present') yang
 * dihitung; baris 'absent' menunjuk acara yang sudah dihapus, jadi tautannya mati.
 */
import { prisma } from '@/lib/prisma';
import { logging } from '@/lib/logging';

/**
 * `appointmentId -> tautan` untuk janji yang punya tautan, dalam SATU kueri `IN`.
 *
 * Hanya untuk tampilan, jadi gagal baca tidak boleh menjatuhkan daftar janji atau
 * email pengingat: dicatat, lalu tautannya dianggap tidak ada.
 */
export async function meetingUrlsFor(appointmentIds: number[]): Promise<Map<number, string>> {
  const urls = new Map<number, string>();
  if (appointmentIds.length === 0) return urls;
  try {
    const rows = await prisma.googleCalendarEventSync.findMany({
      where: {
        appointmentId: { in: appointmentIds.map((id) => BigInt(id)) },
        desiredState: 'present',
        hangoutLink: { not: null },
      },
      select: { appointmentId: true, hangoutLink: true },
    });
    for (const r of rows) {
      if (r.hangoutLink) urls.set(Number(r.appointmentId), r.hangoutLink);
    }
  } catch (err) {
    await logging.error('Tautan Meet tidak terbaca — janji ditampilkan tanpa tautan', err, {
      resource: 'session',
      metadata: { count: appointmentIds.length },
    });
  }
  return urls;
}

/** Menambahkan `meetingUrl` (null bila tak ada) ke tiap baris, dengan satu kueri. */
export async function withMeetingUrls<T extends { id: number }>(
  rows: T[],
): Promise<Array<T & { meetingUrl: string | null }>> {
  const urls = await meetingUrlsFor(rows.map((r) => r.id));
  return rows.map((r) => ({ ...r, meetingUrl: urls.get(r.id) ?? null }));
}
