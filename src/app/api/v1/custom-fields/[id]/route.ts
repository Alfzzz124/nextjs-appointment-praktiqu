/**
 * /api/v1/custom-fields/[id]
 *
 * GET    — get a field definition by id
 * PATCH  — update a field definition
 * DELETE — soft-delete a field definition (sets status = 0)
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireRoles, requireAuth } from '@/lib/auth/route-guards';
import {
  CustomFieldService,
  CustomFieldError,
  customFieldUpdateSchema,
} from '@/services/custom-fields/service';

const service = new CustomFieldService();

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const gate = await requireAuth(_req);
  if ('response' in gate) return gate.response;

  // Field ids are wp_kc_custom_fields.id integers; a non-numeric segment is a 404
  // rather than a NaN query.
  const id = Number(params.id);
  if (!Number.isSafeInteger(id) || id <= 0) {
    return NextResponse.json(
      { type: 'about:blank', title: 'Not Found', status: 404 },
      { status: 404 },
    );
  }

  try {
    const item = await service.getField(id);
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

  // Field ids are wp_kc_custom_fields.id integers; a non-numeric segment is a 404
  // rather than a NaN query.
  const id = Number(params.id);
  if (!Number.isSafeInteger(id) || id <= 0) {
    return NextResponse.json(
      { type: 'about:blank', title: 'Not Found', status: 404 },
      { status: 404 },
    );
  }

  try {
    const body = await req.json();
    const parsed = customFieldUpdateSchema.parse(body);
    const updated = await service.updateField(id, parsed);
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

  // Field ids are wp_kc_custom_fields.id integers; a non-numeric segment is a 404
  // rather than a NaN query.
  const id = Number(params.id);
  if (!Number.isSafeInteger(id) || id <= 0) {
    return NextResponse.json(
      { type: 'about:blank', title: 'Not Found', status: 404 },
      { status: 404 },
    );
  }

  try {
    await service.deleteField(id);
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