/**
 * POST /api/v1/sessions/:id/reject — PENDING → REJECTED
 *
 * Auth: PROFESSIONAL (own), CLINIC_ADMIN, SUPER_ADMIN
 * Body: { reason: string (required, max 500 chars) }
 */

import { NextRequest, NextResponse } from 'next/server';
import { sessionActorFromRequest } from '@/lib/auth/session-actor';
import { AuthError } from '@/lib/auth';
import { unauthorized } from '@/lib/problem-details';
import { z } from 'zod';
import { SESSION_STATUS } from '@/services/session/session.service';
import { transitionSession } from '@/services/session/session.service';

/** Session ids are numeric now (D2); reject anything else before it becomes NaN. */
function parseSessionId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

const invalidSessionId = () =>
  NextResponse.json(
    { type: '/errors/validation-error', title: 'Invalid session id', status: 400 },
    { status: 400 },
  );


const rejectSchema = z.object({
  reason: z.string().trim().min(1, 'Reason is required').max(500, 'Max 500 characters'),
});


export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id: rawId } = await params;
    const id = parseSessionId(rawId);
    if (id === null) return invalidSessionId();
    const body = await req.json();
    const { reason } = rejectSchema.parse(body);
    const actor = await sessionActorFromRequest(req);

    const session = await transitionSession({
      actor,
      sessionId: id,
      // REJECTED was folded into CANCELLED (2026-07-29): KiviCare has no equivalent
      // status. The reason still reaches the audit log, so the "why" is not lost.
      target: SESSION_STATUS.CANCELLED,
      reason,
    });
    return NextResponse.json({ data: session }, { status: 200 });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json(unauthorized('unauthorized', err.message), {
        status: err.status,
        headers: { 'Content-Type': 'application/problem+json' },
      });
    }
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { type: '/errors/validation-error', title: 'Validation Error', status: 422, detail: err.message, errors: err.errors },
        { status: 422 },
      );
    }
    if (err && typeof err === 'object' && 'code' in err && 'status' in err) {
      const e = err as { code: string; status: number; message: string };
      return NextResponse.json(
        { type: `/errors/${e.code}`, title: e.code, status: e.status, detail: e.message },
        { status: e.status },
      );
    }
    console.error('[POST /sessions/:id/reject]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}