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
import {
  canEdit,
  canView,
  invalidIdResponse,
  parseProfessionalId,
  scopeFor,
} from '@/services/professional/route-scope';

type RouteParams = { params: { id: string } };

// ============================================
// GET /api/v1/professionals/:id/services
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
    return NextResponse.json(forbidden("Cannot view this professional's services"), { status: 403 });
  }

  const services = await listAssignedServices(id);

  return NextResponse.json({
    professionalId: id,
    services: services.map((s) => ({
      id: s.id,
      serviceId: s.serviceId,
      serviceName: s.serviceName,
      // Duration and charge come from the doctor's own mapping row, which is what a
      // patient is actually billed and booked for.
      durationMinutes: s.durationMinutes,
      charges: s.charges,
      isPublic: s.isPublic,
    })),
  });
});

// ============================================
// POST /api/v1/professionals/:id/services — assign service
// ============================================

export const POST = withAuth(async (req: NextRequest, ctx: RouteParams) => {
  const { actor } = ctx as { actor: Actor; params: RouteParams['params'] };
  const id = parseProfessionalId(ctx.params.id);
  if (id === null) return invalidIdResponse();

  // SUPER_ADMIN and CLINIC_ADMIN can assign (US5)
  if (!['SUPER_ADMIN', 'CLINIC_ADMIN'].includes(actor.role)) {
    return NextResponse.json(forbidden('Only Super Admin and Clinic Admin can assign services'), { status: 403 });
  }

  const { getProfessional } = await import('@/services/professional/professional.service');
  const professional = await getProfessional(id);

  const scope = await scopeFor(actor, id);
  if (!scope) {
    return NextResponse.json(notFound('professional_not_found', 'Professional not found'), { status: 404 });
  }
  if (!canEdit(scope, actor.role)) {
    return NextResponse.json(
      forbidden('Cannot assign services to a professional outside your clinic'),
      { status: 403 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(validationError('invalid_json', 'Request body must be valid JSON'), { status: 400 });
  }

  const parsedBody = body as { serviceId?: number | string; clinicId?: number };
  if (!parsedBody?.serviceId) {
    return NextResponse.json(validationError('missing_service_id', 'serviceId is required'), { status: 422 });
  }

  try {
    const result = await assignService(id, Number(parsedBody.serviceId), Number(parsedBody.clinicId ?? scope.kc.clinicId ?? 0), actor.id);
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
  const id = parseProfessionalId(ctx.params.id);
  if (id === null) return invalidIdResponse();
  const { searchParams } = req.nextUrl;
  const serviceId = searchParams.get('serviceId');

  if (!serviceId) {
    return NextResponse.json(validationError('missing_service_id', 'serviceId query param required'), { status: 400 });
  }

  if (!['SUPER_ADMIN', 'CLINIC_ADMIN'].includes(actor.role)) {
    return NextResponse.json(forbidden('Only Super Admin and Clinic Admin can unassign services'), { status: 403 });
  }

  const scope = await scopeFor(actor, id);
  if (!scope) {
    return NextResponse.json(notFound('professional_not_found', 'Professional not found'), { status: 404 });
  }
  // Clinic scoping now comes from wp_kc_doctor_clinic_mappings rather than the JWT's
  // practiceId, which was a cuid from the retired shadow schema.
  if (!canEdit(scope, actor.role)) {
    return NextResponse.json(
      forbidden('Cannot unassign services from a professional outside your clinic'),
      { status: 403 },
    );
  }

  try {
    await unassignService(id, Number(serviceId), actor.id);
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