/**
 * GET    /api/v1/professionals/[id] — read a professional
 * PATCH  /api/v1/professionals/[id] — partial update
 * DELETE /api/v1/professionals/[id] — soft-delete (set INACTIVE)
 *
 * A professional IS a `wp_users` row with the `kiviCare_doctor` capability, so `id` is
 * a numeric `wp_users.ID`. Self-access compares RESOLVED WordPress ids: the JWT subject
 * is a cuid in the auth mirror and is never equal to a professional's id.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth, type Actor } from '@/lib/auth';
import { notFound, forbidden, validationError } from '@/lib/problem-details';
import {
  getProfessional,
  updateProfessional,
  deactivateProfessional,
  isServiceError,
} from '@/services/professional/professional.service';
import {
  canEdit,
  canView,
  invalidIdResponse,
  parseProfessionalId,
  scopeFor,
} from '@/services/professional/route-scope';

type RouteParams = { params: { id: string } };

export const GET = withAuth(async (_req: NextRequest, ctx: RouteParams) => {
  const { actor } = ctx as { actor: Actor; params: RouteParams['params'] };
  const id = parseProfessionalId(ctx.params.id);
  if (id === null) return invalidIdResponse();

  const scope = await scopeFor(actor, id);
  if (!scope) {
    return NextResponse.json(notFound('professional_not_found', 'Professional not found'), { status: 404 });
  }
  if (!canView(scope, actor.role)) {
    return NextResponse.json(forbidden('Cannot view this professional'), { status: 403 });
  }

  return NextResponse.json(await getProfessional(id));
});

export const PATCH = withAuth(async (req: NextRequest, ctx: RouteParams) => {
  const { actor } = ctx as { actor: Actor; params: RouteParams['params'] };
  const id = parseProfessionalId(ctx.params.id);
  if (id === null) return invalidIdResponse();

  const scope = await scopeFor(actor, id);
  if (!scope) {
    return NextResponse.json(notFound('professional_not_found', 'Professional not found'), { status: 404 });
  }
  if (!canEdit(scope, actor.role)) {
    return NextResponse.json(forbidden('Cannot update this professional'), { status: 403 });
  }

  // A professional editing their own profile is restricted to biography, specialties
  // and contact number — the service rejects anything else rather than stripping it.
  const isSelfEdit = actor.role === 'PROFESSIONAL' && scope.isSelf;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(validationError('invalid_json', 'Request body must be valid JSON'), { status: 400 });
  }

  try {
    const updated = await updateProfessional(id, body as Record<string, unknown>, actor.id, isSelfEdit);
    return NextResponse.json(updated);
  } catch (err) {
    if (isServiceError(err)) {
      if (err._tag === 'validation') {
        return NextResponse.json(
          validationError('validation_failed', 'Update data is invalid', undefined, err.errors),
          { status: 422 },
        );
      }
      if (err._tag === 'not_found') {
        return NextResponse.json(notFound('professional_not_found', 'Professional not found'), { status: 404 });
      }
      if (err._tag === 'forbidden') {
        return NextResponse.json(forbidden(err.message), { status: 403 });
      }
      if (err._tag === 'conflict') {
        return NextResponse.json(
          { type: '/errors/conflict', title: err.message, status: 409, code: err.code },
          { status: 409 },
        );
      }
    }
    throw err;
  }
});

export const DELETE = withAuth(async (_req: NextRequest, ctx: RouteParams) => {
  const { actor } = ctx as { actor: Actor; params: RouteParams['params'] };
  const id = parseProfessionalId(ctx.params.id);
  if (id === null) return invalidIdResponse();

  // FR-013: a professional cannot deactivate themselves, so this is admin-only. Checked
  // before the lookup, since the answer does not depend on the target.
  if (!['SUPER_ADMIN', 'CLINIC_ADMIN'].includes(actor.role)) {
    return NextResponse.json(forbidden('Cannot deactivate this professional'), { status: 403 });
  }

  const scope = await scopeFor(actor, id);
  if (!scope) {
    return NextResponse.json(notFound('professional_not_found', 'Professional not found'), { status: 404 });
  }

  await deactivateProfessional(id, actor.id);
  return NextResponse.json({ ok: true });
});
