// When a public booking is too close to make.
//
// Its own module rather than living beside the slot readers: the write path has to
// apply the same rule, and `public-catalog.service.ts` already imports from
// `public-booking.service.ts`, so putting it there would close a cycle.
//
// Pure — no database, no I/O. Clinic wall-clock time throughout, like the slot maths
// it sits next to: slot times are wall-clock strings and `now` is read in the clinic
// zone (default WIB) via Intl, so the result never depends on the process TZ.

import { toMinutes } from '@/services/booking/slot-math';
import { DEFAULT_TIMEZONE } from '@/lib/time';

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

/**
 * Wall-clock parts of an instant in a zone. Read through Intl with an explicit
 * timeZone rather than local getters: the process zone is whatever the host sets
 * (UTC on a container, WIB on the dev box), and "now" has to mean the clinic's now
 * either way. A zone that moved "now" by 7 hours let slots from this morning stay
 * bookable and switched the minimum-notice rule off.
 */
function zonedParts(d: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    minutes: Number(get('hour')) * 60 + Number(get('minute')),
  };
}

/** Calendar date of an instant in the clinic zone. Never via toISOString (UTC). */
export function localDate(d: Date, timeZone: string = DEFAULT_TIMEZONE): string {
  return zonedParts(d, timeZone).date;
}

/**
 * `YYYY-MM-DD` plus a number of days. Stepped in UTC because these are calendar
 * labels, not instants: advancing a Date with local setters would skip or repeat a
 * day near midnight or a DST change of the process zone.
 */
export function addDaysTo(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Minutes past clinic-zone midnight for an instant, the basis the slot maths uses. */
function localMinutes(d: Date, timeZone: string): number {
  return zonedParts(d, timeZone).minutes;
}

/** Minutes from `now` until a slot starts. Negative once it has begun. */
export function minutesUntil(
  date: string,
  startTime: string,
  now: Date,
  timeZone: string = DEFAULT_TIMEZONE,
): number {
  const { date: today, minutes } = zonedParts(now, timeZone);
  return daysBetween(today, date) * 1440 + toMinutes(startTime) - minutes;
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
  timeZone: string = DEFAULT_TIMEZONE,
): boolean {
  const until = minutesUntil(date, startTime, now, timeZone);
  if (until <= 0) return true;
  return until < noticeMinutes;
}
