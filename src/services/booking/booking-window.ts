// Reads KiviCare's "Restrict Appointment" setting into a BookingWindow.
//
// KiviCare keeps it in two `wp_options` rows (KIVI_CARE_PREFIX is `kiviCare_`):
//   kiviCare_restrict_appointment                    a:2:{s:4:"post";i:365;s:3:"pre";i:0;}
//   kiviCare_restrict_only_same_day_book_appointment on | off
// See AppointmentSetting::kcAppointmentRestrictionData in the KiviCare plugin.
//
// Read on every call, never cached: an admin who changes it expects the next page load
// to follow, and it is one indexed query.

import { getWpOptions } from '@/repositories/wp/options.repo';
import { DEFAULT_BOOKING_WINDOW, type BookingWindow } from '@/services/booking/booking-policy';

const RESTRICT_OPTION = 'kiviCare_restrict_appointment';
const SAME_DAY_OPTION = 'kiviCare_restrict_only_same_day_book_appointment';

/**
 * One integer member of a PHP-serialized array. KiviCare saves them as `i:`, but a
 * value written by an older version or by hand may be a numeric string (`s:1:"1"`), and
 * PHP's `(int)` cast reads both the same.
 */
function serializedInt(raw: string, key: string): number | null {
  const m = new RegExp(`s:\\d+:"${key}";(?:i:(-?\\d+);|d:(-?\\d+)(?:\\.\\d*)?;|s:\\d+:"(-?\\d+)[^"]*";)`).exec(raw);
  if (!m) return null;
  return Number(m[1] ?? m[2] ?? m[3]);
}

/** PHP's maybe_unserialize for the one scalar shape we expect: `on` or `s:2:"on";`. */
function serializedScalar(raw: string): string {
  const m = /^s:\d+:"(.*)";$/s.exec(raw.trim());
  if (m) return m[1];
  if (raw.trim() === 'b:1;') return '1';
  return raw.trim();
}

/**
 * Pure: the two raw option values (or `undefined` when the row is missing) to a window.
 *
 * A negative day count is treated as unset. KiviCare's settings form refuses negatives,
 * so one can only arrive by hand, and `-1` days ahead would mean "yesterday is fine".
 */
export function parseBookingWindow(
  restrict: string | undefined,
  sameDay: string | undefined,
): BookingWindow {
  const days = (key: string, fallback: number) => {
    const n = restrict === undefined ? null : serializedInt(restrict, key);
    return n !== null && Number.isSafeInteger(n) && n >= 0 ? n : fallback;
  };
  const flag = sameDay === undefined ? '' : serializedScalar(sameDay);
  return {
    minDaysAhead: days('pre', DEFAULT_BOOKING_WINDOW.minDaysAhead),
    maxDaysAhead: days('post', DEFAULT_BOOKING_WINDOW.maxDaysAhead),
    sameDayOnly: flag === 'on' || flag === '1',
  };
}

export async function getBookingWindow(): Promise<BookingWindow> {
  const options = await getWpOptions([RESTRICT_OPTION, SAME_DAY_OPTION]);
  return parseBookingWindow(options.get(RESTRICT_OPTION), options.get(SAME_DAY_OPTION));
}
