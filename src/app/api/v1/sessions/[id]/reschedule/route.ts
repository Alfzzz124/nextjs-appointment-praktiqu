/**
 * POST /api/v1/sessions/:id/reschedule — move a BOOKED/PENDING session to a new slot
 *
 * Auth: SUPER_ADMIN, CLINIC_ADMIN and RECEPTIONIST (within their clinic), PROFESSIONAL
 * (own sessions only). Body: { slotDate: YYYY-MM-DD, startTime: HH:MM[:SS], reason?: ≤500 }
 *
 * The session keeps its id, length, payment and approval; the client and the psychologist
 * are emailed the new time. Refusals are problem+json with the code in `title`, like the
 * other session actions: slot_taken, session_changed, same_slot, slot_in_past,
 * not_reschedulable, session_already_started, unavailable, schedule_busy, forbidden.
 *
 * Source of truth: docs/superpowers/specs/2026-10-21-reschedule-staf-design.md §5
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { sessionActorFromRequest } from '@/lib/auth/session-actor';
import { AuthError } from '@/lib/auth';
import { unauthorized } from '@/lib/problem-details';
import { WpEndpointError } from '@/lib/wp-endpoint';
import { rescheduleSession } from '@/services/session/reschedule.service';
import { SessionServiceError } from '@/services/session/session.service';

/** Session ids are numeric now (D2); reject anything else before it becomes NaN. */
function parseSessionId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

const rescheduleSchema = z.object({
  slotDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'slotDate must be YYYY-MM-DD'),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, 'startTime must be HH:MM or HH:MM:SS'),
  reason: z.string().trim().max(500).optional().or(z.literal('')),
});

export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id: rawId } = await params;
    const id = parseSessionId(rawId);
    if (id === null) {
      return NextResponse.json(
        { type: '/errors/validation-error', title: 'Invalid session id', status: 400 },
        { status: 400 },
      );
    }
    const { slotDate, startTime, reason } = rescheduleSchema.parse(await req.json());
    const actor = await sessionActorFromRequest(req);

    const session = await rescheduleSession({ actor, sessionId: id, slotDate, startTime, reason: reason || undefined });
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
    if (err instanceof SessionServiceError) {
      return NextResponse.json(
        { type: `/errors/${err.code}`, title: err.code, status: err.status, detail: err.message },
        { status: err.status },
      );
    }
    // A plugin answer we do not map, or no answer at all (status 0). After a timeout the
    // move may still have happened, so the advice is to look, not "nothing changed".
    if (err instanceof WpEndpointError) {
      console.error('[POST /sessions/:id/reschedule] upstream:', err.status, err.code, err.message);
      return NextResponse.json(
        {
          type: '/errors/upstream_write_failed',
          title: 'upstream_write_failed',
          status: 503,
          detail: 'The records system did not confirm the move. Reload to see the current schedule.',
        },
        { status: 503 },
      );
    }
    console.error('[POST /sessions/:id/reschedule]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
