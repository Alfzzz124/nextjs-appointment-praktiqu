/**
 * GET  /api/v1/services — list the services offered at a clinic
 * POST /api/v1/services — create one, with a mapping per psychologist
 *
 * A "service" here is a `wp_kc_service_doctor_mapping` row. See
 * docs/superpowers/specs/2026-08-30-services-crud-design.md.
 */
import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import type { Actor } from '@/lib/auth';
import { badRequest, conflict, forbidden, validationError } from '@/lib/problem-details';
import { scopeForRequest, canWrite } from '@/services/service-catalog/scope';
import {
  listServices,
  createService,
  isServiceCatalogError,
} from '@/services/service-catalog/service';
import {
  listServicesQuerySchema,
  createServiceSchema,
  toFieldErrors,
} from '@/services/service-catalog/validation';

export const GET = withAuth(async (req: NextRequest, ctx) => {
  const { actor } = ctx as { actor: Actor };

  const parsed = listServicesQuerySchema.safeParse(
    Object.fromEntries(req.nextUrl.searchParams),
  );
  if (!parsed.success) {
    return NextResponse.json(
      validationError('invalid_query', 'Invalid query parameters', undefined, toFieldErrors(parsed.error)),
      { status: 422 },
    );
  }

  const scoped = await scopeForRequest(actor);
  if ('response' in scoped) return scoped.response;

  return NextResponse.json(await listServices(parsed.data, scoped.scope));
});

export const POST = withAuth(async (req: NextRequest, ctx) => {
  const { actor } = ctx as { actor: Actor };

  if (!canWrite(actor.role)) {
    return NextResponse.json(
      forbidden('Only Super Admin and Clinic Admin can create services'),
      { status: 403 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      validationError('invalid_json', 'Request body must be valid JSON'),
      { status: 400 },
    );
  }

  const parsed = createServiceSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      validationError('validation_failed', 'Invalid service data', undefined, toFieldErrors(parsed.error)),
      { status: 422 },
    );
  }

  // A clinic admin is pinned to their own clinic whatever the body says. A super admin
  // has no clinic of their own, so they must name one.
  const scoped = await scopeForRequest(actor);
  if ('response' in scoped) return scoped.response;

  const clinicId = scoped.scope.clinicId ?? (parsed.data.clinicId ?? null);
  if (clinicId === null) {
    return NextResponse.json(
      validationError('clinic_required', 'clinicId is required', undefined, {
        clinicId: ['clinicId is required for this role'],
      }),
      { status: 422 },
    );
  }

  try {
    const created = await createService(parsed.data, Number(clinicId), actor.id);
    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    if (isServiceCatalogError(err)) {
      if (err._tag === 'validation') {
        return NextResponse.json(
          validationError('validation_failed', 'Invalid service data', undefined, err.errors),
          { status: 422 },
        );
      }
      if (err._tag === 'bad_request') {
        return NextResponse.json(badRequest(err.code, err.message), { status: 400 });
      }
      if (err._tag === 'conflict') {
        return NextResponse.json(conflict(err.code, err.message), { status: 409 });
      }
    }
    throw err;
  }
});
