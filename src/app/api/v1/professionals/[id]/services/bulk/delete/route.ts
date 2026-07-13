/**
 * POST /api/v1/professionals/[id]/services/bulk/delete
 * Bulk delete (unassign) doctor services.
 * Auth: SUPER_ADMIN | CLINIC_ADMIN
 * Task 10
 */

import { NextRequest, NextResponse } from 'next/server';
import { getActor, AuthError } from '@/lib/auth';
import { unauthorized } from '@/lib/problem-details';
import { bulkDeleteDoctorServices } from '@/services/professional/service-assignment.service';

type RouteParams = { params: { id: string } };

export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const actor = await getActor(req);
    if (!['SUPER_ADMIN', 'CLINIC_ADMIN'].includes(actor.role)) {
      return NextResponse.json(
        { type: '/errors/forbidden', title: 'Forbidden', status: 403 },
        { status: 403 },
      );
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch (err) {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const { serviceIds } = body as { serviceIds?: string[] };
    if (!Array.isArray(serviceIds) || serviceIds.length === 0) {
      return NextResponse.json(
        { error: 'serviceIds must be a non-empty array' },
        { status: 422 },
      );
    }

    const updated = await bulkDeleteDoctorServices(params.id, serviceIds);
    return NextResponse.json({ updated });
  } catch (err) {
        if (err instanceof AuthError) {
      return NextResponse.json(unauthorized('unauthorized', err.message), {
        status: err.status,
        headers: { 'Content-Type': 'application/problem+json' },
      });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
