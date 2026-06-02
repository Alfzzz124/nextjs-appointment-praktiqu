// src/app/api/v1/consent-forms/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { ConsentService, consentFormCreateSchema } from '@/services/consent/service';

const prisma = new PrismaClient();
const service = new ConsentService(prisma);

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const practiceId = searchParams.get('practiceId') ?? undefined;
  const status = searchParams.get('status') ?? undefined;
  if (!practiceId) return NextResponse.json({ type: 'about:blank', title: 'Bad Request', status: 400 }, { status: 400 });
  const forms = await service.listForms(practiceId, status);
  return NextResponse.json({ items: forms });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = consentFormCreateSchema.parse(body);
    const created = await service.createForm(parsed);
    return NextResponse.json(created, { status: 201 });
  } catch (err: any) {
    if (err?.name === 'ZodError') return NextResponse.json({ type: 'about:blank', title: 'Validation failed', status: 400 }, { status: 400 });
    return NextResponse.json({ type: 'about:blank', title: 'Internal Server Error', status: 500 }, { status: 500 });
  }
}