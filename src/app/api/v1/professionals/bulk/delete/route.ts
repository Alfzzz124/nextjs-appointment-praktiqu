import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { forbidden, validationError } from '@/lib/problem-details';
import { bulkDeleteProfessionals } from '@/services/professional/professional.service';
import { z } from 'zod';

const schema = z.object({ ids: z.array(z.string()).min(1) });

export const POST = withAuth(async (req: NextRequest, ctx) => {
  const { actor } = ctx as any;
  if (!['SUPER_ADMIN', 'CLINIC_ADMIN'].includes(actor.role)) {
    return NextResponse.json(forbidden('Insufficient permissions'), { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(validationError('invalid_input', 'ids must be a non-empty array of strings'), { status: 400 });
  }
  const count = await bulkDeleteProfessionals(parsed.data.ids);
  return NextResponse.json({ message: `${count} professionals deactivated successfully`, data: { updated: count } });
});
