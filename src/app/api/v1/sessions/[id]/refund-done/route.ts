/**
 * POST /api/v1/sessions/:id/refund-done — the clinic returned the money by hand.
 *
 * Auth: CLINIC_ADMIN of the session's clinic, SUPER_ADMIN. Body { note?: string ≤ 500 }.
 * 409 refund_not_needed when there is no refund outstanding.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { sessionActorFromRequest } from '@/lib/auth/session-actor';
import { approvalErrorResponse } from '@/services/approval/http';
import { markRefunded } from '@/services/approval/service';

const bodySchema = z.object({ note: z.string().trim().max(500).nullable().optional() }).strict();

export const dynamic = 'force-dynamic';

export async function POST(
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
    const body = await req.json().catch(() => ({}));
    const { note } = bodySchema.parse(body ?? {});
    const view = await markRefunded({ actor, appointmentId: id, note: note ? note : null });
    return NextResponse.json({ data: view }, { status: 200 });
  } catch (err) {
    return approvalErrorResponse(err, '[POST /sessions/:id/refund-done]');
  }
}
