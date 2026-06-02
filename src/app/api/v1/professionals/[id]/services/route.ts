/**
 * GET /api/v1/professionals/[id]/services — list assigned services
 * POST /api/v1/professionals/[id]/services — assign service
 * DELETE /api/v1/professionals/[id]/services — unassign service
 *
 * T051: service assignment endpoints (US5)
 * T052: ACTIVE service filter
 * T053: no duplicate assignment
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { forbidden, notFound, validationError, conflict } from '@/lib/problem-details';
import {
  listAssignedServices,
  assignService,
  unassignService,
  isServiceAssignmentError,
} from '@/services/professional/service-assignment.service';
import type { Actor } from '@/lib/auth';

type RouteParams = { params: { id: string } };

// ============================================
// GET /api/v1/professionals/:id/services
// ============================================

export const GET = withAuth(async (req: NextRequest, ctx: RouteParams) => {
  const { actor } = ctx as { actor: Actor; params: RouteParams['params'] };
  const { id } = ctx.params;

  // SUPER_ADMIN, CLINIC_ADMIN, PROFESSIONAL (self), RECEPTIONIST (own practice)
  const { getProfessional } = await import('@/services/professional/professional.service');
  const professional = await getProfessional(id);

  if (!professional) {
    return NextResponse.json(notFound('professional_not_found', 'Professional not found'), { status: 404 });
  }

  const canView =
    actor.role === 'SUPER_ADMIN' ||
    actor.role === 'CLINIC_ADMIN' ||
    (actor.role === 'PROFESSIONAL' && actor.id === professional.userId) ||
    (actor.role === 'RECEPTIONIST' && actor.practiceId === professional.practiceId);

  if (!canView) {
    return NextResponse.json(forbidden('Cannot view this professional\'s services'), { status: 403 });
  }

  const services = await listAssignedServices(id);

  return NextResponse.json({
    professionalId: id,
    services: services.map((s) => ({
      id: s.id,
      serviceId: s.serviceId,
      serviceName: s.serviceName,
      serviceDuration: s.serviceDuration,
      createdAt: s.createdAt.toISOString(),
    })),
  });
});

// ============================================
// POST /api/v1/professionals/:id/services — assign service
// ============================================

export const POST = withAuth(async (req: NextRequest, ctx: RouteParams) => {
  const { actor } = ctx as { actor: Actor; params: RouteParams['params'] };
  const { id } = ctx.params;

  // SUPER_ADMIN and CLINIC_ADMIN can assign (US5)
  if (!['SUPER_ADMIN', 'CLINIC_ADMIN'].includes(actor.role)) {
    return NextResponse.json(forbidden('Only Super Admin and Clinic Admin can assign services'), { status: 403 });
  }

  const { getProfessional } = await import('@/services/professional/professional.service');
  const professional = await getProfessional(id);

  if (!professional) {
    return NextResponse.json(notFound('professional_not_found', 'Professional not found'), { status: 404 });
  }

  // CLINIC_ADMIN: practice boundary
  if (actor.role === 'CLINIC_ADMIN' && actor.practiceId !== professional.practiceId) {
    return NextResponse.json(forbidden('Cannot assign services to professional outside your practice'), { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(validationError('invalid_json', 'Request body must be valid JSON'), { status: 400 });
  }

  const parsedBody = body as { serviceId?: string };
  if (!parsedBody?.serviceId) {
    return NextResponse.json(validationError('missing_service_id', 'serviceId is required'), { status: 422 });
  }

  try {
    const result = await assignService(id, parsedBody.serviceId, actor.id);
    return NextResponse.json({ id: result.id, professionalId: id, serviceId: parsedBody.serviceId }, { status: 201 });
  } catch (err) {
    if (isServiceAssignmentError(err)) {
      if (err._tag === 'validation') {
        return NextResponse.json(validationError('validation_failed', 'Invalid service data', undefined, err.errors), { status: 422 });
      }
      if (err._tag === 'not_found') {
        return NextResponse.json(notFound('service_not_found', 'Service not found'), { status: 404 });
      }
      if (err._tag === 'conflict') {
        return NextResponse.json(conflict(err.code, err.message), { status: 409 });
      }
    }
    throw err;
  }
});

// ============================================
// DELETE /api/v1/professionals/:id/services?serviceId=...
// ============================================

export const DELETE = withAuth(async (req: NextRequest, ctx: RouteParams) => {
  const { actor } = ctx as { actor: Actor; params: RouteParams['params'] };
  const { id } = ctx.params;
  const { searchParams } = req.nextUrl;
  const serviceId = searchParams.get('serviceId');

  if (!serviceId) {
    return NextResponse.json(validationError('missing_service_id', 'serviceId query param required'), { status: 400 });
  }

  if (!['SUPER_ADMIN', 'CLINIC_ADMIN'].includes(actor.role)) {
    return NextResponse.json(forbidden('Only Super Admin and Clinic Admin can unassign services'), { status: 403 });
  }

  const { getProfessional } = await import('@/services/professional/professional.service');
  const professional = await getProfessional(id);

  if (!professional) {
    return NextResponse.json(notFound('professional_not_found', 'Professional not found'), { status: 404 });
  }

  if (actor.role === 'CLINIC_ADMIN' && actor.practiceId !== professional.practiceId) {
    return NextResponse.json(forbidden('Cannot unassign services from professional outside your practice'), { status: 403 });
  }

  try {
    await unassignService(id, serviceId, actor.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (isServiceAssignmentError(err)) {
      if (err._tag === 'not_found') {
        return NextResponse.json(notFound('assignment_not_found', 'Service assignment not found'), { status: 404 });
      }
    }
    throw err;
  }
});