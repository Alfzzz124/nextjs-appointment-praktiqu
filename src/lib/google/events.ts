// Writing appointments into a professional's Google Calendar.
//
// This module holds a write credential over someone's real calendar, which the
// read side deliberately never did. Everything here is therefore built around one
// rule: we only ever touch events that carry our own marker. See `MARKER_KEY`.

import { GoogleOAuthError } from '@/lib/google/oauth-client';
import { GoogleAuthRevokedError } from '@/lib/google/freebusy';

const EVENTS_ENDPOINT = 'https://www.googleapis.com/calendar/v3/calendars';
const CALENDARS_ENDPOINT = 'https://www.googleapis.com/calendar/v3/calendars';

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
  /** Present only for telemed services: asks Google to mint a Meet link. */
  conferenceData?: {
    createRequest: {
      requestId: string;
      conferenceSolutionKey: { type: 'hangoutsMeet' };
    };
  };
}

/** What Google hands back once an event exists. */
export interface CreatedEvent {
  id: string;
  /** Link to the event in Google Calendar. */
  htmlLink: string | null;
  /** The Meet link, when one was asked for and Google made it. */
  hangoutLink: string | null;
  /**
   * Set when a Meet link was asked for and did NOT arrive.
   *
   * The event still exists; only the conference failed. Carried out so the caller
   * can record why rather than leaving a NULL that could equally mean "this was
   * never an online session".
   */
  conferenceError: string | null;
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
): Promise<CreatedEvent> {
  const doFetch = opts.fetchImpl ?? fetch;
  // conferenceDataVersion=1 is required for conferenceData to be honoured at all.
  // Without it Google accepts the request and silently drops the conference, which
  // presents as "Meet just doesn't work" with nothing to debug.
  const query: Record<string, string> = { sendUpdates: SEND_UPDATES };
  if (opts.body.conferenceData) query.conferenceDataVersion = '1';

  const res = await doFetch(eventsUrl(opts.calendarId, '', query), {
    method: 'POST',
    headers: {
      authorization: `Bearer ${opts.accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(opts.body),
  });

  if (!res.ok) await raiseFor(res, 'create event');

  const json = (await res.json()) as {
    id?: unknown;
    htmlLink?: unknown;
    hangoutLink?: unknown;
    conferenceData?: {
      createRequest?: { status?: { statusCode?: unknown } };
    };
  };
  if (typeof json.id !== 'string' || !json.id) {
    throw new GoogleOAuthError('create event returned no id');
  }

  const hangoutLink = typeof json.hangoutLink === 'string' ? json.hangoutLink : null;
  // Google answers with a status code rather than an error when it declines to
  // make the conference, and the event is created either way. A narrower scope
  // than ours may land here, so the caller must be able to tell that apart from a
  // service that never wanted a Meet link.
  const wanted = Boolean(opts.body.conferenceData);
  const code = json.conferenceData?.createRequest?.status?.statusCode;
  const conferenceError =
    wanted && !hangoutLink
      ? `Meet not created (status ${typeof code === 'string' ? code : 'unknown'})`
      : null;

  return {
    id: json.id,
    htmlLink: typeof json.htmlLink === 'string' ? json.htmlLink : null,
    hangoutLink,
    conferenceError,
  };
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

  // This is a PUT, so the body replaces the event. Without conferenceDataVersion
  // the conference block is ignored, and a rescheduled online session would come
  // back without the Meet link the client already has. The requestId is stable per
  // appointment, so sending it again keeps the SAME conference rather than minting
  // a second one.
  const query: Record<string, string> = { sendUpdates: SEND_UPDATES };
  if (opts.body.conferenceData) query.conferenceDataVersion = '1';

  const res = await doFetch(
    eventsUrl(opts.calendarId, `/${encodeURIComponent(opts.eventId)}`, query),
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

/**
 * Create the professional's own "PraktiQu" calendar, once.
 *
 * With `calendar.app.created` this is the only calendar we can ever touch, which
 * is the point: their real calendar is unreachable rather than merely left alone.
 * It also means our own events can never come back to us as busy — `freebusy`
 * reads their primary calendar, and nothing we write lands there.
 *
 * It appears in their calendar list as a separate, tickable calendar they can
 * hide or delete whenever they like. On the Google Calendar phone apps a newly
 * added secondary calendar has to be switched on once before it shows; that is
 * the cost of this scope, and it belongs in the user guide.
 */
export async function createAppCalendar(
  opts: { accessToken: string; timeZone: string; fetchImpl?: typeof fetch },
): Promise<string> {
  const doFetch = opts.fetchImpl ?? fetch;
  const res = await doFetch(CALENDARS_ENDPOINT, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${opts.accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      summary: 'PraktiQu',
      description:
        'Janji dari PraktiQu. Dibuat otomatis — mengubah acara di sini tidak mengubah jadwal di PraktiQu.',
      timeZone: opts.timeZone,
    }),
  });

  if (!res.ok) await raiseFor(res, 'create calendar');

  const json = (await res.json()) as { id?: unknown };
  if (typeof json.id !== 'string' || !json.id) {
    throw new GoogleOAuthError('create calendar returned no id');
  }
  return json.id;
}
