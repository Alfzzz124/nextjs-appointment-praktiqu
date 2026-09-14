// Reading the Google OAuth configuration out of the environment.
//
// One place, so a missing variable is reported the same way everywhere instead of
// surfacing as an undefined creeping into a URL and a baffling error from Google.

export class GoogleConfigError extends Error {
  readonly code = 'GOOGLE_NOT_CONFIGURED';
}

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

/**
 * The redirect URI must match what is registered on the OAuth client character for
 * character — scheme, host, port and path. It is derived from APP_URL rather than
 * from the incoming request: a request-derived value would follow whatever Host
 * header arrived, which both breaks behind a proxy and hands an attacker a say in
 * where Google sends the code.
 */
export function googleRedirectUri(): string {
  const base = process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL;
  if (!base) throw new GoogleConfigError('APP_URL is not set');
  return `${base.replace(/\/+$/, '')}/api/v1/integrations/google-calendar/callback`;
}

export function googleOAuthConfig(): GoogleConfig {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId) throw new GoogleConfigError('GOOGLE_CLIENT_ID is not set');
  if (!clientSecret) throw new GoogleConfigError('GOOGLE_CLIENT_SECRET is not set');
  return { clientId, clientSecret, redirectUri: googleRedirectUri() };
}
