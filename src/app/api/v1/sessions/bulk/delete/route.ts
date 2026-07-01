// POST /api/v1/sessions/bulk/delete
import { NextRequest, NextResponse } from 'next/server';
import { UserRole } from '@prisma/client';
import { bulkDeleteSessions } from '@/services/session/session.service';
import { z } from 'zod';

function getActor(req: NextRequest) {
  const userId = req.headers.get('x-user-id') ?? '';
  const role = (req.headers.get('x-user-role') ?? 'CLIENT') as UserRole;
  const practiceId = req.headers.get('x-practice-id') ?? null;
  return { userId, role, practiceId };
}

const schema = z.object({ ids: z.array(z.string()).min(1) });

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const actor = getActor(req);
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
    console.error('[POST /sessions/bulk/delete]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
