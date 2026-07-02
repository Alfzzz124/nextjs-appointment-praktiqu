/**
 * GET /api/v1/practices/:id/users — list users associated with a practice
 */
import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { forbidden } from '@/lib/problem-details';
import { listPracticeUsers } from '@/services/practice/service';
import { logging } from '@/lib/logging';

type Params = { params: { id: string } };

export const GET = withAuth(async (_req: NextRequest, ctx) => {
  const { actor, params } = ctx as any;
  if (!['SUPER_ADMIN', 'CLINIC_ADMIN'].includes(actor.role)) {
    return NextResponse.json(forbidden('Insufficient permissions'), { status: 403 });
  }

  try {
    const users = await listPracticeUsers(params.id);
    return NextResponse.json({ data: users }, { status: 200 });
  } catch (err) {
    await logging.error('listPracticeUsers failed', err, { path: `/api/v1/practices/${params.id}/users` });
    return NextResponse.json(
      { type: '/errors/internal', title: 'Internal Server Error', status: 500 },
      { status: 500 },
    );
  }
});
