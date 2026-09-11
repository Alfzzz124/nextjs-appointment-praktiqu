// The professional's Google busy times, as blocked ranges the slot maths can use.
//
// Fails open, throughout. A Google outage, an expired grant, a calendar that has
// gone away — none of them may stop a practice taking bookings, so every failure
// here ends in "no Google blocks for now" rather than an error reaching the
// patient. The cost is an occasional slot offered that the professional has
// already given away, which the design accepts and handles by warning them.

import {
  getRefreshToken,
  markConnection,
  ConnectionUnusableError,
} from '@/services/integrations/google-calendar-connection.service';
import { prisma } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';
import { googleOAuthConfig, GoogleConfigError } from '@/lib/google/config';
import { refreshAccessToken, queryFreeBusy, GoogleAuthRevokedError } from '@/lib/google/freebusy';
import { busyToBlockedRanges } from '@/services/booking/busy-intervals';
import { eachDate } from '@/services/booking/slot-math';
import { DEFAULT_TIMEZONE, toUtc } from '@/lib/time';
import type { BlockedRange } from '@/services/booking/slot-math';

/**
 * How long a cached free/busy answer is trusted.
 *
 * Short, because the thing it is caching is exactly what changes when a
 * professional adds something to their calendar — the event this feature exists to
 * notice. A minute keeps repeated page renders free without letting a fresh
 * commitment go unseen for long.
 */
const CACHE_TTL_MS = 60_000;

/** A date column read back, as the `YYYY-MM-DD` the rest of this path speaks. */
function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Cached ranges for every requested date, or `null` if any of them is missing,
 * stale, or was converted in a different timezone.
 *
 * All-or-nothing on purpose: one Google call covers the whole range anyway, so
 * there is nothing to gain from a partial hit and a second code path to get wrong.
 */
async function readCache(
  professionalId: number,
  dates: string[],
  timeZone: string,
): Promise<Record<string, BlockedRange[]> | null> {
  const rows = await prisma.googleBusyCache.findMany({
    where: {
      professionalId: BigInt(professionalId),
      date: { in: dates.map((d) => new Date(`${d}T00:00:00Z`)) },
    },
  });
  if (rows.length < dates.length) return null;

  const cutoff = Date.now() - CACHE_TTL_MS;
  const out: Record<string, BlockedRange[]> = {};

  for (const row of rows) {
    if (row.fetchedAt.getTime() < cutoff) return null;
    // Minutes stored under one zone read as a different wall clock under another —
    // silently, by exactly the offset between them. A changed timezone is a miss.
    if (row.timeZone !== timeZone) return null;

    // Prisma types a Json column as JsonValue; the shape is ours, written by
    // writeCache below, so the cast is narrowing what we already know.
    const busy = (Array.isArray(row.busy) ? row.busy : []) as unknown as BlockedRange[];
    // Days with nothing busy are stored so "we checked, it was clear" is cached
    // too, but they are omitted here to match what busyToBlockedRanges returns.
    if (busy.length > 0) out[dateKey(row.date)] = busy;
  }
  return out;
}

async function writeCache(
  professionalId: number,
  dates: string[],
  timeZone: string,
  byDate: Record<string, BlockedRange[]>,
): Promise<void> {
  const fetchedAt = new Date();
  for (const date of dates) {
    const busy = (byDate[date] ?? []) as unknown as Prisma.InputJsonValue;
    const day = new Date(`${date}T00:00:00Z`);
    await prisma.googleBusyCache.upsert({
      where: { professionalId_date: { professionalId: BigInt(professionalId), date: day } },
      create: { professionalId: BigInt(professionalId), date: day, timeZone, busy, fetchedAt },
      update: { timeZone, busy, fetchedAt },
    });
  }
}

/**
 * Busy ranges per local `YYYY-MM-DD`, or `{}` when there is nothing to add.
 *
 * `{}` covers every reason equally: not connected, revoked, misconfigured, Google
 * unreachable. The caller cannot distinguish them and must not try to — the answer
 * to all of them is the same.
 */
export async function googleBusyForRange(opts: {
  professionalId: number;
  from: string;
  to: string;
  timeZone?: string;
  /**
   * Set false to go straight to Google. The booking write path does: that is one
   * call per booking rather than one per page render, and it is the last check
   * before a patient's time is committed.
   */
  cache?: boolean;
}): Promise<Record<string, BlockedRange[]>> {
  const timeZone = opts.timeZone || DEFAULT_TIMEZONE;
  const useCache = opts.cache !== false;
  const dates = eachDate(opts.from, opts.to);

  const connection = await prisma.googleCalendarConnection.findUnique({
    where: { professionalId: BigInt(opts.professionalId) },
    select: { status: true, calendarIds: true },
  });
  // The overwhelmingly common case: this professional has not connected anything.
  if (!connection || connection.status !== 'active') return {};

  const calendarIds = Array.isArray(connection.calendarIds)
    ? (connection.calendarIds as string[])
    : ['primary'];
  if (calendarIds.length === 0) return {};

  if (useCache) {
    const hit = await readCache(opts.professionalId, dates, timeZone);
    if (hit) return hit;
  }

  try {
    const config = googleOAuthConfig();
    const refreshToken = await getRefreshToken(opts.professionalId);
    const accessToken = await refreshAccessToken({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      refreshToken,
    });

    const intervals = await queryFreeBusy({
      accessToken,
      calendarIds,
      // The window is the local range, converted back to instants — asking in UTC
      // dates would miss the first and last few hours wherever the practice is
      // not on UTC.
      timeMin: toUtc(`${opts.from}T00:00:00`, timeZone),
      timeMax: toUtc(`${opts.to}T23:59:59.999`, timeZone),
    });

    await prisma.googleCalendarConnection.updateMany({
      where: { professionalId: BigInt(opts.professionalId) },
      data: { lastCheckedAt: new Date() },
    });

    const byDate = busyToBlockedRanges(intervals, timeZone);
    if (useCache) await writeCache(opts.professionalId, dates, timeZone, byDate);
    return byDate;
  } catch (err) {
    if (err instanceof GoogleAuthRevokedError) {
      // Expected, not exceptional: while the Google app is in Testing this fires
      // for every professional weekly. Recorded as `revoked` so the settings page
      // can ask them to reconnect without alarming them, and so we stop calling
      // Google on every page render until they do.
      await markConnection(opts.professionalId, { status: 'revoked' });
      return {};
    }

    if (err instanceof ConnectionUnusableError) return {};

    if (err instanceof GoogleConfigError) {
      console.error('[google-busy] not configured:', err.message);
      return {};
    }

    // Anything else — Google down, a network blip, a shape we did not expect.
    // Logged so it is visible, swallowed so bookings keep working.
    console.error('[google-busy] could not read busy times', {
      professionalId: opts.professionalId,
      error: err instanceof Error ? err.message : String(err),
    });
    return {};
  }
}
