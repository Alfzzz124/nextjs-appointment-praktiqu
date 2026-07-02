// GET /api/v1/sessions/export
import { NextRequest, NextResponse } from 'next/server';
import { SessionStatus, UserRole } from '@prisma/client';
import { exportSessions } from '@/services/session/session.service';
import { z } from 'zod';

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
    if (!([UserRole.SUPER_ADMIN, UserRole.CLINIC_ADMIN, UserRole.RECEPTIONIST] as string[]).includes(actor.role)) {
      return NextResponse.json({ type: '/errors/forbidden', title: 'Forbidden', status: 403 }, { status: 403 });
    }
    const { searchParams } = req.nextUrl;
    const rawStatus = searchParams.get('status');
    const statusParsed = z.nativeEnum(SessionStatus).optional().safeParse(rawStatus ?? undefined);
    const params = {
      practiceId:
        actor.role === UserRole.SUPER_ADMIN
          ? (searchParams.get('practiceId') ?? undefined)
          : (actor.practiceId ?? undefined),
      status: statusParsed.success ? statusParsed.data : undefined,
      from: searchParams.get('from') ? new Date(searchParams.get('from')!) : undefined,
      to: searchParams.get('to') ? new Date(searchParams.get('to')!) : undefined,
    };
    const data = await exportSessions(params);
    return NextResponse.json(
      { status: true, message: 'Sessions data retrieved successfully', data },
      { headers: { 'Content-Disposition': 'attachment; filename="sessions-export.json"' } },
    );
  } catch (err) {
    console.error('[GET /sessions/export]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
