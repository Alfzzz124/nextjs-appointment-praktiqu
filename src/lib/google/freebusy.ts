// Asking Google when a professional is busy.
//
// `freebusy.query` and nothing else. It answers with opaque intervals — no titles,
// no descriptions, no attendees — which is the whole reason this feature reads it
// rather than `events.list`: a psychologist's personal calendar plausibly holds
// other clients' names, and none of that should enter a health application's
// database. One request covers the entire date range and up to 50 calendars.

import { GoogleOAuthError } from '@/lib/google/oauth-client';
import type { BusyInterval } from '@/services/booking/busy-intervals';

/**
 * The authorisation is gone: revoked by the person, or expired.
 *
 * Its own type because the right response is a calm "reconnect", not an error
 * banner. While the Google app is in Testing this happens to every connected
 * professional every 7 days, so treating it as a failure would paint the settings
 * page red weekly and earn a bug report each Monday.
 */
export class GoogleAuthRevokedError extends Error {
  readonly code = 'GOOGLE_AUTH_REVOKED';
}

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const FREEBUSY_ENDPOINT = 'https://www.googleapis.com/calendar/v3/freeBusy';

/** Google's own error code from a failed response, without assuming a shape. */
async function errorCodeOf(res: Response): Promise<string> {
  try {
    const body = (await res.clone().json()) as Record<string, unknown>;
    if (typeof body.error === 'string') return body.error;
    const nested = body.error as { message?: unknown; status?: unknown } | undefined;
    if (nested && typeof nested.message === 'string') return nested.message;
    if (nested && typeof nested.status === 'string') return nested.status;
  } catch {
    /* a non-JSON error page says no more than the status does */
  }
  return 'unknown';
}

export async function refreshAccessToken(
  creds: { clientId: string; clientSecret: string; refreshToken: string },
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const res = await fetchImpl(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      refresh_token: creds.refreshToken,
      grant_type: 'refresh_token',
    }).toString(),
  });

  if (!res.ok) {
    const code = await errorCodeOf(res);
    // Google's one signal that the grant itself is gone. Everything else is a
    // problem with this request, not with the professional's consent.
    if (code === 'invalid_grant') {
      throw new GoogleAuthRevokedError('Google authorisation is no longer valid');
    }
    // The status and Google's code, never the request body — it holds the secret.
    throw new GoogleOAuthError(`Token refresh failed (${res.status}: ${code})`);
  }

  const json = (await res.json()) as Record<string, unknown>;
  if (typeof json.access_token !== 'string' || !json.access_token) {
    throw new GoogleOAuthError('Token refresh returned no access token');
  }
  return json.access_token;
}

interface RawBusy {
  start?: unknown;
  end?: unknown;
}

function toInterval(raw: RawBusy): BusyInterval | null {
  if (typeof raw.start !== 'string' || typeof raw.end !== 'string') return null;
  const start = new Date(raw.start);
  const end = new Date(raw.end);
  // An unparseable date becomes Invalid Date, whose getTime() is NaN. Silently
  // letting one through would place a block at an arbitrary point in 1970.
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  return { start, end };
}

export async function queryFreeBusy(
  opts: {
    accessToken: string;
    calendarIds: readonly string[];
    timeMin: Date;
    timeMax: Date;
  },
  fetchImpl: typeof fetch = fetch,
): Promise<BusyInterval[]> {
  const res = await fetchImpl(FREEBUSY_ENDPOINT, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${opts.accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      timeMin: opts.timeMin.toISOString(),
      timeMax: opts.timeMax.toISOString(),
      items: opts.calendarIds.map((id) => ({ id })),
    }),
  });

  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new GoogleAuthRevokedError(`Google rejected the access token (${res.status})`);
    }
    throw new GoogleOAuthError(`freebusy failed (${res.status}: ${await errorCodeOf(res)})`);
  }

  const json = (await res.json()) as { calendars?: Record<string, { busy?: RawBusy[] }> };
  const out: BusyInterval[] = [];

  for (const calendar of Object.values(json.calendars ?? {})) {
    // A calendar entry can carry `errors` instead of `busy` — deleted, unshared,
    // or a stale id. The others still answered, and dropping the whole reply over
    // one of them would silently unblock the professional's day.
    for (const raw of calendar.busy ?? []) {
      const interval = toInterval(raw);
      if (interval) out.push(interval);
    }
  }

  return out;
}
