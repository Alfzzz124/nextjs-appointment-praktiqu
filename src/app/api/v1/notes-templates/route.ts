// src/app/api/v1/notes-templates/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { NoteTemplateService, noteTemplateCreateSchema } from '@/services/notes-templates/service';

const prisma = new PrismaClient();
const service = new NoteTemplateService(prisma);

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const clinicId = searchParams.get('clinicId') ?? undefined;
  const ownerId = searchParams.get('ownerId') ?? undefined;
  const category = searchParams.get('category') ?? undefined;
  try {
    const items = await service.list({ clinicId, ownerId, category });
    return NextResponse.json({ items });
  } catch (err) {
    return NextResponse.json(
      { type: 'about:blank', title: 'Internal Server Error', status: 500 },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = noteTemplateCreateSchema.parse(body);
    const created = await service.create(parsed);
    return NextResponse.json(created, { status: 201 });
  } catch (err: any) {
    if (err?.name === 'ZodError') {
      return NextResponse.json(
        { type: 'about:blank', title: 'Validation failed', status: 400, errors: err.errors },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { type: 'about:blank', title: 'Internal Server Error', status: 500 },
      { status: 500 }
    );
  }
}
