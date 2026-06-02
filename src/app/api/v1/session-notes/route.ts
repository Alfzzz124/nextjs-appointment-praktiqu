/**
 * GET  /api/v1/session-notes
 *   List session notes visible to the authenticated caller.
 *
 * POST /api/v1/session-notes
 *   Create notes for a CHECK_IN/CHECK_OUT session.
 *   Only the assigned professional may create.
 *
 * Source of truth: specs/008-session-notes/contracts/api.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import {
  SessionNoteAccessError,
  SessionNoteService,
} from '@/services/session-notes/service';
import {
  createSessionNoteSchema,
  listSessionNotesQuerySchema,
} from '@/services/session-notes/validation';
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

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const caller = callerFromHeaders(req);
    const url = new URL(req.url);
    const parsed = listSessionNotesQuerySchema.safeParse({
      page: url.searchParams.get('page') ?? undefined,
      limit: url.searchParams.get('limit') ?? undefined,
      search: url.searchParams.get('search') ?? undefined,
      clientId: url.searchParams.get('clientId') ?? undefined,
      dateFrom: url.searchParams.get('dateFrom') ?? undefined,
      dateTo: url.searchParams.get('dateTo') ?? undefined,
      status: url.searchParams.get('status') ?? undefined,
    });
    if (!parsed.success) {
      return NextResponse.json(
        { title: 'validation_failed', status: 400, 'invalid-params': parsed.error.flatten() },
        { status: 400, headers: { 'content-type': 'application/problem+json' } },
      );
    }
    const result = await service.list(parsed.data, { actor: caller, clinicId: caller.clinicId });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof SessionNoteAccessError) return problemResponse(err);
    return NextResponse.json(
      { title: 'internal_error', status: 500, detail: err instanceof Error ? err.message : 'unknown' },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const caller = callerFromHeaders(req);
    const body = await req.json().catch(() => ({}));
    const parsed = createSessionNoteSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { title: 'validation_failed', status: 400, 'invalid-params': parsed.error.flatten() },
        { status: 400, headers: { 'content-type': 'application/problem+json' } },
      );
    }
    const note = await service.create(parsed.data, { actor: caller, clinicId: caller.clinicId });
    return NextResponse.json(note, { status: 201 });
  } catch (err) {
    if (err instanceof SessionNoteAccessError) return problemResponse(err);
    return NextResponse.json(
      { title: 'internal_error', status: 500, detail: err instanceof Error ? err.message : 'unknown' },
      { status: 500 },
    );
  }
}
