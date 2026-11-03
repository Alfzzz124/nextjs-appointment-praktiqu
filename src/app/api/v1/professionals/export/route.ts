import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { forbidden } from '@/lib/problem-details';
import { exportProfessionals } from '@/services/professional/professional.service';
import { resolveKcActor } from '@/services/billing/kc-actor';
import { ProfessionalStatus } from '@prisma/client';
import { z } from 'zod';

export const GET = withAuth(async (req: NextRequest, ctx) => {
  const { actor } = ctx as any;
  if (!['SUPER_ADMIN', 'CLINIC_ADMIN'].includes(actor.role)) {
    return NextResponse.json(forbidden('Insufficient permissions'), { status: 403 });
  }
  const { searchParams } = req.nextUrl;
  const rawStatus = searchParams.get('status');
  const statusParsed = z.nativeEnum(ProfessionalStatus).optional().safeParse(rawStatus ?? undefined);
  // The service filters on clinicId; this used to pass the JWT's practiceId, a cuid from
  // the retired shadow schema, so nothing was filtered and a clinic admin exported every
  // clinic's professionals. A clinic admin is now confined to their clinic via
  // resolveKcActor (honouring X-Praktiqu-Clinic-Id), and one with no clinic gets -1,
  // which matches nothing. Only a SUPER_ADMIN may name a clinic.
  let clinicId: number | undefined;
  if (actor.role === 'SUPER_ADMIN') {
    const requested = Number(searchParams.get('clinicId') ?? searchParams.get('practiceId'));
    clinicId = Number.isFinite(requested) && requested > 0 ? requested : undefined;
  } else {
    const kc = await resolveKcActor(actor);
    clinicId = kc.clinicId === null ? -1 : Number(kc.clinicId);
  }
  const params = {
    clinicId,
    status: statusParsed.success ? statusParsed.data : undefined,
  };
  const data = await exportProfessionals(params);
  return NextResponse.json(
    { status: true, message: 'Professionals data retrieved successfully', data },
    { headers: { 'Content-Disposition': 'attachment; filename="professionals-export.json"' } },
  );
});
