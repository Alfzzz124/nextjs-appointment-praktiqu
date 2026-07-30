/**
 * POST /api/v1/sessions/:id/check-in — BOOKED → CHECK_IN
 *
 * Auth: RECEPTIONIST, CLINIC_ADMIN (within practice)
 */

import { NextRequest, NextResponse } from 'next/server';
import { sessionActorFromRequest } from '@/lib/auth/session-actor';
import { AuthError } from '@/lib/auth';
import { unauthorized } from '@/lib/problem-details';
import { SessionStatus } from '@prisma/client';
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



export const dynamic = 'force-dynamic';

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id: rawId } = await params;
    const id = parseSessionId(rawId);
    if (id === null) return invalidSessionId();
    const actor = await sessionActorFromRequest(_req);
    const session = await transitionSession({
      actor,
      sessionId: id,
      target: SessionStatus.CHECK_IN,
    });
    return NextResponse.json({ data: session }, { status: 200 });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json(unauthorized('unauthorized', err.message), {
        status: err.status,
        headers: { 'Content-Type': 'application/problem+json' },
      });
    }
    if (err && typeof err === 'object' && 'code' in err && 'status' in err) {
      const e = err as { code: string; status: number; message: string };
      return NextResponse.json(
        { type: `/errors/${e.code}`, title: e.code, status: e.status, detail: e.message },
        { status: e.status },
      );
    }
    console.error('[POST /sessions/:id/check-in]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}