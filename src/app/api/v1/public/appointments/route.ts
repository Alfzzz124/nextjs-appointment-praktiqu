import { NextRequest, NextResponse } from 'next/server';
import {
  createPublicAppointment,
  createPublicAppointmentSchema,
  AppointmentInsertError,
  HoldExpiredError,
  ProfessionalNotFoundError,
  ServiceNotFoundError,
  SlotConflictError,
} from '@/services/public/public-booking.service';
import { createRateLimiter, tupleKey } from '@/lib/rate-limit';
import { validationError, tooManyRequests, conflict, notFound } from '@/lib/problem-details';

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
