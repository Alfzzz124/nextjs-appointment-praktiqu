/**
 * POST /api/v1/auth/otp/request
 *
 * Mails a one-time sign-in code. Public — no token required.
 *
 * Always answers 200 apart from a malformed body or a rate-limit lockout, so the response
 * cannot be used to discover which addresses are registered.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requestOtp } from '@/services/auth/otp.service';
import { badRequest, tooManyRequests, problemHeaders } from '@/lib/problem-details';
import { createRateLimiter, tupleKey } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

const INSTANCE = '/api/v1/auth/otp/request';

/**
 * Five sends per quarter hour per (IP, address). Every request is counted, whether or not
 * it resulted in mail — counting only the misses would make lockout behaviour differ
 * between registered and unregistered addresses, which is the leak the 200 avoids.
 */
const limiter = createRateLimiter({
  config: {
    windowMs: 15 * 60_000,
    progressiveAfter: 5,
    progressiveDelayMs: 0,
    lockoutAfter: 5,
    lockoutMs: 15 * 60_000,
  },
});

const BodySchema = z.object({ email: z.string().email() });

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
    const p = badRequest('validation_error', 'A valid email address is required', INSTANCE);
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
  if (verdict.kind === 'lockout') {
    const retryAfter = Math.ceil(verdict.retryAfterMs / 1000);
    const p = tooManyRequests('rate_limited', retryAfter, 'Too many code requests', INSTANCE);
    return NextResponse.json(p, { status: p.status, headers: problemHeaders(p) });
  }
  limiter.recordFailure(key);

  const { retryAfterSeconds } = await requestOtp({ email, ip, userAgent });

  return NextResponse.json(
    { message: 'If that email exists, a code has been sent.', retryAfter: retryAfterSeconds },
    { status: 200 },
  );
}
