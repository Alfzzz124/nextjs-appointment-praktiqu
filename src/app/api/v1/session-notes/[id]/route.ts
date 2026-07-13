/**
 * GET    /api/v1/session-notes/[id]  → read one note (creator / admin)
 * PATCH  /api/v1/session-notes/[id]  → edit open notes (creator only)
 *
 * Source of truth: specs/008-session-notes/contracts/api.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import {
  SessionNoteAccessError,
  SessionNoteService,
} from '@/services/session-notes/service';
import { updateSessionNoteSchema } from '@/services/session-notes/validation';
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

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  try {
    const caller = await callerFromHeaders(req);
    const note = await service.getById(params.id, { actor: caller, clinicId: caller.clinicId });
    return NextResponse.json(note);
  } catch (err) {
    if (err instanceof SessionNoteAccessError) return problemResponse(err);
    return NextResponse.json(
      { title: 'internal_error', status: 500, detail: err instanceof Error ? err.message : 'unknown' },
      { status: 500 },
    );
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  try {
    const caller = await callerFromHeaders(req);
    const body = await req.json().catch(() => ({}));
    const parsed = updateSessionNoteSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { title: 'validation_failed', status: 400, 'invalid-params': parsed.error.flatten() },
        { status: 400, headers: { 'content-type': 'application/problem+json' } },
      );
    }
    const updated = await service.update(
      params.id,
      parsed.data,
      { actor: caller, clinicId: caller.clinicId },
    );
    return NextResponse.json(updated);
  } catch (err) {
    if (err instanceof SessionNoteAccessError) return problemResponse(err);
    return NextResponse.json(
      { title: 'internal_error', status: 500, detail: err instanceof Error ? err.message : 'unknown' },
      { status: 500 },
    );
  }
}
