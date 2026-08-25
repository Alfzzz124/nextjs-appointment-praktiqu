/**
 * GET /api/v1/practices/:id/users — list users associated with a practice
 */
import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { forbidden } from '@/lib/problem-details';
import { KcError } from '@/lib/kc-response';
import { PracticeNotFoundError, assertPracticeInScope, listPracticeUsers } from '@/services/practice/service';
import { logging } from '@/lib/logging';

type Params = { params: { id: string } };

export const GET = withAuth(async (_req: NextRequest, ctx) => {
  const { actor, params } = ctx as any;
  if (!['SUPER_ADMIN', 'CLINIC_ADMIN'].includes(actor.role)) {
    return NextResponse.json(forbidden('Insufficient permissions'), { status: 403 });
  }

  try {
    // A CLINIC_ADMIN could otherwise list any clinic's users by id, not just their own.
    await assertPracticeInScope(actor, Number(params.id));
    const users = await listPracticeUsers(params.id);
    return NextResponse.json({ data: users }, { status: 200 });
  } catch (err) {
    if (err instanceof PracticeNotFoundError) {
      return NextResponse.json(
        { type: '/errors/resource-not-found', title: 'Practice not found', status: 404, detail: `Practice ${err.id} does not exist.` },
        { status: 404 },
      );
    }
    if (err instanceof KcError) {
      return NextResponse.json(forbidden(err.message), { status: err.httpStatus });
    }
    await logging.error('listPracticeUsers failed', err, { path: `/api/v1/practices/${params.id}/users` });
    return NextResponse.json(
      { type: '/errors/internal', title: 'Internal Server Error', status: 500 },
      { status: 500 },
    );
  }
});
