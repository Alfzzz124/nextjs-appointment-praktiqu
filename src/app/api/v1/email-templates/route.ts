/**
 * GET  /api/v1/email-templates   — list all templates
 * POST /api/v1/email-templates   — create a new template
 *
 * Source: specs/018-email-templates/plan.md
 *
 * Auth: CLINIC_ADMIN / SUPER_ADMIN (matches spec 012 admin-only model).
 * The auth helper isn't wired up here yet because feature 001 doesn't
 * expose a stable session shape; downstream callers should pass
 * `x-user-role` for tests and the eventual middleware will replace that.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  createTemplate,
  listTemplates,
  EmailTemplateConflictError,
} from '@/services/email-templates/templates.service';
import { createEmailTemplateSchema } from '@/types/email-template';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

function unauthorizedIfNotAdmin(req: NextRequest): NextResponse | null {
  const role = req.headers.get('x-user-role');
  if (role && role !== 'CLINIC_ADMIN' && role !== 'SUPER_ADMIN') {
    return NextResponse.json(
      { error: 'forbidden', message: 'admin role required' },
      { status: 403 },
    );
  }
  return null;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const denied = unauthorizedIfNotAdmin(req);
  if (denied) return denied;

  const includeInactive =
    new URL(req.url).searchParams.get('includeInactive') === 'true';
  const items = await listTemplates({ includeInactive });
  return NextResponse.json({ items });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const denied = unauthorizedIfNotAdmin(req);
  if (denied) return denied;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: 'invalid_json', message: 'body must be valid JSON' },
      { status: 400 },
    );
  }

  const parsed = createEmailTemplateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'validation_error',
        message: 'Invalid template payload',
        issues: parsed.error.issues,
      },
      { status: 400 },
    );
  }

  try {
    const created = await createTemplate(parsed.data);
    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    if (err instanceof EmailTemplateConflictError) {
      return NextResponse.json(
        { error: 'conflict', message: err.message },
        { status: 409 },
      );
    }
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'validation_error', issues: err.issues },
        { status: 400 },
      );
    }
    console.error('[email-templates][POST] unexpected error', err);
    return NextResponse.json(
      { error: 'internal_error' },
      { status: 500 },
    );
  }
}
