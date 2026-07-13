// src/app/api/v1/consent-forms/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { ConsentService } from '@/services/consent/service';
import { withAuth } from '@/lib/auth';
import { requireAuth, requireRoles } from '@/lib/auth/route-guards';
import { forbidden } from '@/lib/problem-details';

const prisma = new PrismaClient();
const service = new ConsentService(prisma);

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const gate = await requireAuth(req);
  if ('response' in gate) return gate.response;
  const form = await service.getForm(params.id);
  if (!form) return NextResponse.json({ type: 'about:blank', title: 'Not Found', status: 404 }, { status: 404 });
  return NextResponse.json(form);
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const gate = await requireRoles(req, ['SUPER_ADMIN', 'CLINIC_ADMIN']);
  if ('response' in gate) return gate.response;
  try {
    const body = await req.json();
    const updated = await service.updateForm(params.id, body);
    return NextResponse.json(updated);
  } catch (err: any) {
    if (err?.name === 'ZodError') return NextResponse.json({ type: 'about:blank', title: 'Validation failed', status: 400 }, { status: 400 });
    return NextResponse.json({ type: 'about:blank', title: 'Internal Server Error', status: 500 }, { status: 500 });
  }
}

export const DELETE = withAuth(async (req, ctx) => {
  const { actor } = ctx;
  if (!['SUPER_ADMIN', 'CLINIC_ADMIN'].includes(actor.role)) {
    return NextResponse.json(forbidden(), { status: 403 });
  }
  const { id } = (ctx as any).params;
  try {
    await service.deleteForm(id);
    return NextResponse.json({ message: 'Deleted' });
  } catch (err: any) {
    if (err?.code === 'not_found') return NextResponse.json({ type: 'about:blank', title: 'Not Found', status: 404 }, { status: 404 });
    return NextResponse.json({ type: 'about:blank', title: 'Internal Server Error', status: 500 }, { status: 500 });
  }
});
