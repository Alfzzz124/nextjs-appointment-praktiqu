/**
 * GET    /api/v1/practices/:id/settings  — get full practice settings
 * PATCH  /api/v1/practices/:id/settings  — update settings (alias for PATCH /:id)
 *
 * This is a thin passthrough that delegates to the practice service.
 * Separated into its own route for future RBAC (e.g., separate settings permissions).
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireRoles } from '@/lib/auth/route-guards';
import {
  PracticeNotFoundError,
  PracticeValidationError,
  getPractice,
  updatePractice,
} from '@/services/practice/service';
import { logging } from '@/lib/logging';

type Params = { params: { id: string } };

/** GET /api/v1/practices/:id/settings */
export async function GET(_req: NextRequest, { params }: Params): Promise<NextResponse> {
  const gate = await requireRoles(_req, ['SUPER_ADMIN', 'CLINIC_ADMIN']);
  if ('response' in gate) return gate.response;

  try {
    const dto = await getPractice(params.id);
    return NextResponse.json({ data: dto }, { status: 200 });
  } catch (err) {
    if (err instanceof PracticeNotFoundError) {
      return NextResponse.json(
        { type: '/errors/resource-not-found', title: 'Practice not found', status: 404 },
        { status: 404 },
      );
    }
    await logging.error('getPractice failed', err, { path: `/api/v1/practices/${params.id}/settings` });
    return NextResponse.json(
      { type: '/errors/internal', title: 'Internal Server Error', status: 500 },
      { status: 500 },
    );
  }
}

/** PATCH /api/v1/practices/:id/settings */
export async function PATCH(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const gate = await requireRoles(req, ['SUPER_ADMIN', 'CLINIC_ADMIN']);
  if ('response' in gate) return gate.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { type: '/errors/bad-request', title: 'Invalid JSON', status: 400 },
      { status: 400 },
    );
  }

  try {
    const dto = await updatePractice(params.id, body, { actorId: null });
    return NextResponse.json({ data: dto }, { status: 200 });
  } catch (err) {
    if (err instanceof PracticeNotFoundError) {
      return NextResponse.json(
        { type: '/errors/resource-not-found', title: 'Practice not found', status: 404 },
        { status: 404 },
      );
    }
    if (err instanceof PracticeValidationError) {
      return NextResponse.json(
        { type: '/errors/validation-error', title: 'Validation Error', status: 422, detail: err.message, issues: err.issues },
        { status: 422 },
      );
    }
    await logging.error('updatePractice failed', err, { path: `/api/v1/practices/${params.id}/settings`, method: 'PATCH' });
    return NextResponse.json(
      { type: '/errors/internal', title: 'Internal Server Error', status: 500 },
      { status: 500 },
    );
  }
}