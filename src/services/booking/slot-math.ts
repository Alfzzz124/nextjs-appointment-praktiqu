// src/services/booking/slot-math.ts
// Pure slot arithmetic. No database, no clock, no timezone conversion.
//
// Everything here works in local clinic time — `HH:MM:SS` strings and minutes
// past local midnight — which is the basis KiviCare stores clinic sessions and
// appointments in.
//
// This is the one place a slot is decided to exist or not, which makes it the
// one place a new source of unavailability has to be merged into.

/** A stretch of the day the professional works, from `wp_kc_clinic_sessions`. */
export interface TimeWindow {
  /** `HH:MM:SS`, local clinic time. */
  startTime: string;
  /** `HH:MM:SS`, local clinic time. */
  endTime: string;
  /** Slot size to use when the caller has no service-specific duration. */
  slotDurationMinutes: number;
}

/** Minutes past local midnight, half-open: `[start, end)`. */
export interface BlockedRange {
  start: number;
  end: number;
}

export interface DaySlot {
  /** `HH:MM:SS` */
  startTime: string;
  /** `HH:MM:SS` */
  endTime: string;
}

/** `HH:MM:SS` → minutes past midnight. */
export function toMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

/** Minutes past midnight → `HH:MM:SS`. */
export function toTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
}

/**
 * Slots for a single day.
 *
 * Overlap is half-open, so a slot ending exactly when a block starts is still
 * bookable — the same rule that lets appointments sit back to back.
 *
 * `durationMinutes` overrides each window's own slot size when supplied; that
 * is the professional's duration for the service being booked.
 *
 * A service that is a whole number of the window's sessions long (180′ on a 60′
 * grid) may start at any session boundary, not only every `duration` minutes
 * from the window start. And windows that touch with no gap between them are
 * one continuous stretch of working time, so a slot may run on into the next.
 * Both only ever add starts: every slot the narrower rule offered is still here.
 *
 * `crossBreaks` lets a service too long for the stretch it starts in run on through
 * the breaks after it, as long as it starts inside a window and ends by the day's
 * last working minute. Off unless the caller turns it on; see `generateSlots` for
 * who gets it.
 */
export function buildDaySlots(input: {
  windows: TimeWindow[];
  blocked: BlockedRange[];
  durationMinutes?: number;
  crossBreaks?: boolean;
}): DaySlot[] {
  const { windows, blocked, durationMinutes, crossBreaks = false } = input;
  const found: { start: number; end: number }[] = [];
  const seen = new Set<string>();

  // Nilai nol atau negatif diperlakukan sebagai "tidak ada penimpaan", bukan
  // sebagai ukuran slot. `duration = 0` pada sebuah mapping layanan adalah data
  // yang tidak bermakna, bukan instruksi — dan `??` hanya jatuh ke cadangan bila
  // null, sehingga 0 yang tersimpan dulu bertahan sebagai ukuran slot lalu
  // diam-diam menghasilkan nol slot. Gejalanya halaman booking yang kosong, tanpa
  // satu pun petunjuk di layar maupun di log. Dua dari 250 mapping hidup punya itu.
  const override = durationMinutes !== undefined && durationMinutes > 0 ? durationMinutes : undefined;

  // Jendela yang memang tidak punya ukuran slot terpakai sama sekali benar-benar
  // tidak bisa dipesan, dan itu berbeda dari penimpaan yang tidak bermakna. Jendela
  // seperti itu juga bukan jam kerja yang boleh disambung oleh jendela tetangganya.
  const usable = windows.filter((w) => (override ?? w.slotDurationMinutes) > 0);
  const stretches = continuousStretches(
    usable.map((w) => ({ start: toMinutes(w.startTime), end: toMinutes(w.endTime) })),
  );
  // Bentangan sudah urut dan tidak bertumpuk, jadi yang terakhir berakhir paling akhir.
  const dayEnd = stretches.length > 0 ? stretches[stretches.length - 1].end : 0;

  for (const w of usable) {
    const duration = override ?? w.slotDurationMinutes;
    const windowStart = toMinutes(w.startTime);
    const windowEnd = toMinutes(w.endTime);
    const own = stretches.find((s) => s.start <= windowStart && windowStart < s.end);
    const ownEnd = own?.end ?? windowEnd;
    // Hanya layanan yang memang tidak muat di bentangannya sendiri yang menembus jeda;
    // layanan 50′ di sesi 60′ tidak perlu memakan istirahat psikolog. Melewati jam
    // kerja terakhir hari itu tetap tidak boleh: janji tidak pernah berjalan sampai di
    // luar jam yang psikolog atur sendiri.
    const tooLongForOwn = own !== undefined && duration > own.end - own.start;
    const stretchEnd = crossBreaks && tooLongForOwn ? dayEnd : ownEnd;

    // Kisi sesi hanya dipakai bila layanan pas sejumlah sesi utuh. Layanan 90′ di
    // kisi 60′ tetap melompat selebar durasinya sendiri (09:00, 10:30, …) — dicampur
    // dengan kisi, daftarnya jadi 09:00, 10:00, 10:30, 11:00, … tanpa pola.
    const grid = w.slotDurationMinutes;
    const step = grid > 0 && grid < duration && duration % grid === 0 ? grid : duration;

    for (let start = windowStart; start < windowEnd && start + duration <= stretchEnd; start += step) {
      const end = start + duration;
      if (blocked.some((b) => b.start < end && b.end > start)) continue;
      const key = `${start}-${end}`;
      if (seen.has(key)) continue;
      seen.add(key);
      found.push({ start, end });
    }
  }

  return found
    .sort((a, b) => a.start - b.start || a.end - b.end)
    .map((s) => ({ startTime: toTime(s.start), endTime: toTime(s.end) }));
}

