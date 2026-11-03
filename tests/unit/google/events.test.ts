/**
 * Writing into somebody's real Google Calendar.
 *
 * The read side never held a write credential; this module does. Every test below
 * exists to pin one rule down: we touch only events carrying our own marker. The
 * one unacceptable failure is editing or deleting a psychologist's genuine
 * appointment because a stored id was stale and we assumed.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  createEvent,
  updateEvent,
  deleteEvent,
  markerOf,
  MARKER_KEY,
  GoogleTransientError,
  GoogleEventGoneError,
  GoogleEventNotOursError,
} from '@/lib/google/events';
import { GoogleAuthRevokedError } from '@/lib/google/freebusy';
import { GoogleOAuthError } from '@/lib/google/oauth-client';

const BODY = {
  summary: 'Konseling Individu — Rina Pratiwi',
  description: 'Layanan: Konseling Individu',
  start: { dateTime: '2026-11-04T14:00:00', timeZone: 'Asia/Jakarta' },
  end: { dateTime: '2026-11-04T15:00:00', timeZone: 'Asia/Jakarta' },
  attendees: [{ email: 'rina@gmail.com' }],
  extendedProperties: { private: { [MARKER_KEY]: '4821' } },
};

const CALL = { accessToken: 'at', calendarId: 'primary' };

/** Replies in order, so a GET-then-PUT pair can be scripted. */
function replies(...bodies: [unknown, number?][]) {
  const fn = vi.fn();
  for (const [body, status] of bodies) {
    const code = status ?? 200;
    // 204 dan 304 tidak boleh membawa badan; Response menolaknya.
    const payload = code === 204 || code === 304 ? null : JSON.stringify(body);
    fn.mockResolvedValueOnce(new Response(payload, { status: code }));
  }
  return fn;
}

const ours = { status: 'confirmed', extendedProperties: { private: { [MARKER_KEY]: '4821' } } };

describe('createEvent', () => {
  it('returns the id Google assigns', async () => {
    const fetchImpl = replies([{ id: 'evt-1' }]);
    expect(await createEvent({ ...CALL, body: BODY, fetchImpl })).toBe('evt-1');
  });

  it('asks Google to notify the attendees', async () => {
    // An invitation nobody is told about is not one, and inviting the client was
    // the whole product decision.
    const fetchImpl = replies([{ id: 'evt-1' }]);
    await createEvent({ ...CALL, body: BODY, fetchImpl });
    expect(String(fetchImpl.mock.calls[0][0])).toContain('sendUpdates=all');
  });

  it('refuses a 200 that carries no id rather than inventing one', async () => {
    const fetchImpl = replies([{ ok: true }]);
    await expect(createEvent({ ...CALL, body: BODY, fetchImpl })).rejects.toBeInstanceOf(
      GoogleOAuthError,
    );
  });
});

describe('error classification', () => {
  it('treats 401 and 403 as a dead authorisation', async () => {
    for (const status of [401, 403]) {
      const fetchImpl = replies([{ error: 'nope' }, status] as [unknown, number]);
      await expect(createEvent({ ...CALL, body: BODY, fetchImpl })).rejects.toBeInstanceOf(
        GoogleAuthRevokedError,
      );
    }
  });

  it('treats 429 and 5xx as worth retrying', async () => {
    // Distinct from a permanent failure because the sweep backs off for these and
    // gives up on the others; conflating them either hammers Google or abandons
    // work over a blip.
    for (const status of [429, 500, 503]) {
      const fetchImpl = replies([{ error: 'busy' }, status] as [unknown, number]);
      await expect(createEvent({ ...CALL, body: BODY, fetchImpl })).rejects.toBeInstanceOf(
        GoogleTransientError,
      );
    }
  });

  it('treats a plain 400 as permanent', async () => {
    const fetchImpl = replies([{ error: 'badRequest' }, 400] as [unknown, number]);
    await expect(createEvent({ ...CALL, body: BODY, fetchImpl })).rejects.toBeInstanceOf(
      GoogleOAuthError,
    );
  });
});

describe('markerOf', () => {
  it('reads our marker back', async () => {
    const fetchImpl = replies([ours]);
    expect(await markerOf({ ...CALL, eventId: 'evt-1', fetchImpl })).toBe('4821');
  });

  it('returns null for an event that has no marker', async () => {
    const fetchImpl = replies([{ status: 'confirmed' }]);
    expect(await markerOf({ ...CALL, eventId: 'evt-1', fetchImpl })).toBeNull();
  });

  it('treats a cancelled event as gone even though Google answers 200', async () => {
    // Left unhandled this would make us "update" a tombstone and report success
    // for an event nobody can see.
    const fetchImpl = replies([{ ...ours, status: 'cancelled' }]);
    await expect(markerOf({ ...CALL, eventId: 'evt-1', fetchImpl })).rejects.toBeInstanceOf(
      GoogleEventGoneError,
    );
  });
});

describe('updateEvent', () => {
  it('writes once the event proves to be ours', async () => {
    const fetchImpl = replies([ours], [{ id: 'evt-1' }]);
    await updateEvent({ ...CALL, eventId: 'evt-1', body: BODY, fetchImpl, expectMarker: '4821' });
    expect(fetchImpl.mock.calls[1][1].method).toBe('PUT');
  });

  it('REFUSES to touch an event that is not ours', async () => {
    const fetchImpl = replies([{ status: 'confirmed' }]);
    await expect(
      updateEvent({ ...CALL, eventId: 'evt-1', body: BODY, fetchImpl, expectMarker: '4821' }),
    ).rejects.toBeInstanceOf(GoogleEventNotOursError);
    // The guarantee: one call made, and it was the read.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('REFUSES when the marker belongs to a different appointment', async () => {
    const theirs = { status: 'confirmed', extendedProperties: { private: { [MARKER_KEY]: '999' } } };
    const fetchImpl = replies([theirs]);
    await expect(
      updateEvent({ ...CALL, eventId: 'evt-1', body: BODY, fetchImpl, expectMarker: '4821' }),
    ).rejects.toBeInstanceOf(GoogleEventNotOursError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('reports a deleted event as gone, so the caller can recreate it', async () => {
    const fetchImpl = replies([{ error: 'notFound' }, 404] as [unknown, number]);
    await expect(
      updateEvent({ ...CALL, eventId: 'evt-1', body: BODY, fetchImpl, expectMarker: '4821' }),
    ).rejects.toBeInstanceOf(GoogleEventGoneError);
  });
});

describe('deleteEvent', () => {
  it('deletes once the event proves to be ours', async () => {
    const fetchImpl = replies([ours], [{}, 204] as [unknown, number]);
    await deleteEvent({ ...CALL, eventId: 'evt-1', fetchImpl, expectMarker: '4821' });
    expect(fetchImpl.mock.calls[1][1].method).toBe('DELETE');
  });

  it('REFUSES to delete an event that is not ours', async () => {
    // The worst outcome this module could produce: removing a real appointment
    // from somebody's calendar.
    const fetchImpl = replies([{ status: 'confirmed' }]);
    await expect(
      deleteEvent({ ...CALL, eventId: 'evt-1', fetchImpl, expectMarker: '4821' }),
    ).rejects.toBeInstanceOf(GoogleEventNotOursError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('counts an already-gone event as success', async () => {
    const fetchImpl = replies([ours], [{}, 410] as [unknown, number]);
    await expect(
      deleteEvent({ ...CALL, eventId: 'evt-1', fetchImpl, expectMarker: '4821' }),
    ).resolves.toBeUndefined();
  });
});
