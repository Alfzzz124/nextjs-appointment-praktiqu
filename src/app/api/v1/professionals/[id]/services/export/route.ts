/**
 * GET /api/v1/professionals/[id]/services/export
 * Export doctor service assignments as JSON attachment.
 * Auth: SUPER_ADMIN | CLINIC_ADMIN
 * Task 10
 */

import { NextRequest, NextResponse } from 'next/server';
import { getActor } from '@/lib/auth';
import { exportDoctorServices } from '@/services/professional/service-assignment.service';

type RouteParams = { params: { id: string } };

export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    const actor = await getActor(req);
    if (!['SUPER_ADMIN', 'CLINIC_ADMIN'].includes(actor.role)) {
      return NextResponse.json(
        { type: '/errors/forbidden', title: 'Forbidden', status: 403 },
        { status: 403 },
      );
    }

    const data = await exportDoctorServices(params.id);

    return NextResponse.json(data, {
      headers: {
        'Content-Disposition': `attachment; filename="doctor-services-${params.id}.json"`,
      },
    });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
