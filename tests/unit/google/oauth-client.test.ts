/**
 * Building Google's consent URL and exchanging the code it returns.
 *
 * The network call is injected, so these cover the request we actually send and
 * what we make of the answer — including the answers that are not tokens.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  GOOGLE_SCOPES,
  buildConsentUrl,
  exchangeCodeForTokens,
  GoogleOAuthError,
} from '@/lib/google/oauth-client';

const CONFIG = {
  clientId: 'cid.apps.googleusercontent.com',
  clientSecret: 'secret',
  redirectUri: 'https://staging2.praktiqu.com/api/v1/integrations/google-calendar/callback',
};

/** A minimal unsigned JWT — only the payload is ever read. */
function idToken(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o), 'utf8').toString('base64url');
  return `${b64({ alg: 'RS256' })}.${b64(payload)}.signature`;
}

function okFetch(body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
}

describe('buildConsentUrl', () => {
  const url = new URL(buildConsentUrl({ ...CONFIG, state: 'STATE' }));

  it('points at Google', () => {
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
  });

  it('asks only for free/busy, plus the identity needed to name the account', () => {
    // calendar.freebusy returns opaque busy intervals and no event content. openid
    // and email are how the settings page can say WHICH Google account is linked,
    // which is the likeliest setup mistake to make.
    expect(url.searchParams.get('scope')).toBe(GOOGLE_SCOPES.join(' '));
    expect(GOOGLE_SCOPES).toContain('https://www.googleapis.com/auth/calendar.freebusy');
    expect(GOOGLE_SCOPES).not.toContain('https://www.googleapis.com/auth/calendar');
    expect(GOOGLE_SCOPES).not.toContain('https://www.googleapis.com/auth/calendar.readonly');
  });

  it('asks for a refresh token, every time', () => {
    // Without access_type=offline there is no refresh token at all, and without
    // prompt=consent Google withholds it on a re-authorisation — which is exactly
    // what happens weekly while the app is in Testing.
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('prompt')).toBe('consent');
    expect(url.searchParams.get('response_type')).toBe('code');
  });

  it('carries the state and the exact redirect URI', () => {
    expect(url.searchParams.get('state')).toBe('STATE');
    expect(url.searchParams.get('redirect_uri')).toBe(CONFIG.redirectUri);
    expect(url.searchParams.get('client_id')).toBe(CONFIG.clientId);
  });
});

describe('exchangeCodeForTokens', () => {
  it('posts the code to Google and returns the refresh token and email', async () => {
    const fetchImpl = okFetch({
      refresh_token: 'rt-123',
      scope: 'openid email https://www.googleapis.com/auth/calendar.freebusy',
      id_token: idToken({ email: 'dr@gmail.com' }),
    });

    const result = await exchangeCodeForTokens({ ...CONFIG, code: 'CODE' }, fetchImpl);

    expect(result.refreshToken).toBe('rt-123');
    expect(result.email).toBe('dr@gmail.com');
    expect(result.scope).toContain('calendar.freebusy');

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://oauth2.googleapis.com/token');
    expect(init.method).toBe('POST');
    const sent = new URLSearchParams(init.body as string);
    expect(sent.get('code')).toBe('CODE');
    expect(sent.get('grant_type')).toBe('authorization_code');
    expect(sent.get('redirect_uri')).toBe(CONFIG.redirectUri);
  });

  it('fails when Google returns no refresh token', async () => {
    // Happens when consent was already granted and prompt=consent was not sent.
    // Storing the connection without one would leave it dead on first use.
    const fetchImpl = okFetch({ id_token: idToken({ email: 'dr@gmail.com' }) });
    await expect(
      exchangeCodeForTokens({ ...CONFIG, code: 'CODE' }, fetchImpl),
    ).rejects.toBeInstanceOf(GoogleOAuthError);
  });

  it('fails when Google cannot identify the account', async () => {
    const fetchImpl = okFetch({ refresh_token: 'rt-123' });
    await expect(
      exchangeCodeForTokens({ ...CONFIG, code: 'CODE' }, fetchImpl),
    ).rejects.toBeInstanceOf(GoogleOAuthError);
  });

  it('fails on an error response from Google', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 }),
    );
    await expect(
      exchangeCodeForTokens({ ...CONFIG, code: 'CODE' }, fetchImpl),
    ).rejects.toBeInstanceOf(GoogleOAuthError);
  });

  it('does not put the client secret in the error it throws', async () => {
    const fetchImpl = vi.fn(
      async () => new Response('upstream exploded', { status: 500 }),
    );
    let message = '';
    try {
      await exchangeCodeForTokens({ ...CONFIG, code: 'CODE' }, fetchImpl);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).not.toBe('');
    expect(message).not.toContain(CONFIG.clientSecret);
  });
});
