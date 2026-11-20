// src/app/api/v1/public/booking/hold/route.ts
// Create a 15-min hold for a slot, or GET the remaining time.
import { NextRequest, NextResponse } from 'next/server';
import { slotHoldService } from '@/services/booking/slot-hold.service';
import { z } from 'zod';
import { forwardedClientIp } from '@/lib/client-ip';
import { createRateLimiter } from '@/lib/rate-limit';
import { tooManyRequests } from '@/lib/problem-details';

// The ids end up inside the hold key and the date/time are compared as text, so the
// shapes are pinned down: this endpoint is public and stores whatever passes.
const holdSchema = z.object({
  professionalId: z.string().regex(/^\d{1,10}$/, 'professionalId must be numeric'),
  serviceId: z.string().regex(/^\d{1,10}$/, 'serviceId must be numeric'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
  startTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, 'startTime must be HH:MM'),
});

// Every request counts, not only failures: a hold is cheap to ask for and lives 15
// minutes, so volume itself is the abuse. Only an address the FE vouched for is limited
// (src/lib/client-ip.ts). Unvouched, the address is the first X-Forwarded-For entry,
// which any caller can set, and every patient the FE relays shares the FE host's address;
// a lockout keyed on it would let one forger refuse every patient's booking. Generous,
// because carrier-grade NAT puts many patients behind one public address. Memory does
// not depend on this limit: the slot-hold map is capped on its own.
const limiter = createRateLimiter({
  config: { lockoutAfter: 600, windowMs: 15 * 60_000, progressiveAfter: Number.MAX_SAFE_INTEGER },
});

export async function POST(req: NextRequest) {
  const ip = forwardedClientIp(req.headers);
  if (ip) {
    const verdict = limiter.check(ip);
    if (verdict.kind === 'lockout') {
      const retryAfter = Math.ceil(verdict.retryAfterMs / 1000);
      const p = tooManyRequests('rate_limited', retryAfter);
      return NextResponse.json(p, { status: p.status, headers: { 'Retry-After': String(retryAfter) } });
    }
    limiter.recordFailure(ip);
  }

  try {
    // A body that is not JSON is the caller's mistake: 400 via the schema, not a 500.
    const body = await req.json().catch(() => ({}));
    const parsed = holdSchema.parse(body);
    // A signed token, valid on every worker process (see slot-hold.service.ts).
    const hold = slotHoldService.create({
      professionalId: parsed.professionalId,
      serviceId: parsed.serviceId,
      date: parsed.date,
      startTime: parsed.startTime,
    });
    return NextResponse.json({ holdKey: hold.key, expiresAt: hold.expiresAt }, { status: 201 });
  } catch (err: any) {
    if (err?.name === 'ZodError') {
      return NextResponse.json(
        { type: 'about:blank', title: 'Validation failed', status: 400, errors: err.errors },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { type: 'about:blank', title: 'Internal Server Error', status: 500 },
      { status: 500 },
    );
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const key = searchParams.get('key') ?? '';
  const data = slotHoldService.getWithRemaining(key);
  if (!data) {
    return NextResponse.json(
      { type: 'about:blank', title: 'Hold expired or not found', status: 410 },
      { status: 410 },
    );
  }
  return NextResponse.json({ remainingSec: data.remainingSec, expiresAt: data.hold.expiresAt });
}