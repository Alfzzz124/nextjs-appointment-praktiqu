// src/app/api/v1/notes-templates/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { NoteTemplateService, noteTemplateUpdateSchema } from '@/services/notes-templates/service';

const prisma = new PrismaClient();
const service = new NoteTemplateService(prisma);

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const item = await service.get(params.id);
  if (!item) {
    return NextResponse.json(
      { type: 'about:blank', title: 'Not Found', status: 404 },
      { status: 404 }
    );
  }
  return NextResponse.json(item);
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json();
    const parsed = noteTemplateUpdateSchema.parse(body);
    const updated = await service.update(params.id, parsed);
    return NextResponse.json(updated);
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

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  await service.delete(params.id);
  return new NextResponse(null, { status: 204 });
}
