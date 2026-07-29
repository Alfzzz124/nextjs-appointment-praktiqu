/**
 * POST /api/v1/professionals/[id]/services/bulk/status
 * Bulk set status for doctor service assignments.
 * Auth: SUPER_ADMIN | CLINIC_ADMIN
 * Task 10
 */

import { NextRequest, NextResponse } from 'next/server';
import { getActor, AuthError } from '@/lib/auth';
import { unauthorized } from '@/lib/problem-details';
import { bulkSetDoctorServiceStatus } from '@/services/professional/service-assignment.service';

/** Doctor ids are numeric now (D2); reject anything else before it becomes NaN. */
function parseDoctorId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}


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

    const doctorId = parseDoctorId(params.id);
    if (doctorId === null) {
      return NextResponse.json(
        { type: '/errors/validation-error', title: 'Invalid professional id', status: 400 },
        { status: 400 },
      );
    }
    const updated = await bulkSetDoctorServiceStatus(doctorId, serviceIds.map(Number), status);
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
