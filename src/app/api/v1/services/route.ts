/**
 * GET  /api/v1/services — list the services offered at a clinic
 * POST /api/v1/services — create one, with a mapping per psychologist. A psychologist may
 *                         create for themselves only (see own-create.ts).
 *
 * A "service" here is a `wp_kc_service_doctor_mapping` row. See
 * docs/superpowers/specs/2026-08-30-services-crud-design.md.
 */
import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import type { Actor } from '@/lib/auth';
import { badRequest, conflict, forbidden, validationError } from '@/lib/problem-details';
import { scopeForRequest, canCreate } from '@/services/service-catalog/scope';
import { resolveOwnCreateTarget, type OwnCreateRefusal } from '@/services/service-catalog/own-create';
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

/** A psychologist's refused create, as the response to send. */
function ownCreateRefusal(refusal: OwnCreateRefusal): NextResponse {
  if (refusal === 'clinic_required') {
    return NextResponse.json(
      validationError('clinic_required', 'clinicId is required', undefined, {
        clinicId: ['Pick one of the clinics you practise at'],
      }),
      { status: 422 },
    );
  }
  const message = {
    not_self: 'Psychologists can only add services for themselves',
    no_clinic: 'Professional is not assigned to an active clinic',
    clinic_not_yours: 'Not a clinic this professional practises at',
  }[refusal];
  return NextResponse.json(forbidden(message), { status: 403 });
}

export const POST = withAuth(async (req: NextRequest, ctx) => {
  const { actor } = ctx as { actor: Actor };

  if (!canCreate(actor.role)) {
    return NextResponse.json(
      forbidden('Only Super Admin, Clinic Admin and psychologists for themselves can create services'),
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

  const scoped = await scopeForRequest(actor);
  if ('response' in scoped) return scoped.response;

  // An empty scope (e.g. a CLINIC_ADMIN with no clinic mapping) cannot write anywhere.
  // Left unchecked, `scope.clinicId` is `null` here too, and the `??` below would fall
  // through to whatever `clinicId` the request body names — letting the actor create a
  // service in a clinic they have no relationship with at all.
  if (scoped.scope.empty) {
    return NextResponse.json(
      forbidden('Actor is not assigned to a clinic'),
      { status: 403 },
    );
  }

  let input = parsed.data;
  let clinicId: number | null;
  if (actor.role === 'PROFESSIONAL') {
    // readScopeFor pins a PROFESSIONAL to doctorId = their wp user, taken from the token.
    // Without it there is no "themselves" to create for, so refuse rather than guess.
    const self = scoped.scope.doctorId;
    if (self === null) {
      return NextResponse.json(forbidden('Professional is not linked to a WordPress account'), {
        status: 403,
      });
    }
    const target = await resolveOwnCreateTarget({ self, doctorIds: input.doctorIds, clinicId: input.clinicId });
    if ('refusal' in target) return ownCreateRefusal(target.refusal);
    clinicId = target.clinicId;
    // De-duplicated to exactly themselves: `[34, 34]` passed the check above.
    input = { ...input, doctorIds: [Number(self)] };
  } else {
    // A clinic admin is pinned to their own clinic whatever the body says. A super admin has
    // no clinic of their own, so they must name one.
    const scopedClinic = scoped.scope.clinicId;
    clinicId = scopedClinic !== null ? Number(scopedClinic) : (input.clinicId ?? null);
  }
  if (clinicId === null) {
    return NextResponse.json(
      validationError('clinic_required', 'clinicId is required', undefined, {
        clinicId: ['clinicId is required for this role'],
      }),
      { status: 422 },
    );
  }

  try {
    const created = await createService(input, clinicId, actor.id);
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
