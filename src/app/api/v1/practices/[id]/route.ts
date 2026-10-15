/**
 * GET    /api/v1/practices/:id — get a practice (SUPER_ADMIN; CLINIC_ADMIN for their own)
 * PATCH  /api/v1/practices/:id — update its profile; a CLINIC_ADMIN may not send `status`
 * DELETE /api/v1/practices/:id — SUPER_ADMIN: deactivate (status 0), not a delete
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireRoles } from '@/lib/auth/route-guards';
import { forbidden } from '@/lib/problem-details';
import { practiceProblem } from '@/lib/practice-problems';
import {
  assertPracticeInScope,
  getPractice,
  setPracticeStatus,
  updatePractice,
} from '@/services/practice/service';
import { logging } from '@/lib/logging';

type Params = { params: { id: string } };

const internalError = () =>
  NextResponse.json({ type: '/errors/internal', title: 'Internal Server Error', status: 500 }, { status: 500 });

/** GET /api/v1/practices/:id */
export async function GET(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const gate = await requireRoles(req, ['SUPER_ADMIN', 'CLINIC_ADMIN']);
  if ('response' in gate) return gate.response;

  try {
    await assertPracticeInScope(gate.actor, Number(params.id));
    return NextResponse.json({ data: await getPractice(Number(params.id)) }, { status: 200 });
  } catch (err) {
    const mapped = practiceProblem(err);
    if (mapped) return mapped;
    await logging.error('getPractice failed', err, { path: `/api/v1/practices/${params.id}` });
    return internalError();
  }
}

/** PATCH /api/v1/practices/:id */
export async function PATCH(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const gate = await requireRoles(req, ['SUPER_ADMIN', 'CLINIC_ADMIN']);
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
    await assertPracticeInScope(gate.actor, Number(params.id));
    // Switching a clinic on or off is the super admin's call; a clinic admin could otherwise
    // lock themselves (and their patients' bookings) out.
    if (gate.actor.role !== 'SUPER_ADMIN' && body !== null && typeof body === 'object' && 'status' in body) {
      return NextResponse.json(
        forbidden('status_change_forbidden', 'Only a super admin can change a clinic status.'),
        { status: 403 },
      );
    }
    const dto = await updatePractice(Number(params.id), body, { actorId: gate.actor.id });
    return NextResponse.json({ data: dto }, { status: 200 });
  } catch (err) {
    const mapped = practiceProblem(err);
    if (mapped) return mapped;
    await logging.error('updatePractice failed', err, { path: `/api/v1/practices/${params.id}`, method: 'PATCH' });
    return internalError();
  }
}

/** DELETE /api/v1/practices/:id — soft deactivate (status = 0) */
export async function DELETE(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const gate = await requireRoles(req, ['SUPER_ADMIN']);
  if ('response' in gate) return gate.response;

  try {
    await assertPracticeInScope(gate.actor, Number(params.id));
    await setPracticeStatus(Number(params.id), 0, { actorId: gate.actor.id });
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    const mapped = practiceProblem(err);
    if (mapped) return mapped;
    await logging.error('deactivatePractice failed', err, { path: `/api/v1/practices/${params.id}`, method: 'DELETE' });
    return internalError();
  }
}
