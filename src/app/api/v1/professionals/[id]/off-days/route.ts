/**
 * GET    /api/v1/professionals/[id]/off-days — list off days
 * POST   /api/v1/professionals/[id]/off-days — add an off day
 * DELETE /api/v1/professionals/[id]/off-days — remove one
 *
 * Off days live in `wp_kc_clinic_schedule` with `module_type = 'doctor'`, so `id` is a
 * numeric `wp_users.ID`. Dates stay as `YYYY-MM-DD` strings end to end — KiviCare stores
 * them that way, and round-tripping through Date only risks a timezone shift.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth, type Actor } from '@/lib/auth';
import { forbidden, notFound, validationError } from '@/lib/problem-details';
import {
  listOffDays,
  addOffDay,
  removeOffDay,
  isAvailabilityError,
} from '@/services/professional/availability.service';
import { createOffDayInputSchema } from '@/services/professional/validation';
import {
  canEdit,
  canView,
  invalidIdResponse,
  parseProfessionalId,
  scopeFor,
} from '@/services/professional/route-scope';

type RouteParams = { params: { id: string } };

export const GET = withAuth(async (_req: NextRequest, ctx: RouteParams) => {
  const { actor } = ctx as { actor: Actor; params: RouteParams['params'] };
  const id = parseProfessionalId(ctx.params.id);
  if (id === null) return invalidIdResponse();

  const scope = await scopeFor(actor, id);
  if (!scope) {
    return NextResponse.json(notFound('professional_not_found', 'Professional not found'), { status: 404 });
  }
  if (!canView(scope, actor.role)) {
    return NextResponse.json(forbidden('Cannot view these off days'), { status: 403 });
  }

  return NextResponse.json({ offDays: await listOffDays(id) });
});

export const POST = withAuth(async (req: NextRequest, ctx: RouteParams) => {
  const { actor } = ctx as { actor: Actor; params: RouteParams['params'] };
  const id = parseProfessionalId(ctx.params.id);
  if (id === null) return invalidIdResponse();

  const scope = await scopeFor(actor, id);
  if (!scope) {
    return NextResponse.json(notFound('professional_not_found', 'Professional not found'), { status: 404 });
  }
  if (!canEdit(scope, actor.role)) {
    return NextResponse.json(forbidden('Cannot add off days for this professional'), { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(validationError('invalid_json', 'Request body must be valid JSON'), { status: 400 });
  }

  const parsed = createOffDayInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      validationError('validation_failed', parsed.error.issues[0]?.message ?? 'Invalid off day'),
      { status: 422 },
    );
  }

  try {
    const offDayId = await addOffDay(id, {
      startDate: parsed.data.startDate,
      endDate: parsed.data.endDate,
      description: parsed.data.reason ?? undefined,
    });
    const created = (await listOffDays(id)).find((o) => o.id === offDayId);
    return NextResponse.json(created ?? { id: offDayId }, { status: 201 });
  } catch (err) {
    if (isAvailabilityError(err) && err._tag === 'validation') {
      return NextResponse.json(validationError('validation_failed', err.message), { status: 422 });
    }
    throw err;
  }
});

export const DELETE = withAuth(async (req: NextRequest, ctx: RouteParams) => {
  const { actor } = ctx as { actor: Actor; params: RouteParams['params'] };
  const id = parseProfessionalId(ctx.params.id);
  if (id === null) return invalidIdResponse();

  const scope = await scopeFor(actor, id);
  if (!scope) {
    return NextResponse.json(notFound('professional_not_found', 'Professional not found'), { status: 404 });
  }
  if (!canEdit(scope, actor.role)) {
    return NextResponse.json(forbidden('Cannot remove off days for this professional'), { status: 403 });
  }

  const raw = req.nextUrl.searchParams.get('offDayId');
  const offDayId = Number(raw);
  if (!raw || !Number.isInteger(offDayId) || offDayId <= 0) {
    return NextResponse.json(
      validationError('invalid_off_day_id', 'offDayId must be a positive integer'),
      { status: 400 },
    );
  }

  try {
    // The service scopes the delete by professional too, so one doctor cannot remove
    // another's closure by guessing an id.
    await removeOffDay(id, offDayId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (isAvailabilityError(err) && err._tag === 'not_found') {
      return NextResponse.json(notFound('off_day_not_found', 'Off day not found'), { status: 404 });
    }
    throw err;
  }
});