/** Ranges that touch or overlap, merged into the continuous stretches they form. */
function continuousStretches(
  ranges: { start: number; end: number }[],
): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  for (const r of ranges.filter((x) => x.end > x.start).sort((a, b) => a.start - b.start)) {
    const last = out[out.length - 1];
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
    else out.push({ ...r });
  }
  return out;
}

/** The minimum an off day has to look like for slot arithmetic. */
export interface OffDayLike {
  timeSpecific: boolean;
  startTime: string | null;
  endTime: string | null;
}

/** The minimum an appointment has to look like for slot arithmetic. */
export interface AppointmentLike {
  startTime: string | null;
  endTime: string | null;
}

/**
 * Everything blocking one day, as ranges.
 *
 * `null` means the day is closed outright — a full-day off day — which is a
 * different answer from "open, nothing blocked" (`[]`). Callers must branch on
 * it rather than treating a nullish result as empty.
 *
 * Callers pass only the off days and appointments that already fall on the date
 * in question. Deciding which those are needs repository knowledge (`isOffOn`,
 * and the appointment's own start date) that has no place in pure arithmetic.
 */
export function blockedRangesFor(input: {
  offDays: OffDayLike[];
  appointments: AppointmentLike[];
}): BlockedRange[] | null {
  if (input.offDays.some((o) => !o.timeSpecific)) return null;

  const blocked: BlockedRange[] = [];

  for (const o of input.offDays) {
    if (o.timeSpecific && o.startTime && o.endTime) {
      blocked.push({ start: toMinutes(o.startTime), end: toMinutes(o.endTime) });
    }
  }
  for (const a of input.appointments) {
    if (a.startTime && a.endTime) {
      blocked.push({ start: toMinutes(a.startTime), end: toMinutes(a.endTime) });
    }
  }

  return blocked;
}

/**
 * Inclusive `YYYY-MM-DD` dates from `from` to `to`.
 *
 * Stepped in UTC deliberately: these are calendar labels rather than instants,
 * and advancing a local-midnight Date would drop or repeat a day wherever a
 * DST boundary falls.
 */
export function eachDate(from: string, to: string): string[] {
  const out: string[] = [];
  const end = new Date(`${to}T00:00:00Z`);
  for (const d = new Date(`${from}T00:00:00Z`); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}
