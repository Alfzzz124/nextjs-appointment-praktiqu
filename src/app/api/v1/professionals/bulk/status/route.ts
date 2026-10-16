import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { forbidden, validationError } from '@/lib/problem-details';
import { bulkSetProfessionalStatus } from '@/services/professional/professional.service';
import { ProfessionalStatus } from '@prisma/client';
import { outsideScopeResponse, professionalIdsOutsideScope } from '@/services/professional/route-scope';
import { z } from 'zod';

const schema = z.object({
  // WP user ids — numeric since professionals moved to wp_users (D2).
  ids: z.array(z.coerce.number().int().positive()).min(1),
  status: z.nativeEnum(ProfessionalStatus),
});

export const POST = withAuth(async (req: NextRequest, ctx) => {
  const { actor } = ctx as any;
  if (!['SUPER_ADMIN', 'CLINIC_ADMIN'].includes(actor.role)) {
    return NextResponse.json(forbidden('Insufficient permissions'), { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(validationError('invalid_input', parsed.error.issues[0]?.message ?? 'Invalid input'), { status: 400 });
  }
  // All or nothing: one id outside the admin's clinic refuses the batch, so nothing is
  // half-applied and the single-id clinic rule cannot be bypassed in bulk.
  const outside = await professionalIdsOutsideScope(actor, parsed.data.ids);
  if (outside.length > 0) return outsideScopeResponse(outside.length);
  const count = await bulkSetProfessionalStatus(parsed.data.ids, parsed.data.status);
  return NextResponse.json({ message: `${count} professionals updated`, data: { updated: count } });
});
