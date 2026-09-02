import { NextRequest, NextResponse } from 'next/server';
import {
  createPublicAppointment,
  createPublicAppointmentSchema,
  AppointmentInsertError,
  EmailConflictError,
  HoldExpiredError,
  ProfessionalNotFoundError,
  ServiceNotFoundError,
  SlotConflictError,
} from '@/services/public/public-booking.service';
import { createRateLimiter, tupleKey } from '@/lib/rate-limit';
import { validationError, tooManyRequests, conflict, notFound, serviceUnavailable } from '@/lib/problem-details';
import { isTransientBackendFailure, TRANSIENT_RETRY_AFTER_SECONDS } from '@/lib/transient-failure';
import { withRetry } from '@/lib/retry';

export const dynamic = 'force-dynamic';

const limiter = createRateLimiter({ config: { lockoutAfter: 30, windowMs: 15 * 60_000 } });

function clientIp(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    'unknown'
  );
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const parsed = createPublicAppointmentSchema.safeParse(body);
  if (!parsed.success) {
    const p = validationError('invalid_input', parsed.error.issues[0]?.message ?? 'Invalid input');
    return NextResponse.json(p, { status: p.status });
  }

  const key = tupleKey(clientIp(req), parsed.data.clientEmail);
  const verdict = limiter.check(key);
  if (verdict.kind === 'lockout') {
    const retryAfter = Math.ceil(verdict.retryAfterMs / 1000);
    const p = tooManyRequests('rate_limited', retryAfter);
    return NextResponse.json(p, { status: p.status, headers: { 'Retry-After': String(retryAfter) } });
  }

  try {
    // Replayed on its own when the attempt provably wrote nothing — a full connection
    // pool is not something to make the guest press a button about. Only
    // `isRetrySafeFailure` gets replayed; the write is not idempotent.
    const appointment = await withRetry(() => createPublicAppointment(parsed.data));
    limiter.recordSuccess(key);
    return NextResponse.json({ data: appointment }, { status: 201 });
  } catch (err) {
    // Ahead of everything else, including recordFailure: an outage is not the guest's
    // fault, and spending their attempt budget on it would lock them out of the very
    // retry this response asks for. The hold is deliberately left unconsumed too, so
    // the retry can have the same slot back.
    if (isTransientBackendFailure(err)) {
      console.error('[public/appointments] transient backend failure — retryable:', err);
      const p = serviceUnavailable(
        'service_unavailable',
        'The booking service is temporarily unavailable — please try again in a moment',
      );
      return NextResponse.json(p, {
        status: p.status,
        headers: { 'Retry-After': String(TRANSIENT_RETRY_AFTER_SECONDS) },
      });
    }

    limiter.recordFailure(key);
    if (err instanceof HoldExpiredError) {
      const p = conflict('hold_expired', 'Slot no longer available — please select another time');
      return NextResponse.json(p, { status: 410 });
    }
    if (err instanceof SlotConflictError) {
      const p = conflict('slot_conflict', 'Slot no longer available — please select another time');
      return NextResponse.json(p, { status: p.status });
    }
    if (err instanceof EmailConflictError) {
      // The address belongs to a doctor or an admin. Say only that it is taken — who
      // owns it is not a guest's business.
      const p = conflict('email_conflict', 'That email is already registered — please sign in');
      return NextResponse.json(p, { status: p.status });
    }
    if (err instanceof ServiceNotFoundError) {
      const p = notFound('service_not_found', 'Service not found');
      return NextResponse.json(p, { status: p.status });
    }
    if (err instanceof ProfessionalNotFoundError) {
      const p = notFound('professional_not_found', 'Professional not found');
      return NextResponse.json(p, { status: p.status });
    }
    if (err instanceof AppointmentInsertError) {
      console.error('[public/appointments] insert failed:', err.message);
      return NextResponse.json(
        { type: 'about:blank', title: 'Internal Server Error', status: 500 },
        { status: 500 },
      );
    }
    console.error('[public/appointments] unexpected error:', err);
    return NextResponse.json(
      { type: 'about:blank', title: 'Internal Server Error', status: 500 },
      { status: 500 },
    );
  }
}
