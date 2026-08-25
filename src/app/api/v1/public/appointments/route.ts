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
    const appointment = await createPublicAppointment(parsed.data);
    limiter.recordSuccess(key);
    return NextResponse.json({ data: appointment }, { status: 201 });
  } catch (err) {
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
    // A refusal from the WordPress plugin is not this service crashing, and saying so
    // is the difference between advice that works and advice that wastes the guest's
    // afternoon. A bare 500 leaves the front end only one honest sentence — "something
    // went wrong" — so it guesses, and it has been guessing wrong: telling people to
    // pick another psychologist during an outage that hits every psychologist.
    //
    // 5xx upstream is transient by nature and gets a Retry-After the caller can obey.
    // 4xx is a refusal that will not change on a retry, so it is answered plainly and
    // without one. Either way the plugin's own message stays in the log, not the body.
    if (err instanceof WpConfigError) {
      console.error('[public/appointments] upstream misconfigured:', err.message);
      const p = serviceUnavailable(
        'upstream_misconfigured',
        'The booking service is not configured to reach its records system.',
      );
      return NextResponse.json(p, { status: p.status });
    }
    if (err instanceof UpstreamWriteError) {
      console.error('[public/appointments] upstream write failed:', {
        operation: err.operation,
        upstreamStatus: err.upstreamStatus,
        message: err.message,
      });
      const transient = err.upstreamStatus >= 500 || err.upstreamStatus === 0;
      const p = transient
        ? serviceUnavailable(
            'upstream_write_failed',
            'The records system refused the booking. Nothing was saved and the slot is still free.',
          )
        : conflict(
            'upstream_write_rejected',
            'The records system rejected the booking. Nothing was saved.',
          );
      return NextResponse.json(p, {
        status: p.status,
        headers: transient ? { 'Retry-After': '30' } : {},
      });
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
