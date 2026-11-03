// Talking to Google's OAuth endpoints.
//
// Deliberately small: build the consent URL, exchange the code. No SDK, because
// the whole surface we need is two URLs and a form post, and googleapis would pull
// in a dependency far larger than the thing it replaces.

/** Anything Google refused, or answered in a shape we cannot use. */
export class GoogleOAuthError extends Error {
  readonly code = 'GOOGLE_OAUTH_FAILED';
}

const CONSENT_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

/**
 * What we ask for, and nothing more.
 *
 * `calendar.freebusy` returns opaque busy intervals — no titles, no descriptions,
 * no attendees. A psychologist's personal calendar plausibly holds other clients'
 * names, and this is a health application; the narrower scope makes that a
 * structural guarantee rather than a promise about what we remember not to read.
 *
 * `openid` and `email` are how the settings page can show WHICH Google account is
 * linked. People have several, and linking the wrong one is the likeliest setup
 * mistake. Both are non-sensitive and add nothing to the verification burden.
 */
export const GOOGLE_SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/calendar.freebusy',
] as const;

/**
 * What writing appointments back needs, asked for SEPARATELY.
 *
 * `calendar.app.created` and NOT `calendar.events`, and the difference is the whole
 * shape of this feature. It grants access to calendars this application itself
 * created and to nothing else — a professional's real calendar is out of reach
 * structurally, not merely by our promising not to touch it. `calendar.events`
 * would hand us read-write over every appointment they have.
 *
 * It is also the cheaper one. In this project's Cloud Console, `calendar.events`
 * carries the sensitive padlock and `calendar.app.created` does not, which is weeks
 * of verification against none. Both facts point the same way, so there is no
 * trade-off to weigh here.
 *
 * Still asked for separately from GOOGLE_SCOPES: a second consent is a second
 * decision, and `include_granted_scopes=true` carries the first one forward.
 */
export const GOOGLE_WRITE_SCOPES = [
  'https://www.googleapis.com/auth/calendar.app.created',
] as const;

const BROAD_CALENDAR = 'https://www.googleapis.com/auth/calendar';

/** Did this grant actually include the write scope? */
export function grantsWriteScope(scopeGranted: string): boolean {
  const granted = new Set(scopeGranted.split(/\s+/).filter(Boolean));
  return GOOGLE_WRITE_SCOPES.every((s) => granted.has(s)) || granted.has(BROAD_CALENDAR);
}

/**
 * The grant is WIDER than what this application asks for.
 *
 * Google carries previously-granted scopes forward through
 * `include_granted_scopes`, so someone who once allowed the broad `calendar`
 * scope — through an older integration, or an earlier version of this one — keeps
 * handing us read-write over their entire real calendar even though we now only
 * request `calendar.app.created`.
 *
 * That still works, and refusing it outright would strand events we already
 * created with nothing able to update or delete them. But it must not pass
 * silently: the settings page tells people their personal calendar cannot be
 * touched, and for these connections that sentence is not true until they revoke
 * and reconnect. Disconnecting alone does not clear it — the grant lives on
 * Google's side.
 */
export function usesBroadCalendarScope(scopeGranted: string): boolean {
  const granted = new Set(scopeGranted.split(/\s+/).filter(Boolean));
  return granted.has(BROAD_CALENDAR) && !GOOGLE_WRITE_SCOPES.every((s) => granted.has(s));
}

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  /** Must match a URI registered on the OAuth client, character for character. */
  redirectUri: string;
}

export function buildConsentUrl(
  opts: Omit<GoogleOAuthConfig, 'clientSecret'> & {
    state: string;
    /**
     * Ask for the write scope on top of the read ones. Defaults to false, so the
     * ordinary "connect my calendar" path is untouched and never meets the
     * unverified-app screen that an unverified sensitive scope brings with it.
     */
    withWrite?: boolean;
  },
): string {
  const scopes = opts.withWrite
    ? [...GOOGLE_SCOPES, ...GOOGLE_WRITE_SCOPES]
    : [...GOOGLE_SCOPES];
  const url = new URL(CONSENT_ENDPOINT);
  url.searchParams.set('client_id', opts.clientId);
  url.searchParams.set('redirect_uri', opts.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', scopes.join(' '));
  // Without access_type=offline there is no refresh token at all. Without
  // prompt=consent Google withholds it on a RE-authorisation — which is exactly
  // what every professional does weekly while the app is in Testing, so omitting
  // it would break precisely the common case.
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('include_granted_scopes', 'true');
  url.searchParams.set('state', opts.state);
  return url.toString();
}

export interface ExchangedTokens {
  refreshToken: string;
  email: string;
  scope: string;
}

/**
 * Read the payload of Google's id_token.
 *
 * Not verified, and it does not need to be: this token came straight back from
 * Google's own endpoint over TLS in a server-to-server request we initiated. There
 * is no third party in the path to have forged it. (A token arriving from a
 * browser would be another matter entirely.)
 */
function emailFromIdToken(idToken: unknown): string | null {
  if (typeof idToken !== 'string') return null;
  const payload = idToken.split('.')[1];
  if (!payload) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return typeof claims.email === 'string' ? claims.email : null;
  } catch {
    return null;
  }
}

export async function exchangeCodeForTokens(
  opts: GoogleOAuthConfig & { code: string },
  fetchImpl: typeof fetch = fetch,
): Promise<ExchangedTokens> {
  const body = new URLSearchParams({
    code: opts.code,
    client_id: opts.clientId,
    client_secret: opts.clientSecret,
    redirect_uri: opts.redirectUri,
    grant_type: 'authorization_code',
  });

  const res = await fetchImpl(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    // The status and Google's own error code are useful; the request body is not,
    // and it holds the client secret. Never widen this to include `body`.
    let googleCode = 'unknown';
    try {
      googleCode = (await res.clone().json())?.error ?? 'unknown';
    } catch {
      /* a non-JSON error page tells us nothing more than the status */
    }
    throw new GoogleOAuthError(`Google rejected the code exchange (${res.status}: ${googleCode})`);
  }

  const json = (await res.json()) as Record<string, unknown>;

  const refreshToken = json.refresh_token;
  if (typeof refreshToken !== 'string' || !refreshToken) {
    // Storing a connection without one would leave it dead at first use, and the
    // professional would have no idea why their calendar never blocked anything.
    throw new GoogleOAuthError('Google returned no refresh token');
  }

  const email = emailFromIdToken(json.id_token);
  if (!email) {
    throw new GoogleOAuthError('Google returned no account email');
  }

  return {
    refreshToken,
    email,
    scope: typeof json.scope === 'string' ? json.scope : GOOGLE_SCOPES.join(' '),
  };
}
