/**
 * GET /api/v1/sessions/:id/approval — one approval item, the queue's shape.
 *
 * Auth: the session's PROFESSIONAL, a CLINIC_ADMIN of its clinic, SUPER_ADMIN.
 * 404 approval_not_found for a session that never waited for approval.
 */
import { NextRequest, NextResponse } from 'next/server';
import { sessionActorFromRequest } from '@/lib/auth/session-actor';
import { approvalErrorResponse } from '@/services/approval/http';
import { getApprovalItem } from '@/services/approval/service';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id: raw } = await params;
    const id = Number(raw);
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json(
        { type: '/errors/validation-error', title: 'Invalid session id', status: 400 },
        { status: 400 },
      );
    }
    const actor = await sessionActorFromRequest(req);
    return NextResponse.json({ data: await getApprovalItem(actor, id) }, { status: 200 });
  } catch (err) {
    return approvalErrorResponse(err, '[GET /sessions/:id/approval]');
  }
}
