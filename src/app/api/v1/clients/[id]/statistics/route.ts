/**
 * GET /api/v1/clients/:id/statistics — session statistics for a client
 */

import { NextRequest, NextResponse } from 'next/server';
import { getActor, AuthError } from '@/lib/auth';
import { unauthorized } from '@/lib/problem-details';
import { prisma } from '@/lib/db';
import { getClientStatistics } from '@/services/client/client.service';

export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  try {
    const actor = await getActor(req);
    const { id } = await params;

    const client = await prisma.client.findUnique({ where: { id }, select: { userId: true } });
    if (!client) {
      return NextResponse.json({ error: 'Client not found' }, { status: 404 });
    }

    const isStaff = ['SUPER_ADMIN', 'CLINIC_ADMIN', 'RECEPTIONIST'].includes(actor.role);
    const isSelf = actor.role === 'CLIENT' && client.userId === actor.id;

    if (!isStaff && !isSelf) {
      return NextResponse.json(
        { type: '/errors/forbidden', title: 'Forbidden', status: 403 },
        { status: 403 },
      );
    }

    const stats = await getClientStatistics(id);
    return NextResponse.json({ data: stats }, { status: 200 });
  } catch (err) {
    console.error('[GET /clients/:id/statistics]', err);
        if (err instanceof AuthError) {
      return NextResponse.json(unauthorized('unauthorized', err.message), {
        status: err.status,
        headers: { 'Content-Type': 'application/problem+json' },
      });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
