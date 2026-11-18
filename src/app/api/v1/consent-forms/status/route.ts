import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { ConsentService } from '@/services/consent/service';
import { withAuth } from '@/lib/auth';
import { forbidden } from '@/lib/problem-details';
import { consentScopeFor, forbiddenResponse, kcErrorResponse } from '@/services/consent/access';

const prisma = new PrismaClient();
const service = new ConsentService(prisma);

export const POST = withAuth(async (req, ctx) => {
  const { actor } = ctx;
  if (!['SUPER_ADMIN', 'CLINIC_ADMIN'].includes(actor.role)) {
    return NextResponse.json(forbidden(), { status: 403 });
  }
  try {
    const body = await req.json();
    const { ids, status } = body;
    if (!Array.isArray(ids) || status === undefined || status === null) {
      return NextResponse.json({ type: 'about:blank', title: 'Bad Request', status: 400 }, { status: 400 });
    }
    // A CLINIC_ADMIN changes their own clinic's forms only. Ids from other clinics are not
    // rejected one by one — they match nothing, so the count shows what actually changed.
    let practiceId: string | undefined;
    if (actor.role !== 'SUPER_ADMIN') {
      const scope = await consentScopeFor(actor);
      if (scope.kind !== 'clinic') return forbiddenResponse('No active clinic');
      practiceId = scope.clinicId;
    }
    const updated = await service.bulkSetConsentFormStatus(ids, status, practiceId);
    return NextResponse.json({ updated });
  } catch (err) {
    const kc = kcErrorResponse(err);
    if (kc) return kc;
    return NextResponse.json({ type: 'about:blank', title: 'Internal Server Error', status: 500 }, { status: 500 });
  }
});
