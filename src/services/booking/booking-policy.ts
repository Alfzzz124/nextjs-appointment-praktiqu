// When a public booking is too close to make.
//
// Its own module rather than living beside the slot readers: the write path has to
// apply the same rule, and `public-catalog.service.ts` already imports from
// `public-booking.service.ts`, so putting it there would close a cycle.
//
// Pure — no database, no I/O. Local clinic time throughout, like the slot maths it
// sits next to: slot times are local wall-clock strings and `now` is read through
// local getters, so no UTC conversion enters the arithmetic.

import { toMinutes } from '@/services/booking/slot-math';

/**
 * How far ahead a public booking has to be made.
 *
 * One constant, read both by the readers that hide slots and by the config handed
 * to the front end. Two numbers would mean the client filtering on one value while
 * the server enforced another, and the disagreement would surface only as slots
 * that vanish when clicked.
 */
export const MIN_BOOKING_NOTICE_MINUTES = 60;

/** Whole days from one `YYYY-MM-DD` to another, sign included. */
function daysBetween(from: string, to: string): number {
  const a = Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10));
  const b = Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10));
  return Math.round((b - a) / 86_400_000);
}

/** Local calendar date of an instant. Never via toISOString, which shifts to UTC. */
export function localDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

/** Minutes past local midnight for an instant, the basis the slot maths uses. */
function localMinutes(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

/** Minutes from `now` until a slot starts. Negative once it has begun. */
export function minutesUntil(date: string, startTime: string, now: Date): number {
  return daysBetween(localDate(now), date) * 1440 + toMinutes(startTime) - localMinutes(now);
}

/**
 * Is this slot one a patient can no longer honestly take?
 *
 * Two rules in one, because the second all but subsumes the first: a slot that has
 * already started is never a valid choice, and neither is one closer than the
 * practice's minimum notice. They differ by a single boundary, which is why they are
 * written out rather than folded together — a slot starting exactly now HAS started,
 * while a slot exactly `noticeMinutes` away is still far enough. With a notice of
 * zero this reduces to "has it started".
 *
 * The day difference is carried explicitly rather than comparing minutes-of-day, so
 * a notice window late in the evening cannot reach across midnight and swallow
 * tomorrow morning.
 *
 * Public only, and deliberately so. The authenticated staff path (`generateSlots`)
 * must NOT apply this: a receptionist recording a walk-in that happened this morning
 * has a legitimate reason to pick a past slot.
 */
export function isTooSoon(
  date: string,
  startTime: string,
  now: Date,
  noticeMinutes: number = MIN_BOOKING_NOTICE_MINUTES,
): boolean {
  const until = minutesUntil(date, startTime, now);
  if (until <= 0) return true;
  return until < noticeMinutes;
}
