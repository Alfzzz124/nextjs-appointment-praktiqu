/**
 * POST /api/v1/email-templates/:id/preview
 *
 * Render the template (with optional content overrides) and return the
 * rendered subject, html, text, plus a list of variables that were
 * referenced but not supplied.
 *
 * Source: specs/018-email-templates/plan.md
 *
 * Auth: CLINIC_ADMIN / SUPER_ADMIN
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  EmailTemplateNotFoundError,
  getTemplateById,
  preview,
} from '@/services/email-templates/templates.service';
import { previewEmailTemplateSchema } from '@/types/email-template';

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

export async function POST(
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

  const parsed = previewEmailTemplateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'validation_error', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    const dto = await getTemplateById(params.id);
    const rendered = preview(dto, parsed.data);
    return NextResponse.json(rendered);
  } catch (err) {
    if (err instanceof EmailTemplateNotFoundError) {
      return NextResponse.json(
        { error: 'not_found', message: err.message },
        { status: 404 },
      );
    }
    console.error('[email-templates][POST preview] unexpected error', err);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}
