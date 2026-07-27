/**
 * GET /api/v1/clients/export — export clients as JSON with Content-Disposition header
 */

import { NextRequest, NextResponse } from 'next/server';
import { getActor, AuthError } from '@/lib/auth';
import { unauthorized } from '@/lib/problem-details';
import { exportClients } from '@/services/client/client.service';
import { CLIENT_STATUS } from '@/repositories/wp/patients.repo';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const statusSchema = z.enum([CLIENT_STATUS.ACTIVE, CLIENT_STATUS.INACTIVE, CLIENT_STATUS.ARCHIVED]).optional();

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const actor = await getActor(req);
    if (!['SUPER_ADMIN', 'CLINIC_ADMIN', 'RECEPTIONIST'].includes(actor.role)) {
      return NextResponse.json(
        { type: '/errors/forbidden', title: 'Forbidden', status: 403 },
        { status: 403 },
      );
    }

    const rawStatus = req.nextUrl.searchParams.get('status') ?? undefined;
    const parsedStatus = statusSchema.safeParse(rawStatus);
    if (!parsedStatus.success) {
      return NextResponse.json(
        { type: '/errors/validation', title: 'Invalid status', status: 400 },
        { status: 400 },
      );
    }

    const clinicIdRaw =
      actor.role === 'SUPER_ADMIN'
        ? (req.nextUrl.searchParams.get('clinicId') ?? undefined)
        : undefined;

    // Non-super-admins are scoped by the service via resolveKcActor; only a
    // SUPER_ADMIN may name a clinic explicitly.
    const clinicId = clinicIdRaw !== undefined ? Number(clinicIdRaw) : undefined;
    const rows = await exportClients({
      clinicId: Number.isFinite(clinicId) ? clinicId : undefined,
      status: parsedStatus.data,
    });

    return new NextResponse(JSON.stringify(rows), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': 'attachment; filename="clients-export.json"',
      },
    });
  } catch (err) {
    console.error('[GET /clients/export]', err);
        if (err instanceof AuthError) {
      return NextResponse.json(unauthorized('unauthorized', err.message), {
        status: err.status,
        headers: { 'Content-Type': 'application/problem+json' },
      });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
