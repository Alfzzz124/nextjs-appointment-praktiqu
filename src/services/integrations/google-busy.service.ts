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
import { googleOAuthConfig, GoogleConfigError } from '@/lib/google/config';
import { refreshAccessToken, queryFreeBusy, GoogleAuthRevokedError } from '@/lib/google/freebusy';
import { busyToBlockedRanges } from '@/services/booking/busy-intervals';
import { DEFAULT_TIMEZONE, toUtc } from '@/lib/time';
import type { BlockedRange } from '@/services/booking/slot-math';

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
}): Promise<Record<string, BlockedRange[]>> {
  const timeZone = opts.timeZone || DEFAULT_TIMEZONE;

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

    return busyToBlockedRanges(intervals, timeZone);
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
