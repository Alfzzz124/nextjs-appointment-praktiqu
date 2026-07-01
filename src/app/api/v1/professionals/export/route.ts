import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { forbidden } from '@/lib/problem-details';
import { exportProfessionals } from '@/services/professional/professional.service';
import { ProfessionalStatus } from '@prisma/client';

export const GET = withAuth(async (req: NextRequest, ctx) => {
  const { actor } = ctx as any;
  if (!['SUPER_ADMIN', 'CLINIC_ADMIN'].includes(actor.role)) {
    return NextResponse.json(forbidden('Insufficient permissions'), { status: 403 });
  }
  const { searchParams } = req.nextUrl;
  const params = {
    practiceId: actor.role === 'CLINIC_ADMIN' ? actor.practiceId : (searchParams.get('practiceId') ?? undefined),
    status: (searchParams.get('status') as ProfessionalStatus | null) ?? undefined,
  };
  const data = await exportProfessionals(params);
  return NextResponse.json(
    { status: true, message: 'Professionals data retrieved successfully', data },
    { headers: { 'Content-Disposition': 'attachment; filename="professionals-export.json"' } },
  );
});
