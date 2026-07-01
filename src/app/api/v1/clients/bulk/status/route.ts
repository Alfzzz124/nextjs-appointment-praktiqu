/**
 * POST /api/v1/clients/bulk/status — set status for multiple clients
 */

import { NextRequest, NextResponse } from 'next/server';
import { getActor } from '@/lib/auth';
import { bulkSetClientStatus } from '@/services/client/client.service';
import { ClientStatus } from '@prisma/client';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const schema = z.object({
  ids: z.array(z.string()).min(1),
  status: z.nativeEnum(ClientStatus),
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
    const count = await bulkSetClientStatus(parsed.data.ids, parsed.data.status);
    return NextResponse.json({
      message: `${count} clients updated`,
      data: { updated: count },
    });
  } catch (err) {
    console.error('[POST /clients/bulk/status]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
