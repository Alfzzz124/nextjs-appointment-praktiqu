/**
 * POST /api/v1/clients/bulk/status — set status for multiple clients
 */

import { NextRequest, NextResponse } from 'next/server';
import { getActor, AuthError } from '@/lib/auth';
import { unauthorized } from '@/lib/problem-details';
import { bulkSetClientStatus, clientIdsOutsideScope } from '@/services/client/client.service';
import { CLIENT_STATUS } from '@/repositories/wp/patients.repo';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const schema = z.object({
  // WP user ids — numeric since the client store moved to wp_users (D2).
  ids: z.array(z.coerce.number().int().positive()).min(1),
  status: z.enum([CLIENT_STATUS.ACTIVE, CLIENT_STATUS.INACTIVE, CLIENT_STATUS.ARCHIVED]),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const actor = await getActor(req);
    if (!['SUPER_ADMIN', 'CLINIC_ADMIN', 'RECEPTIONIST'].includes(actor.role)) {
      return NextResponse.json(
        { type: '/errors/forbidden', title: 'Forbidden', status: 403 },
        { status: 403 },
      );
    }
    const parsed = schema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json(
        {
          type: '/errors/validation',
          title: 'Invalid input',
          status: 400,
          detail: parsed.error.issues[0]?.message,
        },
        { status: 400 },
      );
    }
    // All or nothing: one id outside the actor's clinic refuses the batch, so nothing is
    // half-applied and the single-id clinic rule cannot be bypassed in bulk.
    const outside = await clientIdsOutsideScope(actor, parsed.data.ids);
    if (outside.length > 0) {
      return NextResponse.json(
        {
          type: '/errors/forbidden',
          title: 'Forbidden',
          status: 403,
          detail: `${outside.length} of the selected clients are outside your clinic`,
        },
        { status: 403 },
      );
    }
    const count = await bulkSetClientStatus(parsed.data.ids, parsed.data.status);
    return NextResponse.json({
      message: `${count} clients updated`,
      data: { updated: count },
    });
  } catch (err) {
    console.error('[POST /clients/bulk/status]', err);
        if (err instanceof AuthError) {
      return NextResponse.json(unauthorized('unauthorized', err.message), {
        status: err.status,
        headers: { 'Content-Type': 'application/problem+json' },
      });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
