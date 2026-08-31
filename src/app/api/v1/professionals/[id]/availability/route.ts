/**
 * GET /api/v1/professionals/[id]/availability — get weekly schedule
 * PUT /api/v1/professionals/[id]/availability — replace full weekly schedule
 *
 * T037: PUT availability endpoint (US3)
 * T039: overlapping window validation (FR-015)
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { forbidden, notFound, validationError } from '@/lib/problem-details';
import {
  getWeeklySchedule,
  setWeeklySchedule,
  isAvailabilityError,
  type AvailabilityWindow,
} from '@/services/professional/availability.service';
import { setAvailabilityInputSchema } from '@/services/professional/validation';
import type { Actor } from '@/lib/auth';
import {
  canEdit,
  canView,
  invalidIdResponse,
  parseProfessionalId,
  scopeFor,
} from '@/services/professional/route-scope';

type RouteParams = { params: { id: string } };

// ============================================
// GET /api/v1/professionals/:id/availability
// ============================================

export const GET = withAuth(async (req: NextRequest, ctx: RouteParams) => {
  const { actor } = ctx as { actor: Actor; params: RouteParams['params'] };
  const id = parseProfessionalId(ctx.params.id);
  if (id === null) return invalidIdResponse();

  const scope = await scopeFor(actor, id);
  if (!scope) {
    return NextResponse.json(notFound('professional_not_found', 'Professional not found'), { status: 404 });
  }
  if (!canView(scope, actor.role)) {
    return NextResponse.json(forbidden("Cannot view this professional's availability"), { status: 403 });
  }

  // A schedule belongs to a doctor AT a clinic, so a clinic is required.
  const clinicId = Number(req.nextUrl.searchParams.get('clinicId') ?? scope.kc.clinicId ?? 0);
  if (!clinicId) {
    return NextResponse.json(
      validationError('missing_clinic_id', 'clinicId is required for this actor'),
      { status: 400 },
    );
  }

  const schedule = await getWeeklySchedule(id, clinicId);
  return NextResponse.json({ professionalId: id, clinicId, schedule });
});

// ============================================
// PUT /api/v1/professionals/:id/availability
// ============================================

export const PUT = withAuth(async (req: NextRequest, ctx: RouteParams) => {
  const { actor } = ctx as { actor: Actor; params: RouteParams['params'] };
  const id = parseProfessionalId(ctx.params.id);
  if (id === null) return invalidIdResponse();

  const scope = await scopeFor(actor, id);
  if (!scope) {
    return NextResponse.json(notFound('professional_not_found', 'Professional not found'), { status: 404 });
  }
  if (!canEdit(scope, actor.role)) {
    return NextResponse.json(forbidden("Cannot update this professional's availability"), { status: 403 });
  }

  const clinicId = Number(req.nextUrl.searchParams.get('clinicId') ?? scope.kc.clinicId ?? 0);
  if (!clinicId) {
    return NextResponse.json(
      validationError('missing_clinic_id', 'clinicId is required for this actor'),
      { status: 400 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(validationError('invalid_json', 'Request body must be valid JSON'), { status: 400 });
  }

  const parsed = setAvailabilityInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      validationError('validation_failed', 'Invalid availability data', undefined, parsed.error.flatten().fieldErrors as Record<string, string[]>),
      { status: 422 },
    );
  }

  try {
    await setWeeklySchedule(id, clinicId, parsed.data.schedule as AvailabilityWindow[]);
    const schedule = await getWeeklySchedule(id, clinicId);
    return NextResponse.json({ professionalId: id, clinicId, schedule });
  } catch (err) {
    if (isAvailabilityError(err)) {
      if (err._tag === 'validation' || err._tag === 'conflict') {
        return NextResponse.json(
          validationError('invalid_availability', err.message),
          { status: 422 },
        );
      }
    }
    throw err;
  }
});