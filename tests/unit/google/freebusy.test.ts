/**
 * Refreshing an access token and asking Google when someone is busy.
 *
 * The distinction the tests care most about: `invalid_grant` means the
 * authorisation is gone, which is a calm "reconnect", not a failure. While the
 * Google app is in Testing that happens to every professional every 7 days, so
 * conflating it with a real error would fill the settings page with red warnings
 * weekly and generate a bug report each Monday.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  refreshAccessToken,
  queryFreeBusy,
  GoogleAuthRevokedError,
} from '@/lib/google/freebusy';
import { GoogleOAuthError } from '@/lib/google/oauth-client';

const CREDS = { clientId: 'cid', clientSecret: 'secret', refreshToken: 'rt' };
const json = (body: unknown, status = 200) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status }));

describe('refreshAccessToken', () => {
  it('exchanges the refresh token for an access token', async () => {
    const fetchImpl = json({ access_token: 'at-1', expires_in: 3599 });
    expect(await refreshAccessToken(CREDS, fetchImpl)).toBe('at-1');

    const sent = new URLSearchParams((fetchImpl.mock.calls[0] as never[])[1]['body']);
    expect(sent.get('grant_type')).toBe('refresh_token');
    expect(sent.get('refresh_token')).toBe('rt');
  });

  it('reports a revoked authorisation as its own thing, not a failure', async () => {
    const fetchImpl = json({ error: 'invalid_grant' }, 400);
    await expect(refreshAccessToken(CREDS, fetchImpl)).rejects.toBeInstanceOf(
      GoogleAuthRevokedError,
    );
  });

  it('treats other refusals as ordinary errors', async () => {
    const fetchImpl = json({ error: 'invalid_client' }, 401);
    const err = await refreshAccessToken(CREDS, fetchImpl).catch((e) => e);
    expect(err).toBeInstanceOf(GoogleOAuthError);
    expect(err).not.toBeInstanceOf(GoogleAuthRevokedError);
  });

  it('never puts the client secret in the error it throws', async () => {
    const fetchImpl = json({ error: 'invalid_client' }, 401);
    let message = '';
    try {
      await refreshAccessToken(CREDS, fetchImpl);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).not.toBe('');
    expect(message).not.toContain('secret');
  });
});

describe('queryFreeBusy', () => {
  const RANGE = {
    accessToken: 'at-1',
    calendarIds: ['primary'],
    timeMin: new Date('2026-09-20T00:00:00Z'),
    timeMax: new Date('2026-09-21T00:00:00Z'),
  };

  it('returns the busy intervals as instants', async () => {
    const fetchImpl = json({
      calendars: {
        primary: {
          busy: [{ start: '2026-09-20T07:00:00Z', end: '2026-09-20T08:00:00Z' }],
        },
      },
    });
    const out = await queryFreeBusy(RANGE, fetchImpl);
    expect(out).toEqual([
      { start: new Date('2026-09-20T07:00:00Z'), end: new Date('2026-09-20T08:00:00Z') },
    ]);
  });

  it('asks only about the calendars it was given', async () => {
    const fetchImpl = json({ calendars: {} });
    await queryFreeBusy({ ...RANGE, calendarIds: ['primary', 'work@x'] }, fetchImpl);
    const body = JSON.parse((fetchImpl.mock.calls[0] as never[])[1]['body']);
    expect(body.items).toEqual([{ id: 'primary' }, { id: 'work@x' }]);
    expect(body.timeMin).toBe('2026-09-20T00:00:00.000Z');
  });

  it('gathers intervals from every calendar asked about', async () => {
    const fetchImpl = json({
      calendars: {
        primary: { busy: [{ start: '2026-09-20T07:00:00Z', end: '2026-09-20T08:00:00Z' }] },
        'work@x': { busy: [{ start: '2026-09-20T09:00:00Z', end: '2026-09-20T10:00:00Z' }] },
      },
    });
    expect(await queryFreeBusy({ ...RANGE, calendarIds: ['primary', 'work@x'] }, fetchImpl)).toHaveLength(2);
  });

  it('keeps the calendars that answered when one of them errors', async () => {
    // A calendar that was deleted or unshared must not cost us the others: the
    // alternative is one stale id silently unblocking the professional's day.
    const fetchImpl = json({
      calendars: {
        primary: { busy: [{ start: '2026-09-20T07:00:00Z', end: '2026-09-20T08:00:00Z' }] },
        gone: { errors: [{ domain: 'global', reason: 'notFound' }] },
      },
    });
    expect(await queryFreeBusy({ ...RANGE, calendarIds: ['primary', 'gone'] }, fetchImpl)).toHaveLength(1);
  });

  it('skips an interval Google returns without usable times', async () => {
    const fetchImpl = json({
      calendars: { primary: { busy: [{ start: 'not-a-date', end: '2026-09-20T08:00:00Z' }] } },
    });
    expect(await queryFreeBusy(RANGE, fetchImpl)).toEqual([]);
  });

  it('reports an expired access token as revoked so the caller can reconnect', async () => {
    const fetchImpl = json({ error: { code: 401, message: 'Invalid Credentials' } }, 401);
    await expect(queryFreeBusy(RANGE, fetchImpl)).rejects.toBeInstanceOf(GoogleAuthRevokedError);
  });

  it('raises other failures as ordinary errors', async () => {
    const fetchImpl = json({ error: { code: 500 } }, 500);
    await expect(queryFreeBusy(RANGE, fetchImpl)).rejects.toBeInstanceOf(GoogleOAuthError);
  });
});
