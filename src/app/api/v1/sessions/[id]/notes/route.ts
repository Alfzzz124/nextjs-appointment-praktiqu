/**
 * GET /api/v1/sessions/[id]/notes
 *   Fetch the session note attached to a specific session.
 *   Used by feature 014 (client progress tracking) and the appointment
 *   detail page.
 *
 * Source of truth: specs/008-session-notes/contracts/api.md
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  SessionNoteAccessError,
  SessionNoteService,
} from '@/services/session-notes/service';
import { callerFromHeaders } from '@/lib/auth/session-notes-caller';

export const dynamic = 'force-dynamic';

const service = new SessionNoteService();

function problemResponse(err: SessionNoteAccessError): NextResponse {
  return NextResponse.json(
    {
      type: 'about:blank',
      title: err.name,
      status: err.status,
      detail: err.message,
    },
    { status: err.status, headers: { 'content-type': 'application/problem+json' } },
  );
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  // The session id is a wp_kc_appointments.id integer.
  const sessionId = Number(params.id);
  if (!Number.isSafeInteger(sessionId) || sessionId <= 0) {
    return NextResponse.json(
      { type: 'about:blank', title: 'Not Found', status: 404 },
      { status: 404 },
    );
  }

  try {
    const caller = await callerFromHeaders(req);
    const note = await service.getBySessionId(sessionId, {
      actor: caller,
      clinicId: caller.clinicId,
    });
    return NextResponse.json(note);
  } catch (err) {
    if (err instanceof SessionNoteAccessError) return problemResponse(err);
    return NextResponse.json(
      { title: 'internal_error', status: 500, detail: err instanceof Error ? err.message : 'unknown' },
      { status: 500 },
    );
  }
}
