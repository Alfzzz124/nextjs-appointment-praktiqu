/**
 * GET /api/v1/professionals — list professionals (paginated, filterable)
 * POST /api/v1/professionals — create professional (Super Admin only)
 *
 * T012: GET endpoint with pagination, search, and status filter
 * T013: POST endpoint for Super Admin registration
 * T018: RBAC authorization checks
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth, Actor } from '@/lib/auth';
import { problem, validationError, conflict, forbidden } from '@/lib/problem-details';
import {
  listProfessionals,
  createProfessional,
  isServiceError,
} from '@/services/professional/professional.service';
import type { ProfessionalStatus } from '@/types/professional';
import {
  professionalListQuerySchema,
} from '@/services/professional/validation';

// ============================================
// GET /api/v1/professionals
// ============================================

export const GET = withAuth(async (req, ctx) => {
  const { actor } = ctx;
  const { searchParams } = req.nextUrl;

  // T018: Authorization — SUPER_ADMIN sees all, CLINIC_ADMIN sees own practice
  if (!['SUPER_ADMIN', 'CLINIC_ADMIN'].includes(actor.role)) {
    return NextResponse.json(
      forbidden('Only Super Admin and Clinic Admin can list professionals'),
      { status: 403 },
    );
  }

  const params = {
    page: searchParams.get('page') ? parseInt(searchParams.get('page')!) : undefined,
    pageSize: searchParams.get('pageSize') ? parseInt(searchParams.get('pageSize')!) : undefined,
    search: searchParams.get('search') ?? undefined,
    status: (searchParams.get('status') ?? undefined) as ProfessionalStatus | undefined,
    practiceId: searchParams.get('practiceId') ?? undefined,
    sortBy: (searchParams.get('sortBy') ?? undefined) as 'status' | 'email' | 'createdAt' | 'fullName' | undefined,
    sortOrder: searchParams.get('sortOrder') ?? undefined,
  };

  const result = await listProfessionals(params as any, actor.practiceId);

  return NextResponse.json(result);
});

// ============================================
// POST /api/v1/professionals
// ============================================

export const POST = withAuth(async (req, ctx) => {
  const { actor } = ctx;

  // T018: Only SUPER_ADMIN can register new professionals
  if (actor.role !== 'SUPER_ADMIN') {
    return NextResponse.json(
      forbidden('Only Super Admin can register new professionals'),
      { status: 403 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      validationError('invalid_json', 'Request body must be valid JSON'),
      { status: 400 },
    );
  }

  try {
    const result = await createProfessional(body as any, actor.id);
    return NextResponse.json({ id: result.id }, { status: 201 });
  } catch (err) {
    if (isServiceError(err)) {
      if (err._tag === 'validation') {
        return NextResponse.json(
          validationError('validation_failed', 'Professional data is invalid', undefined, err.errors),
          { status: 422 },
        );
      }
      if (err._tag === 'conflict') {
        return NextResponse.json(
          conflict(err.code, err.message),
          { status: 409 },
        );
      }
    }
    // Re-throw for generic error handler
    throw err;
  }
});