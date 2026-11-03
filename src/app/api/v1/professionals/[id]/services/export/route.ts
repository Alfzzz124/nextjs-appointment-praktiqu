/**
 * GET /api/v1/professionals/[id]/services/export
 * Export doctor service assignments as JSON attachment.
 * Auth: SUPER_ADMIN (every clinic) | CLINIC_ADMIN (own clinic's professionals and rows only)
 * Task 10
 */

import { NextRequest, NextResponse } from 'next/server';
import { getActor, AuthError } from '@/lib/auth';
import { unauthorized } from '@/lib/problem-details';
import { exportDoctorServices } from '@/services/professional/service-assignment.service';
import { canEdit, scopeFor } from '@/services/professional/route-scope';

/** Doctor ids are numeric now (D2); reject anything else before it becomes NaN. */
function parseDoctorId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}


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

    const doctorId = parseDoctorId(params.id);
    if (doctorId === null) {
      return NextResponse.json(
        { type: '/errors/validation-error', title: 'Invalid professional id', status: 400 },
        { status: 400 },
      );
    }

    const scope = await scopeFor(actor, doctorId);
    if (!scope) {
      return NextResponse.json(
        { type: '/errors/not-found', title: 'Professional not found', status: 404 },
        { status: 404 },
      );
    }
    if (!canEdit(scope, actor.role)) {
      return NextResponse.json(
        { type: '/errors/forbidden', title: 'Forbidden', status: 403 },
        { status: 403 },
      );
    }
    // A professional shared with another clinic keeps a mapping row there too; a
    // CLINIC_ADMIN gets their own clinic's rows only.
    const clinicId = actor.role === 'SUPER_ADMIN' ? undefined : Number(scope.kc.clinicId);
    const data = await exportDoctorServices(doctorId, clinicId);

    return NextResponse.json(data, {
      headers: {
        'Content-Disposition': `attachment; filename="doctor-services-${params.id}.json"`,
      },
    });
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
