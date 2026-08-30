/**
 * GET    /api/v1/services/{id}
 * PUT    /api/v1/services/{id}
 * DELETE /api/v1/services/{id}
 *
 * `{id}` is a `wp_kc_service_doctor_mapping` row, matching KiviCare's own
 * `/doctor-services/{id}`. A row outside the actor's clinic answers 404, never 403.
 */
import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import type { Actor } from '@/lib/auth';
import { conflict, forbidden, notFound, validationError } from '@/lib/problem-details';
import {
  scopeForRequest,
  canWrite,
  parseServiceId,
  invalidIdResponse,
} from '@/services/service-catalog/scope';
import {
  getService,
  updateService,
  deleteService,
  isServiceCatalogError,
} from '@/services/service-catalog/service';
import { updateServiceSchema, toFieldErrors } from '@/services/service-catalog/validation';

type RouteParams = { params: { id: string } };

/** One place for the shared tail of PUT and DELETE error handling. */
function toErrorResponse(err: unknown): NextResponse {
  if (isServiceCatalogError(err)) {
    if (err._tag === 'not_found') {
      return NextResponse.json(notFound('service_not_found', 'Service not found'), { status: 404 });
    }
    if (err._tag === 'validation') {
      return NextResponse.json(
        validationError('validation_failed', 'Invalid service data', undefined, err.errors),
        { status: 422 },
      );
    }
    if (err._tag === 'conflict') {
      const body = conflict(err.code, err.message);
      // The count is what lets the dashboard say "3 appointments" instead of "some".
      return NextResponse.json(
        err.count === undefined ? body : { ...body, count: err.count },
        { status: 409 },
      );
    }
  }
  throw err;
}

export const GET = withAuth(async (req: NextRequest, ctx: RouteParams) => {
  const { actor } = ctx as { actor: Actor; params: RouteParams['params'] };
  const id = parseServiceId(ctx.params.id);
  if (id === null) return invalidIdResponse();

  const scoped = await scopeForRequest(actor);
  if ('response' in scoped) return scoped.response;

  const service = await getService(id, scoped.scope);
  if (!service) {
    return NextResponse.json(notFound('service_not_found', 'Service not found'), { status: 404 });
  }

  return NextResponse.json(service);
});

export const PUT = withAuth(async (req: NextRequest, ctx: RouteParams) => {
  const { actor } = ctx as { actor: Actor; params: RouteParams['params'] };
  const id = parseServiceId(ctx.params.id);
  if (id === null) return invalidIdResponse();

  if (!canWrite(actor.role)) {
    return NextResponse.json(forbidden('Only Super Admin and Clinic Admin can edit services'), {
      status: 403,
    });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(validationError('invalid_json', 'Request body must be valid JSON'), {
      status: 400,
    });
  }

  const parsed = updateServiceSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      validationError('validation_failed', 'Invalid service data', undefined, toFieldErrors(parsed.error)),
      { status: 422 },
    );
  }

  const scoped = await scopeForRequest(actor);
  if ('response' in scoped) return scoped.response;

  try {
    return NextResponse.json(await updateService(id, parsed.data, scoped.scope, actor.id));
  } catch (err) {
    return toErrorResponse(err);
  }
});

export const DELETE = withAuth(async (req: NextRequest, ctx: RouteParams) => {
  const { actor } = ctx as { actor: Actor; params: RouteParams['params'] };
  const id = parseServiceId(ctx.params.id);
  if (id === null) return invalidIdResponse();

  if (!canWrite(actor.role)) {
    return NextResponse.json(forbidden('Only Super Admin and Clinic Admin can delete services'), {
      status: 403,
    });
  }

  const scoped = await scopeForRequest(actor);
  if ('response' in scoped) return scoped.response;

  try {
    return NextResponse.json(await deleteService(id, scoped.scope, actor.id));
  } catch (err) {
    return toErrorResponse(err);
  }
});
