// Janji temu yang tertimpa agenda pribadi psikolog di Google Calendar.
//
// Arahnya mundur, dan itulah sebabnya ini ada: janji temunya sudah dipesan lebih
// dulu, lalu psikolognya menambahkan sesuatu di atasnya. Pembacaan slot tidak
// menolong sama sekali — slot dihitung untuk jam yang BELUM dipesan.
//
// Murni: tanpa basis data, tanpa jam, tanpa I/O. Menit lokal sejak tengah malam,
// sama seperti seluruh aritmetika slot.

import { toMinutes, type BlockedRange } from '@/services/booking/slot-math';

/** Sekadar yang dibutuhkan untuk menilai bentrok. */
export interface AppointmentLike {
  id: number;
  startDate: string | null;
  startTime: string | null;
  endTime: string | null;
}

export interface BackwardConflict {
  appointmentId: number;
  date: string;
  startTime: string;
  endTime: string;
  /** Blok Google pertama yang menimpanya — cukup untuk mengenali jamnya. */
  busy: BlockedRange;
}

/**
 * Janji temu mana saja yang kini tertimpa agenda pribadi.
 *
 * Tumpang tindih half-open, sama seperti sisa jalur slot: janji temu yang selesai
 * tepat saat blok mulai bukan bentrok. Tanpa itu setiap janji temu yang bersambung
 * langsung dengan agenda pribadi akan dilaporkan, dan peringatannya jadi derau.
 *
 * Satu baris per janji temu, bukan per blok. Yang perlu diketahui psikolognya
 * adalah "janji temu ini bentrok" — rincian setiap potongan agendanya justru
 * mengaburkan itu.
 */
export function findBackwardConflicts(input: {
  appointments: readonly AppointmentLike[];
  busyByDate: Record<string, BlockedRange[]>;
}): BackwardConflict[] {
  const out: BackwardConflict[] = [];

  for (const a of input.appointments) {
    if (!a.startDate || !a.startTime || !a.endTime) continue;

    const busy = input.busyByDate[a.startDate];
    if (!busy || busy.length === 0) continue;

    const start = toMinutes(a.startTime);
    const end = toMinutes(a.endTime);
    const hit = busy.find((b) => b.start < end && b.end > start);
    if (!hit) continue;

    out.push({
      appointmentId: a.id,
      date: a.startDate,
      startTime: a.startTime,
      endTime: a.endTime,
      busy: hit,
    });
  }

  return out;
}
