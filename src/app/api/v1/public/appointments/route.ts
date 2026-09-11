import { NextRequest, NextResponse } from 'next/server';
import {
  createPublicAppointment,
  getPublicAppointmentById,
  createPublicAppointmentSchema,
  AppointmentInsertError,
  EmailConflictError,
  HoldExpiredError,
  ProfessionalNotFoundError,
  ServiceNotFoundError,
  SlotConflictError,
  BookingTooSoonError,
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
import {
  claimIdempotencyKey,
  completeIdempotencyKey,
  releaseIdempotencyKey,
  fingerprintOf,
} from '@/services/public/booking-idempotency.service';
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

  /* --------------------------------------------------------------------------- *
   * Idempotency. Optional: a caller that sends no key behaves exactly as before.
   *
   * With a key, a caller whose POST times out can simply send the same request
   * again. Without one the only recourse is to guess from /slots whether the
   * booking landed, and a slot can vanish for reasons that have nothing to do with
   * this booking — its time passed, or (once calendar sync ships) the professional
   * blocked it in Google.
   * --------------------------------------------------------------------------- */
  const idempotencyKey = req.headers.get('Idempotency-Key')?.trim() || null;

  if (idempotencyKey) {
    const claim = await claimIdempotencyKey(idempotencyKey, fingerprintOf(parsed.data));

    if (claim.kind === 'replay') {
      const existing = await getPublicAppointmentById(claim.appointmentId);
      if (!existing) {
        // The key records a booking that has since been deleted. Re-creating it
        // silently would be worse than saying so.
        const p = notFound(
          'appointment_gone',
          'The booking this request already created no longer exists.',
        );
        return NextResponse.json(p, { status: p.status });
      }
      // 200, not 201: this request created nothing.
      limiter.recordSuccess(key);
      return NextResponse.json({ data: existing }, { status: 200 });
    }

    if (claim.kind === 'in_progress') {
      // The first attempt is still running. Not charged against the lockout — the
      // caller is doing exactly what it was told to do.
      const p = conflict(
        'booking_in_progress',
        'An attempt with this Idempotency-Key is still running. Retry in a moment.',
      );
      return NextResponse.json(p, { status: p.status, headers: { 'Retry-After': '2' } });
    }

    if (claim.kind === 'fingerprint_mismatch') {
      const p = validationError(
        'idempotency_key_reused',
        'This Idempotency-Key was used for a different booking. Use a new key.',
      );
      return NextResponse.json(p, { status: p.status });
    }
  }

  try {
    // Replayed on its own when the attempt provably wrote nothing — a full connection
    // pool is not something to make the guest press a button about. Only
    // `isRetrySafeFailure` gets replayed; the write is not idempotent.
    const appointment = await withRetry(() => createPublicAppointment(parsed.data));
    if (idempotencyKey) await completeIdempotencyKey(idempotencyKey, appointment.id);
    limiter.recordSuccess(key);
    return NextResponse.json({ data: appointment }, { status: 201 });
  } catch (err) {
    // Hand the key back so an honest retry can claim it. This rests on the same
    // assumption `withRetry` already makes: a throwing createPublicAppointment
    // wrote nothing. Holding the key instead would deny the retry outright, which
    // is the failure this whole mechanism exists to remove.
    if (idempotencyKey) await releaseIdempotencyKey(idempotencyKey);

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
    // Distinct from slot_conflict: the slot is free, it is the timing that fails, so
    // the advice is "pick a later one" rather than "pick another". Practices can
    // still take a same-hour booking over the phone, which is worth saying.
    if (err instanceof BookingTooSoonError) {
      const p = conflict(
        'booking_too_soon',
        'That time is too close to book online — please choose a later slot, or call the practice.',
      );
      return NextResponse.json(p, { status: p.status });
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
