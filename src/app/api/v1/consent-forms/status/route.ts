import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { ConsentService } from '@/services/consent/service';
import { getActor } from '@/lib/auth';

const prisma = new PrismaClient();
const service = new ConsentService(prisma);

export async function POST(req: NextRequest) {
  try {
    const actor = await getActor(req);
    if (!['SUPER_ADMIN', 'CLINIC_ADMIN'].includes(actor.role)) {
      return NextResponse.json({ type: 'about:blank', title: 'Forbidden', status: 403 }, { status: 403 });
    }
    const body = await req.json();
    const { ids, status } = body;
    if (!Array.isArray(ids) || status === undefined || status === null) {
      return NextResponse.json({ type: 'about:blank', title: 'Bad Request', status: 400 }, { status: 400 });
    }
    const updated = await service.bulkSetConsentFormStatus(ids, status);
    return NextResponse.json({ updated });
  } catch {
    return NextResponse.json({ type: 'about:blank', title: 'Internal Server Error', status: 500 }, { status: 500 });
  }
}
