import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { forbidden, validationError } from '@/lib/problem-details';
import { bulkSetProfessionalStatus } from '@/services/professional/professional.service';
import { ProfessionalStatus } from '@prisma/client';
import { z } from 'zod';

const schema = z.object({
  ids: z.array(z.string()).min(1),
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
  const count = await bulkSetProfessionalStatus(parsed.data.ids, parsed.data.status);
  return NextResponse.json({ message: `${count} professionals updated`, data: { updated: count } });
});
