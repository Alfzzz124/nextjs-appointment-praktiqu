import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { forbidden, validationError } from '@/lib/problem-details';
import { bulkDeleteProfessionals } from '@/services/professional/professional.service';
import { outsideScopeResponse, professionalIdsOutsideScope } from '@/services/professional/route-scope';
import { z } from 'zod';

// WP user ids — numeric since professionals moved to wp_users (D2).
const schema = z.object({ ids: z.array(z.coerce.number().int().positive()).min(1) });

export const POST = withAuth(async (req: NextRequest, ctx) => {
  const { actor } = ctx as any;
  if (!['SUPER_ADMIN', 'CLINIC_ADMIN'].includes(actor.role)) {
    return NextResponse.json(forbidden('Insufficient permissions'), { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(validationError('invalid_input', parsed.error.issues[0]?.message ?? 'ids must be a non-empty array of positive integers'), { status: 400 });
  }
  // All or nothing: one id outside the admin's clinic refuses the batch, so nothing is
  // half-applied and the single-id clinic rule cannot be bypassed in bulk.
  const outside = await professionalIdsOutsideScope(actor, parsed.data.ids);
  if (outside.length > 0) return outsideScopeResponse(outside.length);
  const count = await bulkDeleteProfessionals(parsed.data.ids);
  return NextResponse.json({ message: `${count} professionals deactivated successfully`, data: { updated: count } });
});
