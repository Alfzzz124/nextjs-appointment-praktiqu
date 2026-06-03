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
} from '@/services/professional/availability.service';
import { setAvailabilityInputSchema } from '@/services/professional/validation';
import type { Actor } from '@/lib/auth';

type RouteParams = { params: { id: string } };

// ============================================
// GET /api/v1/professionals/:id/availability
// ============================================

export const GET = withAuth(async (req: NextRequest, ctx: RouteParams) => {
  const { actor } = ctx as { actor: Actor; params: RouteParams['params'] };
  const { id } = ctx.params;

  const schedule = await getWeeklySchedule(id);

  // RBAC: SUPER_ADMIN can view any, PROFESSIONAL can view self
  if (actor.role === 'SUPER_ADMIN') {
    // ok
  } else if (actor.role === 'PROFESSIONAL' && actor.id !== id) {
    // id here is professionalId, not userId — need to look up
    const { getProfessionalByUserId } = await import('@/services/professional/professional.service');
    const professional = await getProfessionalByUserId(actor.id);
    if (professional?.id !== id) {
      return NextResponse.json(forbidden('Cannot view this professional\'s availability'), { status: 403 });
    }
  } else if (!['SUPER_ADMIN', 'PROFESSIONAL'].includes(actor.role)) {
    return NextResponse.json(forbidden('Cannot view availability'), { status: 403 });
  }

  return NextResponse.json({ professionalId: id, schedule });
});

// ============================================
// PUT /api/v1/professionals/:id/availability
// ============================================

export const PUT = withAuth(async (req: NextRequest, ctx: RouteParams) => {
  const { actor } = ctx as { actor: Actor; params: RouteParams['params'] };
  const { id } = ctx.params;

  // RBAC: SUPER_ADMIN any, PROFESSIONAL self only
  if (actor.role === 'SUPER_ADMIN') {
    // ok
  } else if (actor.role === 'PROFESSIONAL') {
    const { getProfessionalByUserId } = await import('@/services/professional/professional.service');
    const professional = await getProfessionalByUserId(actor.id);
    if (professional?.id !== id) {
      return NextResponse.json(forbidden('Cannot update this professional\'s availability'), { status: 403 });
    }
  } else {
    return NextResponse.json(forbidden('Cannot update availability'), { status: 403 });
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
    await setWeeklySchedule(id, parsed.data.schedule as any, actor.id);
    const schedule = await getWeeklySchedule(id);
    return NextResponse.json({ professionalId: id, schedule });
  } catch (err) {
    if (isAvailabilityError(err)) {
      if (err._tag === 'validation') {
        return NextResponse.json(
          validationError('overlapping_windows', 'Availability windows overlap on the same day', undefined, err.errors),
          { status: 422 },
        );
      }
    }
    throw err;
  }
});