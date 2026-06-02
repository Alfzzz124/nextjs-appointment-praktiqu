/**
 * GET /api/v1/clients      — list clients
 * POST /api/v1/clients      — register a new client
 *
 * RBAC:
 *   GET: SUPER_ADMIN (all), CLINIC_ADMIN (practice), RECEPTIONIST (practice)
 *   POST: SUPER_ADMIN, CLINIC_ADMIN, RECEPTIONIST
 */

import { NextRequest, NextResponse } from 'next/server';
import { getActor } from '@/lib/auth';
import { listClients, createClient } from '@/services/client/client.service';
import { listClientsQuerySchema, createClientSchema, formatFieldErrors } from '@/services/client/validation';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const actor = await getActor(req);
    const rawParams = Object.fromEntries(req.nextUrl.searchParams);
    const parsed = listClientsQuerySchema.safeParse(rawParams);
    if (!parsed.success) {
      return fieldErrorResponse(listClientsQuerySchema, parsed.error);
    }
    const result = await listClients({ actor, query: parsed.data });
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    return handleServiceError(err);
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const actor = await getActor(req);
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { type: '/errors/parse-error', title: 'Invalid JSON', status: 400 },
        { status: 400 },
      );
    }
    const parsed = createClientSchema.safeParse(body);
    if (!parsed.success) {
      return fieldErrorResponse(createClientSchema, parsed.error);
    }

    // SUPER_ADMIN must pass practiceId in body.
    const practiceId = actor.role === 'SUPER_ADMIN'
      ? (typeof body === 'object' && body !== null ? (body as Record<string, unknown>).practiceId as string | undefined : undefined)
      : undefined;

    const result = await createClient({ actor, input: parsed.data, practiceId });
    return NextResponse.json({ data: result }, { status: 201 });
  } catch (err) {
    return handleServiceError(err);
  }
}

function fieldErrorResponse(schema: z.ZodType, err: z.ZodError): NextResponse {
  return NextResponse.json(
    {
      type: '/errors/field-validation',
      title: 'Field Validation Error',
      status: 422,
      detail: 'Validation failed',
      errors: formatFieldErrors(err),
    },
    { status: 422 },
  );
}

import { z } from 'zod';
import { ClientServiceError } from '@/services/client/client.service';

function handleServiceError(err: unknown): NextResponse {
  if (err instanceof ClientServiceError) {
    return NextResponse.json(
      {
        type: err.status === 409 ? '/errors/conflict' : '/errors/validation-error',
        title: err.message,
        status: err.status,
        detail: err.message,
        ...(err.fields ? { errors: err.fields } : {}),
      },
      { status: err.status },
    );
  }
  console.error('[clients/route] unhandled error', err);
  return NextResponse.json(
    { type: '/errors/internal', title: 'Internal server error', status: 500 },
    { status: 500 },
  );
}