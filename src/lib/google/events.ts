// Writing appointments into a professional's Google Calendar.
//
// This module holds a write credential over someone's real calendar, which the
// read side deliberately never did. Everything here is therefore built around one
// rule: we only ever touch events that carry our own marker. See `MARKER_KEY`.

import { GoogleOAuthError } from '@/lib/google/oauth-client';
import { GoogleAuthRevokedError } from '@/lib/google/freebusy';

const EVENTS_ENDPOINT = 'https://www.googleapis.com/calendar/v3/calendars';

/**
 * The private extended property that marks an event as ours.
 *
 * `private` rather than `shared`: shared properties travel to attendees' copies of
 * the event, and the appointment id is ours, not theirs. Private ones are visible
 * only to the OAuth client that wrote them.
 */
export const MARKER_KEY = 'praktiqu_appointment_id';

/** Google is unhappy now but may not be in a minute: 429, 5xx, network. */
export class GoogleTransientError extends Error {
  readonly code = 'GOOGLE_TRANSIENT';
}

/** The event is not there. Deleting wanted that; updating did not. */
export class GoogleEventGoneError extends Error {
  readonly code = 'GOOGLE_EVENT_GONE';
}

/**
 * The event exists but is not ours.
 *
 * Its own type because the correct response is to stop, not to retry and not to
 * overwrite. A stored id pointing at a stranger's event means something is wrong
 * with our bookkeeping, and the one unacceptable outcome is editing a
 * psychologist's real appointment because we assumed.
 */
export class GoogleEventNotOursError extends Error {
  readonly code = 'GOOGLE_EVENT_NOT_OURS';
}

export interface GoogleEventBody {
  summary: string;
  description: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  attendees: { email: string }[];
  extendedProperties: { private: Record<string, string> };
}

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

/** Turn a failed response into the error that says what to do about it. */
async function raiseFor(res: Response, what: string): Promise<never> {
  const code = await errorCodeOf(res);
  if (res.status === 401 || res.status === 403) {
    throw new GoogleAuthRevokedError(`Google rejected the access token (${res.status})`);
  }
  if (res.status === 404 || res.status === 410) {
    throw new GoogleEventGoneError(`${what}: event not found (${res.status})`);
  }
  if (res.status === 429 || res.status >= 500) {
    throw new GoogleTransientError(`${what} failed (${res.status}: ${code})`);
  }
  throw new GoogleOAuthError(`${what} failed (${res.status}: ${code})`);
}

interface Call {
  accessToken: string;
  calendarId: string;
  fetchImpl?: typeof fetch;
}

function eventsUrl(calendarId: string, path = '', query: Record<string, string> = {}) {
  const url = new URL(`${EVENTS_ENDPOINT}/${encodeURIComponent(calendarId)}/events${path}`);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  return url.toString();
}

/**
 * `sendUpdates=all` — Google emails the attendees.
 *
 * The product decision was that clients are invited, and an invitation nobody is
 * told about is not one. Note the mail comes from the professional's own Google
 * account, not from PraktiQu.
 */
const SEND_UPDATES = 'all';

export async function createEvent(
  opts: Call & { body: GoogleEventBody },
): Promise<string> {
  const doFetch = opts.fetchImpl ?? fetch;
  const res = await doFetch(eventsUrl(opts.calendarId, '', { sendUpdates: SEND_UPDATES }), {
    method: 'POST',
    headers: {
      authorization: `Bearer ${opts.accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(opts.body),
  });

  if (!res.ok) await raiseFor(res, 'create event');

  const json = (await res.json()) as { id?: unknown };
  if (typeof json.id !== 'string' || !json.id) {
    throw new GoogleOAuthError('create event returned no id');
  }
  return json.id;
}

/** The marker an existing event carries, or null if it has none. */
export async function markerOf(
  opts: Call & { eventId: string },
): Promise<string | null> {
  const doFetch = opts.fetchImpl ?? fetch;
  const res = await doFetch(eventsUrl(opts.calendarId, `/${encodeURIComponent(opts.eventId)}`), {
    headers: { authorization: `Bearer ${opts.accessToken}` },
  });

  if (!res.ok) await raiseFor(res, 'read event');

  const json = (await res.json()) as {
    status?: unknown;
    extendedProperties?: { private?: Record<string, unknown> };
  };
  // A cancelled event still answers 200. Treating it as present would make us
  // "update" a tombstone and report success for an event nobody can see.
  if (json.status === 'cancelled') {
    throw new GoogleEventGoneError('read event: event is cancelled');
  }
  const marker = json.extendedProperties?.private?.[MARKER_KEY];
  return typeof marker === 'string' ? marker : null;
}

/**
 * Overwrite an event we previously created — after proving it is still ours.
 *
 * The check is a separate round trip on purpose. Google offers no conditional
 * "update only if this property matches", and the alternative is trusting a stored
 * id against a calendar the professional edits freely. Ids get reused across
 * restores, events get deleted and recreated by hand, and our own bookkeeping can
 * drift. One extra GET buys the guarantee that we never rewrite somebody's real
 * appointment.
 */
export async function updateEvent(
  opts: Call & { eventId: string; body: GoogleEventBody; expectMarker: string },
): Promise<void> {
  const doFetch = opts.fetchImpl ?? fetch;

  const marker = await markerOf(opts);
  if (marker !== opts.expectMarker) {
    throw new GoogleEventNotOursError(
      `event ${opts.eventId} carries marker ${marker ?? '(none)'}, expected ${opts.expectMarker}`,
    );
  }

  const res = await doFetch(
    eventsUrl(opts.calendarId, `/${encodeURIComponent(opts.eventId)}`, {
      sendUpdates: SEND_UPDATES,
    }),
    {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${opts.accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(opts.body),
    },
  );

  if (!res.ok) await raiseFor(res, 'update event');
}

/** Remove an event we created — after proving it is still ours. */
export async function deleteEvent(
  opts: Call & { eventId: string; expectMarker: string },
): Promise<void> {
  const doFetch = opts.fetchImpl ?? fetch;

  const marker = await markerOf(opts);
  if (marker !== opts.expectMarker) {
    throw new GoogleEventNotOursError(
      `event ${opts.eventId} carries marker ${marker ?? '(none)'}, expected ${opts.expectMarker}`,
    );
  }

  const res = await doFetch(
    eventsUrl(opts.calendarId, `/${encodeURIComponent(opts.eventId)}`, {
      sendUpdates: SEND_UPDATES,
    }),
    { method: 'DELETE', headers: { authorization: `Bearer ${opts.accessToken}` } },
  );

  // 410 Gone is success for a delete: it is already not there.
  if (res.status === 410) return;
  if (!res.ok) await raiseFor(res, 'delete event');
}
