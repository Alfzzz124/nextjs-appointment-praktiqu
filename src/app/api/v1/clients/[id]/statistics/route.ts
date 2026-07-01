/**
 * GET /api/v1/clients/:id/statistics — session statistics for a client
 */

import { NextRequest, NextResponse } from 'next/server';
import { getActor } from '@/lib/auth';
import { getClientStatistics } from '@/services/client/client.service';

export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  try {
    const actor = await getActor(req);
    const { id } = await params;

    const canView =
      ['SUPER_ADMIN', 'CLINIC_ADMIN', 'RECEPTIONIST'].includes(actor.role) ||
      (actor.role === 'CLIENT' && actor.id === id);

    if (!canView) {
      return NextResponse.json(
        { type: '/errors/forbidden', title: 'Forbidden', status: 403 },
        { status: 403 },
      );
    }

    const stats = await getClientStatistics(id);
    return NextResponse.json({ data: stats }, { status: 200 });
  } catch (err) {
    console.error('[GET /clients/:id/statistics]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
