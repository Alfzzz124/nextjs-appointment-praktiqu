/**
 * GET /api/v1/professionals/[id] — read a professional
 * PATCH /api/v1/professionals/[id] — partial update
 * DELETE /api/v1/professionals/[id] — soft-delete (set INACTIVE)
 *
 * T014: GET endpoint
 * T015: PATCH endpoint
 * T018: RBAC authorization
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { notFound, forbidden, validationError } from '@/lib/problem-details';
import {
  getProfessional,
  updateProfessional,
  deactivateProfessional,
  listProfessionals,
  isServiceError,
} from '@/services/professional/professional.service';

type RouteParams = { params: { id: string } };

// ============================================
// GET /api/v1/professionals/:id
// ============================================

export const GET = withAuth(async (req: NextRequest, ctx: RouteParams) => {
  const { actor } = ctx as { actor: Actor; params: RouteParams['params'] };
  const { id } = ctx.params;

  const professional = await getProfessional(id);
  if (!professional) {
    return NextResponse.json(notFound('professional_not_found', 'Professional not found'), { status: 404 });
  }

  // RBAC: SUPER_ADMIN all, CLINIC_ADMIN own practice, PROFESSIONAL self, RECEPTIONIST own practice read-only
  const canView =
    actor.role === 'SUPER_ADMIN' ||
    actor.role === 'CLINIC_ADMIN' ||
    (actor.role === 'PROFESSIONAL' && actor.id === professional.userId) ||
    (actor.role === 'RECEPTIONIST' && actor.practiceId === professional.practiceId);

  if (!canView) {
    return NextResponse.json(forbidden('Cannot view this professional'), { status: 403 });
  }

  return NextResponse.json(professional);
});

// ============================================
// PATCH /api/v1/professionals/:id
// ============================================

export const PATCH = withAuth(async (req: NextRequest, ctx: RouteParams) => {
  const { actor } = ctx as { actor: Actor; params: RouteParams['params'] };
  const { id } = ctx.params;

  const professional = await getProfessional(id);
  if (!professional) {
    return NextResponse.json(notFound('professional_not_found', 'Professional not found'), { status: 404 });
  }

  // Determine if this is a self-edit (US2)
  const isSelfEdit = actor.role === 'PROFESSIONAL' && actor.id === professional.userId;

  if (isSelfEdit) {
    // US2: Professional can only edit biography, specialties, contactInfo
    // Cannot self-deactivate (FR-013)
  } else {
    // SUPER_ADMIN / CLINIC_ADMIN: can update more fields
    if (!['SUPER_ADMIN', 'CLINIC_ADMIN'].includes(actor.role)) {
      return NextResponse.json(forbidden('Cannot update this professional'), { status: 403 });
    }
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(validationError('invalid_json', 'Request body must be valid JSON'), { status: 400 });
  }

  try {
    await updateProfessional(id, body, actor.id, isSelfEdit);
    const updated = await getProfessional(id);
    return NextResponse.json(updated ?? { ok: true });
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
    }
    throw err;
  }
});

// ============================================
// DELETE /api/v1/professionals/:id (soft-delete)
// ============================================

export const DELETE = withAuth(async (req: NextRequest, ctx: RouteParams) => {
  const { actor } = ctx as { actor: Actor; params: RouteParams['params'] };
  const { id } = ctx.params;

  if (!['SUPER_ADMIN', 'CLINIC_ADMIN'].includes(actor.role)) {
    return NextResponse.json(forbidden('Cannot deactivate this professional'), { status: 403 });
  }

  const professional = await getProfessional(id);
  if (!professional) {
    return NextResponse.json(notFound('professional_not_found', 'Professional not found'), { status: 404 });
  }

  // FR-013: Professional cannot self-deactivate
  if (actor.role === 'PROFESSIONAL') {
    return NextResponse.json(forbidden('Professional cannot self-deactivate'), { status: 403 });
  }

  await deactivateProfessional(id, actor.id);
  return NextResponse.json({ ok: true });
});

// Need to import Actor type
import type { Actor } from '@/lib/auth';