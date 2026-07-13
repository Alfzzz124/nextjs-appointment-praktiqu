// src/app/api/v1/consent-signatures/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/route-guards';
import { PrismaClient } from '@prisma/client';
import { ConsentService } from '@/services/consent/service';

const prisma = new PrismaClient();
const service = new ConsentService(prisma);

export async function POST(req: NextRequest) {
  const gate = await requireAuth(req);
  if ('response' in gate) return gate.response;

  try {
    const body = await req.json();
    if (body.action === 'send') {
      const sig = await service.sendSignatureRequest(body.formId, body.clientId);
      return NextResponse.json(sig, { status: 201 });
    }
    if (body.status === 'SIGNED' || body.status === 'DECLINED') {
      const sig = await service.sign(body.formId, body.clientId, body);
      return NextResponse.json(sig);
    }
    return NextResponse.json({ type: 'about:blank', title: 'Bad Request', status: 400 }, { status: 400 });
  } catch (err: any) {
    if (err?.name === 'ZodError') return NextResponse.json({ type: 'about:blank', title: 'Validation failed', status: 400 }, { status: 400 });
    return NextResponse.json({ type: 'about:blank', title: 'Internal Server Error', status: 500 }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const gate = await requireAuth(req);
  if ('response' in gate) return gate.response;

  const { searchParams } = new URL(req.url);
  const formId = searchParams.get('formId') ?? '';
  const clientId = searchParams.get('clientId') ?? '';
  const sig = await service.getSignatureStatus(formId, clientId);
  return NextResponse.json(sig ?? { status: null });
}