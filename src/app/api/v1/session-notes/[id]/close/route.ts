/**
 * POST /api/v1/session-notes/[id]/close
 *   Lock the note. Idempotent: closing an already-closed note returns
 *   the note as-is with 200 OK.
 *
 * Source of truth: specs/008-session-notes/contracts/api.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import {
  SessionNoteAccessError,
  SessionNoteService,
} from '@/services/session-notes/service';
import { callerFromHeaders } from '@/lib/auth/session-notes-caller';

export const dynamic = 'force-dynamic';

const prisma = new PrismaClient();
const service = new SessionNoteService(prisma);

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

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  try {
    const caller = await callerFromHeaders(req);
    const note = await service.close(params.id, { actor: caller, clinicId: caller.clinicId });
    return NextResponse.json(note);
  } catch (err) {
    if (err instanceof SessionNoteAccessError) return problemResponse(err);
    return NextResponse.json(
      { title: 'internal_error', status: 500, detail: err instanceof Error ? err.message : 'unknown' },
      { status: 500 },
    );
  }
}
