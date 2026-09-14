// Where Google sends the browser after the consent screen.
//
// Unauthenticated by necessity: this is a top-level browser navigation initiated
// by Google, so there is no Authorization header to carry. The signed `state` is
// what identifies the professional, which is why it is signed rather than merely
// opaque.
import { NextRequest, NextResponse } from 'next/server';
import { verifyOAuthState } from '@/lib/google/oauth-state';
import { exchangeCodeForTokens, GoogleOAuthError } from '@/lib/google/oauth-client';
import { resolveReturnUrl, configuredReturnUrlAllowlist } from '@/lib/return-url-allowlist';
import { googleOAuthConfig } from '@/lib/google/config';
import { saveConnection } from '@/services/integrations/google-calendar-connection.service';
import { badRequest } from '@/lib/problem-details';

export const dynamic = 'force-dynamic';

/**
 * The result convention the front end proposed: one parameter with a closed set of
 * values, and any detail in a second, optional one. Their reasoning was that
 * separate parameters per outcome force them to handle combinations that cannot
 * happen, and sooner or later somebody forgets a branch.
 */
function back(returnUrl: string, gcal: 'ok' | 'denied' | 'error', reason?: string) {
  const url = new URL(returnUrl);
  url.searchParams.set('gcal', gcal);
  if (reason) url.searchParams.set('reason', reason);
  return NextResponse.redirect(url.toString(), 303);
}

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;

  const state = verifyOAuthState(params.get('state') ?? '');
  if (!state) {
    // Nothing trustworthy says where to send them, so this is the one path that
    // cannot redirect. Redirecting anywhere on an unverified state would be the
    // open redirect the allowlist exists to prevent.
    const p = badRequest('invalid_state', 'This sign-in link has expired or been tampered with.');
    return NextResponse.json(p, { status: p.status });
  }

  // Re-checked rather than trusted from the state. The signature proves we issued
  // it, not that the allowlist still permits it — it may have been tightened since,
  // and the whole point of an allowlist is that it is consulted at use.
  const returnUrl = resolveReturnUrl(state.returnUrl, configuredReturnUrlAllowlist());
  if (!returnUrl) {
    const p = badRequest('return_url_not_allowed', 'That return address is no longer permitted.');
    return NextResponse.json(p, { status: p.status });
  }

  // The professional pressed Cancel, or declined a scope. Not an error.
  const googleError = params.get('error');
  if (googleError) return back(returnUrl, 'denied', googleError);

  const code = params.get('code');
  if (!code) return back(returnUrl, 'error', 'missing_code');

  try {
    const config = googleOAuthConfig();
    const tokens = await exchangeCodeForTokens({ ...config, code });
    await saveConnection({
      professionalId: state.professionalId,
      googleAccountEmail: tokens.email,
      refreshToken: tokens.refreshToken,
      scopeGranted: tokens.scope,
    });
    return back(returnUrl, 'ok');
  } catch (err) {
    // Logged with the professional so it can be traced, but the reason handed back
    // in the URL is a short stable token, not Google's prose: it lands in browser
    // history and server logs the front end does not control.
    console.error('[google-calendar] callback failed', {
      professionalId: state.professionalId,
      error: err instanceof Error ? err.message : String(err),
    });
    const reason = err instanceof GoogleOAuthError ? 'token_exchange_failed' : 'internal_error';
    return back(returnUrl, 'error', reason);
  }
}
