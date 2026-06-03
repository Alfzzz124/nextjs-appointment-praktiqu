/**
 * Time utilities — UTC ↔ practice timezone conversion.
 *
 * All times stored in database are UTC.
 * Conversion to/from practice timezone happens at the API edge.
 * See: FR-014 (System MUST convert all stored times to UTC at write-time
 * and convert to the practice's timezone on read for staff).
 *
 * Uses date-fns and date-fns-tz.
 */

import { format, parseISO } from 'date-fns';
import { formatInTimeZone, toZonedTime, fromZonedTime } from 'date-fns-tz';
import type { FormatOptions } from 'date-fns';

/** Default timezone for new practices (Indonesia Western Time = WIB). */
export const DEFAULT_TIMEZONE = 'Asia/Jakarta';

/**
 * Convert a UTC Date to the given timezone, returning a ZonedDate.
 * Use this when reading times from the DB to display in the practice TZ.
 */
export function toTimezone(date: Date | string, tz: string = DEFAULT_TIMEZONE): Date {
  const d = typeof date === 'string' ? parseISO(date) : date;
  return toZonedTime(d, tz);
}

/**
 * Convert a local (zoned) datetime + timezone to UTC.
 * Use this when writing times from a form to the database.
 */
export function toUtc(
  localDate: Date | string,
  tz: string = DEFAULT_TIMEZONE,
): Date {
  const d = typeof localDate === 'string' ? parseISO(localDate) : localDate;
  return fromZonedTime(d, tz);
}

/**
 * Format a UTC date string as a time-only string in the given timezone.
 * @example formatTimeInTz('2024-01-15T09:00:00Z', 'Asia/Jakarta') => '16:00'
 */
export function formatTimeInTz(
  utcDate: Date | string,
  tz: string = DEFAULT_TIMEZONE,
  fmt: string = 'HH:mm',
): string {
  const d = typeof utcDate === 'string' ? parseISO(utcDate) : utcDate;
  return formatInTimeZone(d, tz, fmt);
}

/**
 * Format a UTC date string as a full datetime in the given timezone.
 */
export function formatDateTimeInTz(
  utcDate: Date | string,
  tz: string = DEFAULT_TIMEZONE,
  fmt: string = 'yyyy-MM-dd HH:mm',
): string {
  const d = typeof utcDate === 'string' ? parseISO(utcDate) : utcDate;
  return formatInTimeZone(d, tz, fmt);
}

/**
 * Get day of week (0=Sun..6=Sat) for a UTC date in a given timezone.
 * This is the reverse of the slot generation algorithm's step 4.
 */
export function getDayOfWeekInTz(
  utcDate: Date | string,
  tz: string = DEFAULT_TIMEZONE,
): number {
  const d = typeof utcDate === 'string' ? parseISO(utcDate) : utcDate;
  const zoned = toZonedTime(d, tz);
  // date-fns getDay: 0=Sun, 1=Mon, ..., 6=Sat
  return zoned.getDay();
}

/**
 * Convert HH:mm string (in practice TZ) to minutes from midnight.
 * @example timeToMinutes('09:30') => 570
 */
export function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

/**
 * Convert minutes from midnight to HH:mm string (in practice TZ).
 * @example minutesToTime(570) => '09:30'
 */
export function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

/**
 * Build a UTC Date from a date string + minutes-from-midnight in a timezone.
 * @param dateStr '2024-01-15' in practice TZ
 * @param startMinute e.g. 540 for 09:00
 * @param tz e.g. 'Asia/Jakarta'
 * @returns UTC Date
 */
export function buildUtcDateTime(
  dateStr: string,
  startMinute: number,
  tz: string = DEFAULT_TIMEZONE,
): Date {
  const [year, month, day] = dateStr.split('-').map(Number);
  const h = Math.floor(startMinute / 60);
  const m = startMinute % 60;
  // Build a local datetime in the practice TZ then convert to UTC
  const localDate = new Date(year, month - 1, day, h, m, 0, 0);
  return fromZonedTime(localDate, tz);
}

/**
 * Check if a date is today in a given timezone.
 */
export function isTodayInTz(
  utcDate: Date | string,
  tz: string = DEFAULT_TIMEZONE,
): boolean {
  const d = typeof utcDate === 'string' ? parseISO(utcDate) : utcDate;
  const now = new Date();
  const todayZoned = formatInTimeZone(now, tz, 'yyyy-MM-dd');
  const dateZoned = formatInTimeZone(d, tz, 'yyyy-MM-dd');
  return todayZoned === dateZoned;
}

/**
 * Get today's date as a string in the given timezone.
 * Useful for comparing @db.Date fields.
 */
export function todayInTz(tz: string = DEFAULT_TIMEZONE): string {
  return formatInTimeZone(new Date(), tz, 'yyyy-MM-dd');
}