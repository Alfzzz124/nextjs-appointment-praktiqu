/**
 * GET /api/v1/professionals/[id]/off-days — list off days
 * POST /api/v1/professionals/[id]/off-days — add off day
 * DELETE /api/v1/professionals/[id]/off-days — remove off day
 *
 * T038: off-days CRUD endpoints (US3)
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { forbidden, notFound, validationError } from '@/lib/problem-details';
import {
  listOffDays,
  addOffDay,
  removeOffDay,
  isAvailabilityError,
} from '@/services/professional/availability.service';
import { createOffDayInputSchema } from '@/services/professional/validation';
import type { Actor } from '@/lib/auth';

type RouteParams = { params: { id: string } };

// ============================================
// GET /api/v1/professionals/:id/off-days
// ============================================

export const GET = withAuth(async (req: NextRequest, ctx: RouteParams) => {
  const { actor } = ctx as { actor: Actor; params: RouteParams['params'] };
  const { id } = ctx.params;

  if (!['SUPER_ADMIN', 'PROFESSIONAL'].includes(actor.role)) {
    return NextResponse.json(forbidden('Cannot view off days'), { status: 403 });
  }

  const offDays = await listOffDays(id);

  return NextResponse.json({
    professionalId: id,
    offDays: offDays.map((od) => ({
      id: od.id,
      startDate: od.startDate.toISOString().split('T')[0],
      endDate: od.endDate.toISOString().split('T')[0],
      reason: od.reason,
      createdAt: od.createdAt.toISOString(),
    })),
  });
});

// ============================================
// POST /api/v1/professionals/[id]/off-days
// ============================================

export const POST = withAuth(async (req: NextRequest, ctx: RouteParams) => {
  const { actor } = ctx as { actor: Actor; params: RouteParams['params'] };
  const { id } = ctx.params;

  if (actor.role === 'SUPER_ADMIN') {
    // ok
  } else if (actor.role === 'PROFESSIONAL') {
    const { getProfessionalByUserId } = await import('@/services/professional/professional.service');
    const professional = await getProfessionalByUserId(actor.id);
    if (professional?.id !== id) {
      return NextResponse.json(forbidden('Cannot add off days for this professional'), { status: 403 });
    }
  } else {
    return NextResponse.json(forbidden('Cannot add off days'), { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(validationError('invalid_json', 'Request body must be valid JSON'), { status: 400 });
  }

  const parsed = createOffDayInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      validationError('validation_failed', 'Invalid off day data', undefined, parsed.error.flatten().fieldErrors as Record<string, string[]>),
      { status: 422 },
    );
  }

  const startDate = new Date(parsed.data.startDate + 'T00:00:00Z');
  const endDate = new Date(parsed.data.endDate + 'T00:00:00Z');

  const offDay = await addOffDay(id, startDate, endDate, parsed.data.reason ?? null, actor.id);

  return NextResponse.json({
    id: offDay.id,
    professionalId: offDay.professionalId,
    startDate: offDay.startDate.toISOString().split('T')[0],
    endDate: offDay.endDate.toISOString().split('T')[0],
    reason: offDay.reason,
    createdAt: offDay.createdAt.toISOString(),
  }, { status: 201 });
});

// ============================================
// DELETE /api/v1/professionals/:id/off-days/:offDayId
// ============================================

export const DELETE = withAuth(async (req: NextRequest, ctx: RouteParams) => {
  const { actor } = ctx as { actor: Actor; params: RouteParams['params'] };
  const { id } = ctx.params;
  const { searchParams } = req.nextUrl;
  const offDayId = searchParams.get('offDayId');

  if (!offDayId) {
    return NextResponse.json(validationError('missing_off_day_id', 'offDayId query param required'), { status: 400 });
  }

  if (actor.role === 'SUPER_ADMIN') {
    // ok
  } else if (actor.role === 'PROFESSIONAL') {
    const { getProfessionalByUserId } = await import('@/services/professional/professional.service');
    const professional = await getProfessionalByUserId(actor.id);
    if (professional?.id !== id) {
      return NextResponse.json(forbidden('Cannot remove off days for this professional'), { status: 403 });
    }
  } else {
    return NextResponse.json(forbidden('Cannot remove off days'), { status: 403 });
  }

  try {
    await removeOffDay(offDayId, actor.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (isAvailabilityError(err)) {
      if (err._tag === 'not_found') {
        return NextResponse.json(notFound('off_day_not_found', 'Off day not found'), { status: 404 });
      }
    }
    throw err;
  }
});