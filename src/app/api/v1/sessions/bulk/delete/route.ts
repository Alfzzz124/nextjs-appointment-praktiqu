// POST /api/v1/sessions/bulk/delete
import { NextRequest, NextResponse } from 'next/server';
import { sessionActorFromRequest } from '@/lib/auth/session-actor';
import { AuthError } from '@/lib/auth';
import { unauthorized } from '@/lib/problem-details';
import { UserRole } from '@prisma/client';
import { bulkDeleteSessions } from '@/services/session/session.service';
import { z } from 'zod';


const schema = z.object({ ids: z.array(z.string()).min(1) });

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const actor = await sessionActorFromRequest(req);
    if (!([UserRole.SUPER_ADMIN, UserRole.CLINIC_ADMIN, UserRole.RECEPTIONIST] as string[]).includes(actor.role)) {
      return NextResponse.json({ type: '/errors/forbidden', title: 'Forbidden', status: 403 }, { status: 403 });
    }
    const body = await req.json().catch(() => ({}));
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { type: '/errors/validation', title: 'Invalid input', status: 400, detail: parsed.error.issues[0]?.message },
        { status: 400 },
      );
    }
    const count = await bulkDeleteSessions(parsed.data.ids);
    return NextResponse.json({ message: `${count} sessions cancelled`, data: { updated: count } });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json(unauthorized('unauthorized', err.message), {
        status: err.status,
        headers: { 'Content-Type': 'application/problem+json' },
      });
    }
    console.error('[POST /sessions/bulk/delete]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
