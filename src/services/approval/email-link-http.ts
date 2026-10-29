/**
 * The HTTP side the three approval-link routes share: one rate limiter keyed by client IP
 * (spec 2026-10-29 §6.4) and the { data } / problem answer. One limiter, not one per route,
 * so a guesser cannot spread attempts over GET and the two POSTs.
 *
 * Only a forged token counts, and only forged tokens are limited. A token whose signature
 * does not verify goes through the limiter and is answered 404 without touching the database;
 * a correctly signed one never meets the limiter, however it then fares (booking moved, no
 * record, psychologist deactivated). Guessing a signature is infeasible, so a signed token
 * needs no throttle, and that is what keeps one shared key safe: while the FE does not vouch
 * for the visitor's IP (src/lib/client-ip.ts) every request carries the FE host's address,
 * so thirty forged links from anyone lock that one key. If genuine links were counted or
 * checked too, that would lock out every psychologist. The FE's own throttle is per visitor
 * and does not help here.
 */
import { NextRequest, NextResponse } from 'next/server';
import { clientIpOrNull } from '@/lib/client-ip';
import { tooManyRequests } from '@/lib/problem-details';
import { verifyApprovalToken } from '@/lib/public/approval-token';
import { createRateLimiter } from '@/lib/rate-limit';
import { invalidLink } from './email-link';
import { approvalErrorResponse } from './http';

const limiter = createRateLimiter({ config: { lockoutAfter: 30, windowMs: 15 * 60_000 } });

export async function linkResponse(
  req: NextRequest,
  tag: string,
  token: string,
  run: () => Promise<unknown>,
): Promise<NextResponse> {
  if (verifyApprovalToken(token) === null) {
    const key = clientIpOrNull(req.headers) ?? 'unknown';
    const verdict = limiter.check(key);
    if (verdict.kind === 'lockout') {
      const retryAfter = Math.ceil(verdict.retryAfterMs / 1000);
      const p = tooManyRequests('rate_limited', retryAfter);
      return NextResponse.json(p, { status: p.status, headers: { 'Retry-After': String(retryAfter) } });
    }
    limiter.recordFailure(key);
    return approvalErrorResponse(invalidLink(), tag);
  }

  try {
    return NextResponse.json({ data: await run() }, { status: 200 });
  } catch (err) {
    return approvalErrorResponse(err, tag);
  }
}
