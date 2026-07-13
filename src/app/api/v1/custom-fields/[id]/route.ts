/**
 * /api/v1/custom-fields/[id]
 *
 * GET    — get a field definition by id
 * PATCH  — update a field definition
 * DELETE — soft-delete a field definition (sets status = 0)
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireRoles, requireAuth } from '@/lib/auth/route-guards';
import { PrismaClient } from '@prisma/client';
import {
  CustomFieldService,
  CustomFieldError,
  customFieldUpdateSchema,
} from '@/services/custom-fields/service';

const prisma = new PrismaClient();
const service = new CustomFieldService(prisma);

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const gate = await requireAuth(_req);
  if ('response' in gate) return gate.response;

  try {
    const item = await service.getField(params.id);
    if (!item) {
      return NextResponse.json(
        { type: 'about:blank', title: 'Not Found', status: 404 },
        { status: 404 },
      );
    }
    return NextResponse.json(item);
  } catch (err) {
    if (err instanceof CustomFieldError) {
      return NextResponse.json(
        { type: 'about:blank', title: err.message, status: err.status, code: err.code },
        { status: err.status },
      );
    }
    return NextResponse.json({ type: 'about:blank', title: 'Internal Server Error', status: 500 }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const gate = await requireRoles(req, ['SUPER_ADMIN', 'CLINIC_ADMIN']);
  if ('response' in gate) return gate.response;

  try {
    const body = await req.json();
    const parsed = customFieldUpdateSchema.parse(body);
    const updated = await service.updateField(params.id, parsed);
    return NextResponse.json(updated);
  } catch (err: unknown) {
    if (err instanceof CustomFieldError) {
      return NextResponse.json(
        { type: 'about:blank', title: err.message, status: err.status, code: err.code },
        { status: err.status },
      );
    }
    if (typeof err === 'object' && err !== null && 'name' in err && (err as { name: string }).name === 'ZodError') {
      return NextResponse.json(
        { type: 'about:blank', title: 'Validation failed', status: 400, errors: (err as unknown as { errors: unknown }).errors },
        { status: 400 },
      );
    }
    return NextResponse.json({ type: 'about:blank', title: 'Internal Server Error', status: 500 }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const gate = await requireRoles(_req, ['SUPER_ADMIN', 'CLINIC_ADMIN']);
  if ('response' in gate) return gate.response;

  try {
    await service.deleteField(params.id);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    if (err instanceof CustomFieldError) {
      return NextResponse.json(
        { type: 'about:blank', title: err.message, status: err.status, code: err.code },
        { status: err.status },
      );
    }
    return NextResponse.json({ type: 'about:blank', title: 'Internal Server Error', status: 500 }, { status: 500 });
  }
}