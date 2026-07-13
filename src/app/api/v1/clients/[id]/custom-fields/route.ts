/**
 * /api/v1/clients/[id]/custom-fields
 *
 * GET    — get all custom field values for a client
 * PUT    — bulk-set custom field values for a client
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/route-guards';
import { PrismaClient } from '@prisma/client';
import {
  CustomFieldService,
  CustomFieldError,
  customFieldBulkValuesSchema,
} from '@/services/custom-fields/service';

const prisma = new PrismaClient();
const service = new CustomFieldService(prisma);

export const dynamic = 'force-dynamic';

/** GET /api/v1/clients/:id/custom-fields */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const gate = await requireAuth(_req);
  if ('response' in gate) return gate.response;

  try {
    const result = await service.getValuesWithFields('client', params.id);
    return NextResponse.json({ items: result });
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

/** PUT /api/v1/clients/:id/custom-fields */
export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const gate = await requireAuth(req);
  if ('response' in gate) return gate.response;

  try {
    const body = await req.json();
    const parsed = customFieldBulkValuesSchema.parse(body);
    const result = await service.setBulkValues('client', params.id, parsed);
    return NextResponse.json(result);
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