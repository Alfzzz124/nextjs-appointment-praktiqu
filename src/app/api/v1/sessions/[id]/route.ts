/**
 * GET /api/v1/sessions/:id — get session detail
 *
 * Auth: JWT bearer. RBAC enforced in service.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/services/session/session.service';

/** Placeholder auth — replace with actual JWT decode (per feature 001). */
function getActor(req: NextRequest) {
  const userId = req.headers.get('x-user-id') ?? '';
  const role = req.headers.get('x-user-role') ?? 'CLIENT';
  const practiceId = req.headers.get('x-practice-id') ?? null;
  return { userId, role: role as 'SUPER_ADMIN' | 'CLINIC_ADMIN' | 'PROFESSIONAL' | 'RECEPTIONIST' | 'CLIENT', practiceId };
}

export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const { userId, role, practiceId } = getActor(_req);
    const session = await getSession({ userId, role, practiceId }, id);
    return NextResponse.json({ data: session }, { status: 200 });
  } catch (err) {
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