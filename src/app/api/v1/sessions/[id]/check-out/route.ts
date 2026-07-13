/**
 * POST /api/v1/sessions/:id/check-out — CHECK_IN → CHECK_OUT
 *
 * Auth: RECEPTIONIST, CLINIC_ADMIN (within practice)
 */

import { NextRequest, NextResponse } from 'next/server';
import { sessionActorFromRequest } from '@/lib/auth/session-actor';
import { AuthError } from '@/lib/auth';
import { unauthorized } from '@/lib/problem-details';
import { SessionStatus } from '@prisma/client';
import { transitionSession } from '@/services/session/session.service';


export const dynamic = 'force-dynamic';

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const actor = await sessionActorFromRequest(_req);
    const session = await transitionSession({
      actor,
      sessionId: id,
      target: SessionStatus.CHECK_OUT,
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
    console.error('[POST /sessions/:id/check-out]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}