/**
 * GET    /api/v1/email-templates/:id   — read one
 * PATCH  /api/v1/email-templates/:id   — partial update
 * DELETE /api/v1/email-templates/:id   — remove
 *
 * Source: specs/018-email-templates/plan.md
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  deleteTemplate,
  EmailTemplateNotFoundError,
  getTemplateById,
  updateTemplate,
} from '@/services/email-templates/templates.service';
import { updateEmailTemplateSchema } from '@/types/email-template';

export const dynamic = 'force-dynamic';

function adminOnly(req: NextRequest): NextResponse | null {
  const role = req.headers.get('x-user-role');
  if (role && role !== 'CLINIC_ADMIN' && role !== 'SUPER_ADMIN') {
    return NextResponse.json(
      { error: 'forbidden', message: 'admin role required' },
      { status: 403 },
    );
  }
  return null;
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const denied = adminOnly(req);
  if (denied) return denied;
  try {
    const dto = await getTemplateById(params.id);
    return NextResponse.json(dto);
  } catch (err) {
    if (err instanceof EmailTemplateNotFoundError) {
      return NextResponse.json(
        { error: 'not_found', message: err.message },
        { status: 404 },
      );
    }
    console.error('[email-templates][GET id] unexpected error', err);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const denied = adminOnly(req);
  if (denied) return denied;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: 'invalid_json' },
      { status: 400 },
    );
  }

  const parsed = updateEmailTemplateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'validation_error', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    const updated = await updateTemplate(params.id, parsed.data);
    return NextResponse.json(updated);
  } catch (err) {
    if (err instanceof EmailTemplateNotFoundError) {
      return NextResponse.json(
        { error: 'not_found', message: err.message },
        { status: 404 },
      );
    }
    console.error('[email-templates][PATCH id] unexpected error', err);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const denied = adminOnly(req);
  if (denied) return denied;
  try {
    await deleteTemplate(params.id);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    if (err instanceof EmailTemplateNotFoundError) {
      return NextResponse.json(
        { error: 'not_found', message: err.message },
        { status: 404 },
      );
    }
    console.error('[email-templates][DELETE id] unexpected error', err);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}
