/**
 * POST /api/v1/auth/otp/verify
 *
 * Trades a one-time code for a session. Public — no token required.
 *
 * The success body matches POST /api/v1/auth/login exactly, so a client stores the session
 * the same way whichever route it used to sign in.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { verifyOtp } from '@/services/auth/otp.service';
import {
  badRequest,
  forbidden,
  tooManyRequests,
  problem,
  problemHeaders,
} from '@/lib/problem-details';
import { createRateLimiter, DEFAULT_RATE_LIMIT_CONFIG, tupleKey } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

const INSTANCE = '/api/v1/auth/otp/verify';

// Mirrors the default in src/lib/problem-details.ts — that module doesn't export the base,
// and none of its status-specific helpers answer 500, so the type URI is built the same way.
const PROBLEM_BASE = process.env.PROBLEM_TYPE_BASE ?? 'https://praktiqu.example.com/problems';

/** Guessing protection on top of the per-code attempt counter: the counter stops a single
 *  code being brute-forced, this stops an attacker cycling through fresh codes. */
const limiter = createRateLimiter({ config: DEFAULT_RATE_LIMIT_CONFIG });

const BodySchema = z.object({
  email: z.string().email(),
  code: z.string().regex(/^\d{6}$/),
});

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    const p = badRequest('invalid_body', 'Request body must be valid JSON', INSTANCE);
    return NextResponse.json(p, { status: p.status, headers: problemHeaders(p) });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    const p = badRequest('validation_error', 'A valid email and a 6-digit code are required', INSTANCE);
    return NextResponse.json(p, { status: p.status, headers: problemHeaders(p) });
  }

  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    '0.0.0.0';
  const userAgent = req.headers.get('user-agent') ?? 'unknown';
  const email = parsed.data.email.trim().toLowerCase();

  const key = tupleKey(ip, email);
  const verdict = limiter.check(key);
  // Refuse anything that is not an explicit allow rather than enumerating verdict kinds:
  // acting only on 'lockout' would leave failed attempts between progressiveAfter and
  // lockoutAfter completely unthrottled, which is exactly the cycling this limiter exists
  // to stop.
  if (verdict.kind !== 'allow') {
    const retryAfterMs = verdict.kind === 'lockout' ? verdict.retryAfterMs : verdict.delayMs;
    const retryAfter = Math.ceil(retryAfterMs / 1000);
    const p = tooManyRequests('rate_limited', retryAfter, 'Too many attempts', INSTANCE);
    return NextResponse.json(p, { status: p.status, headers: problemHeaders(p) });
  }

  try {
    const result = await verifyOtp({ email, code: parsed.data.code, ip, userAgent });
    limiter.recordSuccess(key);

    // `wpUserId` is a Prisma BigInt, which JSON.stringify cannot serialise — WP user ids
    // are always small integers, so a plain number is safe.
    const { wpUserId, ...userRest } = result.user;
    return NextResponse.json(
      {
        user: { ...userRest, wpUserId: wpUserId == null ? null : Number(wpUserId) },
        accessToken: result.accessToken,
        accessTokenExpiresAt: result.accessTokenExpiresAt.toISOString(),
        refreshToken: result.refreshToken,
        refreshTokenExpiresAt: result.refreshTokenExpiresAt.toISOString(),
      },
      { status: 200 },
    );
  } catch (err) {
    limiter.recordFailure(key);

    const code = (err as { code?: string }).code ?? 'unknown';
    const status = (err as { status?: number }).status ?? 500;

    if (code === 'account_inactive') {
      const p = forbidden('account_inactive', 'Account is inactive', INSTANCE);
      return NextResponse.json(p, { status: p.status, headers: problemHeaders(p) });
    }
    if (status === 400) {
      const p = badRequest(code, (err as Error).message, INSTANCE);
      return NextResponse.json(p, { status: p.status, headers: problemHeaders(p) });
    }

    // Logs the error object only — never the submitted code or request body — so a stack
    // trace or driver message can reach the server log without leaking a guessable OTP.
    console.error('[auth/otp/verify] unexpected error:', err);
    const p = problem({
      type: `${PROBLEM_BASE}/internal-server-error`,
      title: 'Internal Server Error',
      status: 500,
      code: 'internal_error',
      instance: INSTANCE,
    });
    return NextResponse.json(p, { status: p.status, headers: problemHeaders(p) });
  }
}
