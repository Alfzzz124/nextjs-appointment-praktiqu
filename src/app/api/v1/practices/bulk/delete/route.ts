/**
 * POST /api/v1/practices/bulk/delete — soft-delete multiple practices (status = 0)
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withAuth } from '@/lib/auth';
import { forbidden } from '@/lib/problem-details';
import { bulkDeletePractices } from '@/services/practice/service';
import { logging } from '@/lib/logging';

const schema = z.object({ ids: z.array(z.string()).min(1) });

export const POST = withAuth(async (req: NextRequest, ctx) => {
  const { actor } = ctx as any;
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

  try {
    const count = await bulkDeletePractices(parsed.data.ids);
    return NextResponse.json(
      { message: 'Practices deactivated', data: { updated: count } },
      { status: 200 },
    );
  } catch (err) {
    await logging.error('bulkDeletePractices failed', err, { path: '/api/v1/practices/bulk/delete' });
    return NextResponse.json(
      { type: '/errors/internal', title: 'Internal Server Error', status: 500 },
      { status: 500 },
    );
  }
});
