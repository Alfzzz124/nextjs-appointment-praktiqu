// Start the Google Calendar consent flow.
//
// Returns a URL for the caller to navigate the browser to. It does not redirect
// itself: the front end may want to warn the professional first, and a fetch that
// answers 302 to a cross-origin consent screen is awkward for them to handle.
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withAuth } from '@/lib/auth';
import { resolveKcActor } from '@/services/billing/kc-actor';
import { buildConsentUrl } from '@/lib/google/oauth-client';
import { signOAuthState } from '@/lib/google/oauth-state';
import { resolveReturnUrl, configuredReturnUrlAllowlist } from '@/lib/return-url-allowlist';
import { googleOAuthConfig, GoogleConfigError } from '@/lib/google/config';
import { validationError, forbidden, serviceUnavailable } from '@/lib/problem-details';

export const dynamic = 'force-dynamic';

const schema = z.object({
  /** Where to send the browser afterwards. Checked against the allowlist. */
  returnUrl: z.string().min(1),
});

export const POST = withAuth(async (req: NextRequest, { actor }) => {
  if (actor.role !== 'PROFESSIONAL') {
    // A professional connects their own calendar. Nobody connects it for them —
    // the consent screen is theirs to read and their credential to grant.
    const p = forbidden('not_a_professional', 'Only a professional can connect a calendar');
    return NextResponse.json(p, { status: p.status });
  }

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    const p = validationError('invalid_input', parsed.error.issues[0]?.message ?? 'Invalid input');
    return NextResponse.json(p, { status: p.status });
  }

  const returnUrl = resolveReturnUrl(parsed.data.returnUrl, configuredReturnUrlAllowlist());
  if (!returnUrl) {
    // Refused, not quietly replaced with a default. A silent fallback would turn a
    // misconfigured allowlist into a redirect that looks plausible.
    const p = validationError('return_url_not_allowed', 'That returnUrl is not permitted');
    return NextResponse.json(p, { status: p.status });
  }

  let config;
  try {
    config = googleOAuthConfig();
  } catch (err) {
    if (!(err instanceof GoogleConfigError)) throw err;
    console.error('[google-calendar] not configured:', err.message);
    const p = serviceUnavailable(
      'google_not_configured',
      'Calendar sync is not configured on this server.',
    );
    return NextResponse.json(p, { status: p.status });
  }

  const { wpUserId } = await resolveKcActor(actor);
  const state = signOAuthState({ professionalId: Number(wpUserId), returnUrl });

  return NextResponse.json({
    url: buildConsentUrl({
      clientId: config.clientId,
      redirectUri: config.redirectUri,
      state,
    }),
  });
});
