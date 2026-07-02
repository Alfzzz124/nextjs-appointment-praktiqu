/**
 * POST /api/v1/practices/:id/change-admin — update the clinic admin for a practice
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withAuth } from '@/lib/auth';
import { forbidden } from '@/lib/problem-details';
import { changePracticeAdmin, PracticeNotFoundError } from '@/services/practice/service';
import { prisma } from '@/lib/db';
import { logging } from '@/lib/logging';

const schema = z.object({ newAdminId: z.string().min(1) });

export const POST = withAuth(async (req: NextRequest, ctx) => {
  const { actor, params } = ctx as any;
  if (!['SUPER_ADMIN'].includes(actor.role)) {
    return NextResponse.json(forbidden('Insufficient permissions'), { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { type: '/errors/bad-request', title: 'Invalid JSON', status: 400 },
      { status: 400 },
    );
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        type: '/errors/validation-error',
        title: 'Validation Error',
        status: 422,
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
      { status: 422 },
    );
  }

  const user = await prisma.user.findUnique({ where: { id: parsed.data.newAdminId } });
  if (!user) {
    return NextResponse.json(
      { type: '/errors/not-found', title: 'User not found', status: 404 },
      { status: 404 },
    );
  }

  try {
    await changePracticeAdmin(params.id, parsed.data.newAdminId);
    return NextResponse.json({ message: 'Practice admin updated' }, { status: 200 });
  } catch (err) {
    if (err instanceof PracticeNotFoundError) {
      return NextResponse.json(
        { type: '/errors/resource-not-found', title: 'Practice not found', status: 404 },
        { status: 404 },
      );
    }
    await logging.error('changePracticeAdmin failed', err, { path: `/api/v1/practices/${params.id}/change-admin` });
    return NextResponse.json(
      { type: '/errors/internal', title: 'Internal Server Error', status: 500 },
      { status: 500 },
    );
  }
});
