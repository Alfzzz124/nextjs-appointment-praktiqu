/**
 * GET  /api/v1/practices — list practices (paginated; a CLINIC_ADMIN sees their own)
 * POST /api/v1/practices — create a practice (SUPER_ADMIN)
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireRoles } from '@/lib/auth/route-guards';
import { practiceProblem } from '@/lib/practice-problems';
import { createPractice, listPractices } from '@/services/practice/service';
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
    // The repository filters on active/inactive rather than an arbitrary status
    // integer, since wp_kc_clinics only has the two.
    const result = await listPractices({ page, limit, includeInactive: status !== 1 }, gate.actor);
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    await logging.error('listPractices failed', err, { path: '/api/v1/practices' });
    return NextResponse.json(
      { type: '/errors/internal', title: 'Internal Server Error', status: 500 },
      { status: 500 },
    );
  }
}

/**
 * POST /api/v1/practices — create a clinic, optionally with its admin.
 *
 * Body: practiceCreateSchema (src/types/practice.ts). 201 `{ data: PracticeDTO, admin }`.
 * No `message` key: the Laravel FE's unwrap() would then keep only `data` and drop `admin`.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const gate = await requireRoles(req, ['SUPER_ADMIN']);
  if ('response' in gate) return gate.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { type: '/errors/bad-request', title: 'Invalid JSON', status: 400, code: 'invalid_json' },
      { status: 400 },
    );
  }

  try {
    const result = await createPractice(body, { actorId: gate.actor.id });
    return NextResponse.json({ data: result.practice, admin: result.admin }, { status: 201 });
  } catch (err) {
    const mapped = practiceProblem(err);
    if (mapped) return mapped;
    await logging.error('createPractice failed', err, { path: '/api/v1/practices', method: 'POST' });
    return NextResponse.json(
      { type: '/errors/internal', title: 'Internal Server Error', status: 500 },
      { status: 500 },
    );
  }
}
