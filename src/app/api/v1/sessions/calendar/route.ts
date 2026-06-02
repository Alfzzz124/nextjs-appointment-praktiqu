/**
 * GET /api/v1/sessions/calendar — calendar view (day/week/month)
 *
 * Auth: JWT bearer.
 * Query params: ?view=day|week|month&date=YYYY-MM-DD&professionalId=...
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { UserRole } from '@prisma/client';
import { getCalendar } from '@/services/session/session.service';

const calendarQuerySchema = z.object({
  view: z.enum(['day', 'week', 'month']).default('day'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).optional(),
  professionalId: z.string().optional(),
});

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
    const { view, date, professionalId } = calendarQuerySchema.parse(params);

    const refDate = date ? new Date(`${date}T00:00:00.000Z`) : new Date();
    const result = await getCalendar(actor, view, refDate, professionalId ?? null);
    return NextResponse.json({ data: result }, { status: 200 });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { type: '/errors/validation-error', title: 'Validation Error', status: 422, detail: err.message },
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
    console.error('[GET /sessions/calendar]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}