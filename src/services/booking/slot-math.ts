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
 */
export function buildDaySlots(input: {
  windows: TimeWindow[];
  blocked: BlockedRange[];
  durationMinutes?: number;
}): DaySlot[] {
  const { windows, blocked, durationMinutes } = input;
  const slots: DaySlot[] = [];

  for (const w of windows) {
    const duration = durationMinutes ?? w.slotDurationMinutes;
    if (duration <= 0) continue;

    const windowStart = toMinutes(w.startTime);
    const windowEnd = toMinutes(w.endTime);

    for (let start = windowStart; start + duration <= windowEnd; start += duration) {
      const end = start + duration;
      if (blocked.some((b) => b.start < end && b.end > start)) continue;
      slots.push({ startTime: toTime(start), endTime: toTime(end) });
    }
  }

  return slots;
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
