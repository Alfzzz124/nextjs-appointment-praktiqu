/**
 * POST /api/v1/sessions/:id/cancel — PENDING/BOOKED → CANCELLED
 *
 * Auth: CLIENT (own only), RECEPTIONIST, CLINIC_ADMIN (within practice)
 * Body: { reason?: string (optional, max 500) }
 */

import { NextRequest, NextResponse } from 'next/server';
import { sessionActorFromRequest } from '@/lib/auth/session-actor';
import { AuthError } from '@/lib/auth';
import { unauthorized } from '@/lib/problem-details';
import { z } from 'zod';
import { SessionStatus } from '@prisma/client';
import { transitionSession } from '@/services/session/session.service';

const cancelSchema = z.object({
  reason: z.string().trim().max(500).optional().or(z.literal('')),
});


export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const body = await req.json();
    const { reason } = cancelSchema.parse(body);
    const actor = await sessionActorFromRequest(req);

    const session = await transitionSession({
      actor,
      sessionId: id,
      target: SessionStatus.CANCELLED,
      reason: reason || undefined,
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
    console.error('[POST /sessions/:id/cancel]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}