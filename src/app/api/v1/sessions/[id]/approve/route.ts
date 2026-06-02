/**
 * POST /api/v1/sessions/:id/approve — PENDING → BOOKED
 *
 * Auth: PROFESSIONAL (own), CLINIC_ADMIN, SUPER_ADMIN
 */

import { NextRequest, NextResponse } from 'next/server';
import { SessionStatus, UserRole } from '@prisma/client';
import { transitionSession } from '@/services/session/session.service';

function getActor(req: NextRequest) {
  const userId = req.headers.get('x-user-id') ?? '';
  const role = (req.headers.get('x-user-role') ?? 'CLIENT') as UserRole;
  const practiceId = req.headers.get('x-practice-id') ?? null;
  return { userId, role, practiceId };
}

export const dynamic = 'force-dynamic';

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const actor = getActor(_req);
    const session = await transitionSession({
      actor,
      sessionId: id,
      target: SessionStatus.BOOKED,
    });
    return NextResponse.json({ data: session }, { status: 200 });
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err && 'status' in err) {
      const e = err as { code: string; status: number; message: string };
      return NextResponse.json(
        { type: `/errors/${e.code}`, title: e.code, status: e.status, detail: e.message },
        { status: e.status },
      );
    }
    console.error('[POST /sessions/:id/approve]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}