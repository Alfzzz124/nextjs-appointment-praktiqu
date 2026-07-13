/**
 * GET /api/v1/sessions/pending — professional's pending approval requests
 *
 * Auth: SUPER_ADMIN, CLINIC_ADMIN, PROFESSIONAL (own only)
 */

import { NextRequest, NextResponse } from 'next/server';
import { sessionActorFromRequest } from '@/lib/auth/session-actor';
import { AuthError } from '@/lib/auth';
import { unauthorized } from '@/lib/problem-details';
import { z } from 'zod';
import {  } from '@prisma/client';
import { listPendingForProfessional } from '@/services/session/session.service';

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});


export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const actor = await sessionActorFromRequest(req);
    const params = Object.fromEntries(req.nextUrl.searchParams);
    const { page, limit } = querySchema.parse(params);

    const result = await listPendingForProfessional(actor, page, limit);
    return NextResponse.json(result, { status: 200 });
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
    console.error('[GET /sessions/pending]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}