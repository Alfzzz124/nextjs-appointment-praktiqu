/**
 * The HTTP side the three approval-link routes share: one rate limiter keyed by client IP
 * (spec 2026-10-29 §6.4) and the { data } / problem answer. One limiter, not one per route,
 * so a guesser cannot spread attempts over GET and the two POSTs.
 *
 * Only an invalid link counts as a failure. While the FE does not vouch for the visitor's
 * IP (src/lib/client-ip.ts), every request looks like the FE host, so the FE's own throttle
 * is the limit that bites first.
 */
import { NextRequest, NextResponse } from 'next/server';
import { clientIpOrNull } from '@/lib/client-ip';
import { tooManyRequests } from '@/lib/problem-details';
import { createRateLimiter } from '@/lib/rate-limit';
import { approvalErrorResponse } from './http';
import { ApprovalError } from './service';

const limiter = createRateLimiter({ config: { lockoutAfter: 30, windowMs: 15 * 60_000 } });

export async function linkResponse(req: NextRequest, tag: string, run: () => Promise<unknown>): Promise<NextResponse> {
  const key = clientIpOrNull(req.headers) ?? 'unknown';
  const verdict = limiter.check(key);
  if (verdict.kind === 'lockout') {
    const retryAfter = Math.ceil(verdict.retryAfterMs / 1000);
    const p = tooManyRequests('rate_limited', retryAfter);
    return NextResponse.json(p, { status: p.status, headers: { 'Retry-After': String(retryAfter) } });
  }
  try {
    const data = await run();
    limiter.recordSuccess(key);
    return NextResponse.json({ data }, { status: 200 });
  } catch (err) {
    if (err instanceof ApprovalError && err.code === 'approval_link_invalid') limiter.recordFailure(key);
    return approvalErrorResponse(err, tag);
  }
}
