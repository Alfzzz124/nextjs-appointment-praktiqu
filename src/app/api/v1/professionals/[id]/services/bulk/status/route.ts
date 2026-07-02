/**
 * POST /api/v1/professionals/[id]/services/bulk/status
 * Bulk set status for doctor service assignments.
 * Auth: SUPER_ADMIN | CLINIC_ADMIN
 * Task 10
 */

import { NextRequest, NextResponse } from 'next/server';
import { getActor } from '@/lib/auth';
import { bulkSetDoctorServiceStatus } from '@/services/professional/service-assignment.service';

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
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const { serviceIds, status } = body as { serviceIds?: string[]; status?: string };
    if (!Array.isArray(serviceIds) || serviceIds.length === 0) {
      return NextResponse.json(
        { error: 'serviceIds must be a non-empty array' },
        { status: 422 },
      );
    }
    if (!status) {
      return NextResponse.json({ error: 'status is required' }, { status: 422 });
    }

    const updated = await bulkSetDoctorServiceStatus(params.id, serviceIds, status);
    return NextResponse.json({ updated });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
