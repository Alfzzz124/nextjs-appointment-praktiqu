/**
 * GET /api/v1/clients/:id/statistics — session statistics for a client
 */

import { NextRequest, NextResponse } from 'next/server';
import { getActor, AuthError } from '@/lib/auth';
import { unauthorized } from '@/lib/problem-details';
import { getClientStatistics, assertClientAccess, ClientServiceError } from '@/services/client/client.service';

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
    // Same scope as GET /clients/:id (clinic, own patient, or a professional's seen
    // clients). A role list alone let any clinic's admin read another clinic's patient.
    await assertClientAccess(actor, clientId);

    const stats = await getClientStatistics(clientId);
    return NextResponse.json({ data: stats }, { status: 200 });
  } catch (err) {
    console.error('[GET /clients/:id/statistics]', err);
    if (err instanceof ClientServiceError) {
      return NextResponse.json(
        { type: `/errors/${err.code ?? 'error'}`, title: err.message, status: err.status },
        { status: err.status },
      );
    }
    if (err instanceof AuthError) {
      return NextResponse.json(unauthorized('unauthorized', err.message), {
        status: err.status,
        headers: { 'Content-Type': 'application/problem+json' },
      });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
