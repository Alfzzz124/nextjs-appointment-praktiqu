// Turning Google's busy intervals into the local per-date ranges slot maths uses.
//
// This is the sharp edge of calendar sync. Google answers in UTC instants; every
// other number in the slot path is minutes past LOCAL midnight in the practice's
// own timezone. Getting it wrong shifts every block by hours, and the symptom is
// the WRONG slots being blocked rather than an error — nothing fails loudly, the
// page just quietly lies.

import { toZonedTime } from 'date-fns-tz';
import type { BlockedRange } from '@/services/booking/slot-math';

/** A stretch Google reports as busy. UTC instants, as the API returns them. */
export interface BusyInterval {
  start: Date;
  end: Date;
}

const MINUTES_PER_DAY = 1440;

/** `YYYY-MM-DD` and minutes-past-midnight for an instant, in the given zone. */
function inZone(instant: Date, timeZone: string): { date: string; minutes: number } {
  // toZonedTime returns a Date whose LOCAL getters read as the wall clock in
  // `timeZone`. It is only ever read through those getters here — the instant it
  // nominally represents is meaningless and must not be used for arithmetic.
  const z = toZonedTime(instant, timeZone);
  const p = (n: number) => String(n).padStart(2, '0');
  return {
    date: `${z.getFullYear()}-${p(z.getMonth() + 1)}-${p(z.getDate())}`,
    minutes: z.getHours() * 60 + z.getMinutes(),
  };
}

/** The next calendar date after a `YYYY-MM-DD`, stepped in UTC so no zone applies. */
function nextDate(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Busy intervals, as blocked ranges keyed by local `YYYY-MM-DD`.
 *
 * An interval crossing local midnight is split, so each date gets the part that
 * falls on it; one spanning whole days yields a full 0–1440 range for each day in
 * between. Ranges on a date come back in start order, which keeps the output
 * stable and readable in tests and logs.
 *
 * An all-day block is kept, deliberately. Google's own generated calendars
 * (holidays, birthdays) are excluded when the connection is saved, so an all-day
 * entry reaching here is one the professional put in their own calendar — leave,
 * almost always. Dropping it would offer patients slots on a day off, which is the
 * more damaging of the two mistakes.
 */
export function busyToBlockedRanges(
  intervals: readonly BusyInterval[],
  timeZone: string,
): Record<string, BlockedRange[]> {
  const byDate: Record<string, BlockedRange[]> = {};

  const push = (date: string, start: number, end: number) => {
    if (end <= start) return;
    (byDate[date] ??= []).push({ start, end });
  };

  for (const interval of intervals) {
    if (!(interval.end > interval.start)) continue;

    const from = inZone(interval.start, timeZone);
    const to = inZone(interval.end, timeZone);

    if (from.date === to.date) {
      push(from.date, from.minutes, to.minutes);
      continue;
    }

    // First day runs to midnight, last day runs from it, and every day between is
    // covered end to end.
    push(from.date, from.minutes, MINUTES_PER_DAY);
    // `end > start` guarantees this terminates, but it runs inside a request and
    // an unbounded loop there is not worth the three lines it costs to rule out.
    // A year is far past any interval Google would return for a booking window.
    let guard = 366;
    for (let date = nextDate(from.date); date !== to.date && guard > 0; date = nextDate(date)) {
      push(date, 0, MINUTES_PER_DAY);
      guard -= 1;
    }
    push(to.date, 0, to.minutes);
  }

  for (const ranges of Object.values(byDate)) {
    ranges.sort((a, b) => a.start - b.start || a.end - b.end);
  }
  return byDate;
}
