/**
 * GET /api/v1/sessions/calendar — calendar view (day/week/month)
 *
 * Auth: JWT bearer.
 * Query params: ?view=day|week|month&date=YYYY-MM-DD&professionalId=...
 */

import { NextRequest, NextResponse } from 'next/server';
import { sessionActorFromRequest } from '@/lib/auth/session-actor';
import { AuthError } from '@/lib/auth';
import { unauthorized } from '@/lib/problem-details';
import { z } from 'zod';
import {  } from '@prisma/client';
import { getCalendar } from '@/services/session/session.service';

const calendarQuerySchema = z.object({
  view: z.enum(['day', 'week', 'month']).default('day'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  professionalId: z.string().optional(),
});


export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const actor = await sessionActorFromRequest(req);
    const params = Object.fromEntries(req.nextUrl.searchParams);
    const { view, date, professionalId } = calendarQuerySchema.parse(params);

    const refDate = date ? new Date(`${date}T00:00:00.000Z`) : new Date();
    const result = await getCalendar(actor, view, refDate, professionalId ?? null);
    return NextResponse.json({ data: result }, { status: 200 });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json(unauthorized('unauthorized', err.message), {
        status: err.status,
        headers: { 'Content-Type': 'application/problem+json' },
      });
    }
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