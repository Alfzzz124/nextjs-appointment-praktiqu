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
  UpstreamWriteError,
} from '@/services/public/public-booking.service';
import { createRateLimiter, tupleKey } from '@/lib/rate-limit';
import { WpConfigError } from '@/lib/wp-endpoint';
import {
  validationError,
  tooManyRequests,
  conflict,
  notFound,
  serviceUnavailable,
} from '@/lib/problem-details';
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
    /* ------------------------------------------------------------------------- *
     * Not the guest's fault. Answered ahead of `recordFailure`, because advising
     * a retry while charging it against a 30-attempt lockout contradicts the
     * advice. The hold stays unconsumed throughout, so a retry keeps the slot.
     * ------------------------------------------------------------------------- */

    // A deploy that cannot reach its records system at all is not a bad minute, so
    // this one gets no Retry-After: promising that waiting helps would be a lie.
    if (err instanceof WpConfigError) {
      console.error('[public/appointments] upstream misconfigured:', err.message);
      const p = serviceUnavailable(
        'upstream_misconfigured',
        'The booking service is not configured to reach its records system.',
      );
      return NextResponse.json(p, { status: p.status });
    }

    // A refusal from the WordPress plugin is not this service crashing, and saying
    // so is the difference between advice that works and advice that wastes the
    // guest's afternoon. A bare 500 leaves the front end one honest sentence —
    // "something went wrong" — so it guesses, and it guessed corrupt patient data
    // during a connection-pool outage that hit every professional at once.
    //
    // Checked before the generic transient test below so this specific code
    // survives rather than being flattened into `service_unavailable`. Status 0 is
    // "never reached WordPress". The plugin's own message names internal routes,
    // so it is logged and never sent.
    if (err instanceof UpstreamWriteError && (err.upstreamStatus >= 500 || err.upstreamStatus === 0)) {
      console.error('[public/appointments] upstream write failed:', {
        operation: err.operation,
        upstreamStatus: err.upstreamStatus,
        message: err.message,
      });
      const p = serviceUnavailable(
        'upstream_write_failed',
        'The records system refused the booking. Nothing was saved and the slot is still free.',
      );
      return NextResponse.json(p, { status: p.status, headers: { 'Retry-After': '30' } });
    }

    // Our own database rather than WordPress's — a saturated connection pool. Same
    // shape of answer, a shorter wait, because a pool drains in seconds.
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

    /* ------------------------------------------------------------------------- *
     * Below: the request's own fault, or a genuine defect. These are charged.
     * ------------------------------------------------------------------------- */
    limiter.recordFailure(key);

    // 4xx upstream: a refusal that will still be a refusal in ten minutes, so it is
    // answered plainly and without a Retry-After.
    if (err instanceof UpstreamWriteError) {
      console.error('[public/appointments] upstream write rejected:', {
        operation: err.operation,
        upstreamStatus: err.upstreamStatus,
        message: err.message,
      });
      const p = conflict(
        'upstream_write_rejected',
        'The records system rejected the booking. Nothing was saved.',
      );
      return NextResponse.json(p, { status: p.status });
    }

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
