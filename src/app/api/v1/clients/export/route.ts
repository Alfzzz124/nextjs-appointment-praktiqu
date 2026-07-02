/**
 * GET /api/v1/clients/export — export clients as JSON with Content-Disposition header
 */

import { NextRequest, NextResponse } from 'next/server';
import { getActor } from '@/lib/auth';
import { exportClients } from '@/services/client/client.service';
import { ClientStatus } from '@prisma/client';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const statusSchema = z.nativeEnum(ClientStatus).optional();

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

    const practiceId =
      actor.role === 'SUPER_ADMIN'
        ? (req.nextUrl.searchParams.get('practiceId') ?? undefined)
        : (actor.practiceId ?? undefined);

    const rows = await exportClients({ practiceId, status: parsedStatus.data });

    return new NextResponse(JSON.stringify(rows), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': 'attachment; filename="clients-export.json"',
      },
    });
  } catch (err) {
    console.error('[GET /clients/export]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
