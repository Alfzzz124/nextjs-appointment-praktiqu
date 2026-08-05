/**
 * GET /api/v1/clients/:id/statistics — session statistics for a client
 */

import { NextRequest, NextResponse } from 'next/server';
import { getActor, AuthError } from '@/lib/auth';
import { unauthorized } from '@/lib/problem-details';
import { prisma } from '@/lib/db';
import { getClientStatistics } from '@/services/client/client.service';
import { resolveKcActor } from '@/services/billing/kc-actor';
import { findPatientById } from '@/repositories/wp/patients.repo';

/** Client ids are numeric now (D2); reject anything else before it becomes NaN. */
function parseClientId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}


export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  try {
    const actor = await getActor(req);
    const { id } = await params;

    const clientId = parseClientId(id);
    if (clientId === null) {
      return NextResponse.json(
        { type: '/errors/validation-error', title: 'Invalid client id', status: 400 },
        { status: 400 },
      );
    }
    // Authorise against WordPress, not the retired `clients` table: a patient is a
    // wp_users row, and the JWT subject is a cuid in the auth mirror rather than the
    // patient id — so self-access compares resolved WordPress ids.
    const kc = await resolveKcActor(actor);
    const patient = await findPatientById(BigInt(clientId));
    if (!patient) {
      return NextResponse.json({ error: 'Client not found' }, { status: 404 });
    }

    const isStaff = ['SUPER_ADMIN', 'CLINIC_ADMIN', 'RECEPTIONIST'].includes(actor.role);
    const isSelf = actor.role === 'CLIENT' && patient.id === kc.wpUserId;

    if (!isStaff && !isSelf) {
      return NextResponse.json(
        { type: '/errors/forbidden', title: 'Forbidden', status: 403 },
        { status: 403 },
      );
    }

    const stats = await getClientStatistics(clientId);
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
