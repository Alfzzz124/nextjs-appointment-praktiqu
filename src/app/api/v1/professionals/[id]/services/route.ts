/**
 * GET /api/v1/professionals/[id]/services — list assigned services. Still live.
 *
 * POST and DELETE are RETIRED and answer 410 — see `retired-endpoints.ts` for why, and
 * for the removal date. Writing to `wp_kc_service_doctor_mapping` is `/api/v1/services`'s
 * job now; two writers disagreeing about the rules is what this closes.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { forbidden, notFound } from '@/lib/problem-details';
import { listAssignedServices } from '@/services/professional/service-assignment.service';
import { assignRetired, unassignRetired } from '@/services/professional/retired-endpoints';
import type { Actor } from '@/lib/auth';
import {
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
// POST /api/v1/professionals/:id/services — RETIRED
// ============================================
//
// No auth check on purpose: the endpoint is gone for everyone, so who is asking does not
// change the answer. Returning 401 first would imply that a better token would work.

export const POST = async () => assignRetired();

// ============================================
// DELETE /api/v1/professionals/:id/services — RETIRED
// ============================================

export const DELETE = async () => unassignRetired();
