/**
 * GET /api/v1/practices          — List all practices (paginated)
 * POST /api/v1/practices        — Create a new practice (admin only)
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireRoles } from '@/lib/auth/route-guards';
import { listPractices } from '@/services/practice/service';
import { logging } from '@/lib/logging';

/** GET /api/v1/practices — paginated list */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const gate = await requireRoles(req, ['SUPER_ADMIN', 'CLINIC_ADMIN']);
  if ('response' in gate) return gate.response;

  const { searchParams } = req.nextUrl;
  const page = Number(searchParams.get('page') ?? 1);
  const limit = Number(searchParams.get('limit') ?? 20);
  const status = searchParams.get('status') ? Number(searchParams.get('status')) : undefined;

  try {
    const result = await listPractices({ page, limit, status });
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    await logging.error('listPractices failed', err, { path: '/api/v1/practices' });
    return NextResponse.json(
      { type: '/errors/internal', title: 'Internal Server Error', status: 500 },
      { status: 500 },
    );
  }
}

/** POST /api/v1/practices — create (stub — actual creation deferred to WP-side provisioning) */
export async function POST(_req: NextRequest): Promise<NextResponse> {
  const gate = await requireRoles(_req, ['SUPER_ADMIN', 'CLINIC_ADMIN']);
  if ('response' in gate) return gate.response;

  return NextResponse.json(
    {
      type: '/errors/not-implemented',
      title: 'Not Implemented',
      detail: 'Practice creation is delegated to the WordPress provisioning flow. Use PATCH /api/v1/practices/:id to update an existing practice.',
      status: 501,
    },
    { status: 501 },
  );
}