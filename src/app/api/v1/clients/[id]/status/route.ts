/**
 * PATCH /api/v1/clients/:id/status — update client status
 *
 * Authorization: SUPER_ADMIN, CLINIC_ADMIN
 */

import { NextRequest, NextResponse } from 'next/server';
import { getActor, AuthError } from '@/lib/auth';
import { unauthorized } from '@/lib/problem-details';
import { setStatus, ClientServiceError } from '@/services/client/client.service';
import { updateStatusSchema, formatFieldErrors } from '@/services/client/validation';

/** Client ids are numeric now (D2); reject anything else before it becomes NaN. */
function parseClientId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}


export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  try {
    const actor = await getActor(req);
    const { id } = await params;
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ type: '/errors/parse-error', title: 'Invalid JSON', status: 400 }, { status: 400 });
    }
    const parsed = updateStatusSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          type: '/errors/field-validation',
          title: 'Field Validation Error',
          status: 422,
          detail: 'Validation failed',
          errors: formatFieldErrors(parsed.error),
        },
        { status: 422 },
      );
    }
    const clientId = parseClientId(id);
    if (clientId === null) {
      return NextResponse.json(
        { type: '/errors/validation-error', title: 'Invalid client id', status: 400 },
        { status: 400 },
      );
    }
    const result = await setStatus({ actor, id: clientId, to: parsed.data.status });
    return NextResponse.json({ data: result }, { status: 200 });
  } catch (err) {
    return handleServiceError(err);
  }
}

function handleServiceError(err: unknown): NextResponse {
  if (err instanceof AuthError) {
    return NextResponse.json(unauthorized('unauthorized', err.message), {
      status: err.status,
      headers: { 'Content-Type': 'application/problem+json' },
    });
  }
  if (err instanceof ClientServiceError) {
    return NextResponse.json(
      {
        type: '/errors/client-error',
        title: err.message,
        status: err.status,
        detail: err.message,
        ...(err.fields ? { errors: err.fields } : {}),
      },
      { status: err.status },
    );
  }
  console.error('[clients/[id]/status/route] unhandled error', err);
  return NextResponse.json({ type: '/errors/internal', title: 'Internal server error', status: 500 }, { status: 500 });
}