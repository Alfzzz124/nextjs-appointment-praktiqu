/**
 * GET /api/v1/sessions/pending — professional's pending approval requests
 *
 * Auth: SUPER_ADMIN, CLINIC_ADMIN, PROFESSIONAL (own only)
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { UserRole } from '@prisma/client';
import { listPendingForProfessional } from '@/services/session/session.service';

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
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
    const { page, limit } = querySchema.parse(params);

    const result = await listPendingForProfessional(actor, page, limit);
    return NextResponse.json(result, { status: 200 });
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
    console.error('[GET /sessions/pending]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}