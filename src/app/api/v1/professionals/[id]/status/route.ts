/**
 * PATCH /api/v1/professionals/[id]/status — activate/deactivate
 *
 * T016: Status change endpoint
 * T018: RBAC authorization
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { notFound, forbidden, validationError } from '@/lib/problem-details';
import {
  setProfessionalStatus,
  getProfessional,
  isServiceError,
} from '@/services/professional/professional.service';
import { ProfessionalStatus } from '@prisma/client';
import type { Actor } from '@/lib/auth';

type RouteParams = { params: { id: string } };

// ============================================
// PATCH /api/v1/professionals/:id/status
// ============================================

export const PATCH = withAuth(async (req: NextRequest, ctx: RouteParams) => {
  const { actor } = ctx as { actor: Actor; params: RouteParams['params'] };
  const { id } = ctx.params;

  // T018: SUPER_ADMIN all, CLINIC_ADMIN own practice
  if (!['SUPER_ADMIN', 'CLINIC_ADMIN'].includes(actor.role)) {
    return NextResponse.json(
      forbidden('Only Super Admin and Clinic Admin can change professional status'),
      { status: 403 },
    );
  }

  const professional = await getProfessional(id);
  if (!professional) {
    return NextResponse.json(notFound('professional_not_found', 'Professional not found'), { status: 404 });
  }

  // CLINIC_ADMIN: can only affect their own practice
  if (actor.role === 'CLINIC_ADMIN' && actor.practiceId !== professional.practiceId) {
    return NextResponse.json(forbidden('Cannot change status of professional outside your practice'), { status: 403 });
  }

  // FR-013: Professional cannot self-deactivate
  if (actor.role === 'PROFESSIONAL') {
    return NextResponse.json(forbidden('Professional cannot change their own status'), { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(validationError('invalid_json', 'Request body must be valid JSON'), { status: 400 });
  }

  const parsedBody = body as { status?: string };
  const newStatus = parsedBody?.status as ProfessionalStatus | undefined;

  if (!newStatus || !['PENDING_ACTIVATION', 'ACTIVE', 'INACTIVE'].includes(newStatus)) {
    return NextResponse.json(
      validationError('invalid_status', 'Status must be one of: PENDING_ACTIVATION, ACTIVE, INACTIVE'),
      { status: 422 },
    );
  }

  try {
    await setProfessionalStatus(id, newStatus, actor.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (isServiceError(err)) {
      if (err._tag === 'not_found') {
        return NextResponse.json(notFound('professional_not_found', 'Professional not found'), { status: 404 });
      }
    }
    throw err;
  }
});