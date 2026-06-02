/**
 * GET  /api/v1/sessions  — list sessions (paginated, filterable)
 * POST /api/v1/sessions  — client or staff booking
 *
 * Auth: JWT bearer. RBAC enforced in service.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { SessionStatus, UserRole } from '@prisma/client';
import { createSession, listSessions } from '@/services/session/session.service';
import { listSessionsQuerySchema } from '@/services/session/validation';
import { assertDateRange } from '@/services/session/validation';

/** Placeholder auth — replace with actual JWT decode (per feature 001). */
function getActor(req: NextRequest) {
  const userId = req.headers.get('x-user-id') ?? '';
  const role = (req.headers.get('x-user-role') ?? 'CLIENT') as UserRole;
  const practiceId = req.headers.get('x-practice-id') ?? null;
  return { userId, role, practiceId };
}

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const actor = getActor(req);
    const params = Object.fromEntries(req.nextUrl.searchParams);
    const parsed = listSessionsQuerySchema.parse(params);
    assertDateRange(parsed);

    const result = await listSessions(actor, parsed);
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { type: '/errors/validation-error', title: 'Validation Error', status: 422, detail: err.message, errors: err.errors },
        { status: 422 },
      );
    }
    if (err && typeof err === 'object' && 'code' in err && 'status' in err) {
      const e = err as { code: string; status: number; message: string };
      return NextResponse.json(
        { type: `/errors/${e.code}`, title: e.code, status: e.status, detail: e.message },
        { status: e.status },
      );
    }
    console.error('[GET /sessions]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const actor = getActor(req);
    const body = await req.json();

    const { createSessionSchema: schema } = await import('@/services/session/validation');
    const parsed = schema.parse(body);

    // Staff bookings force BOOKED; clients create PENDING.
    const isStaff =
      actor.role === UserRole.RECEPTIONIST ||
      actor.role === UserRole.CLINIC_ADMIN ||
      actor.role === UserRole.SUPER_ADMIN;

    const session = await createSession({
      actor,
      input: parsed,
      forceBooked: isStaff,
    });

    return NextResponse.json({ data: session }, { status: 201 });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { type: '/errors/validation-error', title: 'Validation Error', status: 422, detail: err.message, errors: err.errors },
        { status: 422 },
      );
    }
    if (err && typeof err === 'object' && 'code' in err && 'status' in err) {
      const e = err as { code: string; status: number; message: string };
      return NextResponse.json(
        { type: `/errors/${e.code}`, title: e.code, status: e.status, detail: e.message },
        { status: e.status },
      );
    }
    console.error('[POST /sessions]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}