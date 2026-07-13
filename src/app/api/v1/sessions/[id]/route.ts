/**
 * GET /api/v1/sessions/:id — get session detail
 *
 * Auth: JWT bearer. RBAC enforced in service.
 */

import { NextRequest, NextResponse } from 'next/server';
import { sessionActorFromRequest } from '@/lib/auth/session-actor';
import { AuthError } from '@/lib/auth';
import { unauthorized } from '@/lib/problem-details';
import { getSession } from '@/services/session/session.service';


export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const { userId, role, practiceId } = await sessionActorFromRequest(_req);
    const session = await getSession({ userId, role, practiceId }, id);
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
    console.error('[GET /sessions/:id]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}