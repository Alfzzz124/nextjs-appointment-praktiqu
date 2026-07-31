/**
 * /api/v1/custom-fields
 *
 * GET  — list field definitions (filter by entityType, doctorId, status)
 * POST — create a new field definition
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireRoles, requireAuth } from '@/lib/auth/route-guards';
import {
  CustomFieldService,
  CustomFieldError,
  customFieldCreateSchema,
  MODULE_TYPES,
  type ModuleType,
} from '@/services/custom-fields/service';

const service = new CustomFieldService();

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const gate = await requireAuth(req);
  if ('response' in gate) return gate.response;

  const { searchParams } = new URL(req.url);
  const moduleTypeRaw = searchParams.get('entityType') ?? searchParams.get('moduleType');
  // KiviCare scopes custom fields by doctor, not by clinic — `wp_kc_custom_fields`
  // has no clinic column, so the old `clinicId` filter could never have applied.
  const doctorRaw = searchParams.get('doctorId');
  const doctorId = doctorRaw === null ? undefined : Number(doctorRaw);
  if (doctorId !== undefined && (!Number.isSafeInteger(doctorId) || doctorId < 0)) {
    return NextResponse.json(
      { type: 'about:blank', title: 'doctorId must be a non-negative integer', status: 400 },
      { status: 400 },
    );
  }
  const statusRaw = searchParams.get('status');
  const status = statusRaw !== null ? Number(statusRaw) : undefined;

  if (moduleTypeRaw && !MODULE_TYPES.includes(moduleTypeRaw as ModuleType)) {
    return NextResponse.json(
      {
        type: 'about:blank',
        title: 'Validation failed',
        status: 400,
        errors: [{ path: 'entityType', message: `must be one of: ${MODULE_TYPES.join(', ')}` }],
      },
      { status: 400 },
    );
  }

  try {
    const items = await service.listFields({ moduleType: moduleTypeRaw as ModuleType | undefined, doctorId, status });
    return NextResponse.json({ items });
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

export async function POST(req: NextRequest) {
  const gate = await requireRoles(req, ['SUPER_ADMIN', 'CLINIC_ADMIN']);
  if ('response' in gate) return gate.response;

  try {
    const body = await req.json();
    const parsed = customFieldCreateSchema.parse(body);
    const created = await service.createField(parsed);
    return NextResponse.json(created, { status: 201 });
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