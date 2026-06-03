/**
 * GET    /api/v1/clients/:id — read client detail
 * PATCH  /api/v1/clients/:id — update client profile
 * DELETE /api/v1/clients/:id — archive client
 */

import { NextRequest, NextResponse } from 'next/server';
import { getActor } from '@/lib/auth';
import { getClient, updateClient, archiveClient, ClientServiceError } from '@/services/client/client.service';
import { updateClientSchema, formatFieldErrors } from '@/services/client/validation';

export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  try {
    const actor = await getActor(req);
    const { id } = await params;
    const result = await getClient({ actor, id });
    return NextResponse.json({ data: result }, { status: 200 });
  } catch (err) {
    return handleServiceError(err);
  }
}

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
    const parsed = updateClientSchema.safeParse(body);
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
    const result = await updateClient({ actor, id, input: parsed.data });
    return NextResponse.json({ data: result }, { status: 200 });
  } catch (err) {
    return handleServiceError(err);
  }
}

export async function DELETE(req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  try {
    const actor = await getActor(req);
    const { id } = await params;
    const result = await archiveClient({ actor, id });
    return NextResponse.json({ data: result }, { status: 200 });
  } catch (err) {
    return handleServiceError(err);
  }
}

function handleServiceError(err: unknown): NextResponse {
  if (err instanceof ClientServiceError) {
    return NextResponse.json(
      {
        type: err.status === 409 ? '/errors/conflict' : err.status === 422 ? '/errors/precondition' : '/errors/client-error',
        title: err.message,
        status: err.status,
        detail: err.message,
        ...(err.fields ? { errors: err.fields } : {}),
      },
      { status: err.status },
    );
  }
  console.error('[clients/[id]/route] unhandled error', err);
  return NextResponse.json({ type: '/errors/internal', title: 'Internal server error', status: 500 }, { status: 500 });
}