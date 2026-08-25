/**
 * GET    /api/v1/practices/:id/holidays  — list holidays
 * POST   /api/v1/practices/:id/holidays  — add a holiday
 * DELETE /api/v1/practices/:id/holidays  — remove all holidays for a practice (bulk)
 * DELETE /api/v1/practices/:id/holidays/:holidayId — remove a specific holiday
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireRoles } from '@/lib/auth/route-guards';
import { KcError } from '@/lib/kc-response';
import {
  HolidayNotFoundError,
  PracticeNotFoundError,
  PracticeValidationError,
  assertPracticeInScope,
  addHoliday,
  listHolidays,
  removeHoliday,
} from '@/services/practice/service';
import { logging } from '@/lib/logging';

// ============================================================
// Helpers
// ============================================================

type RouteParams = { params: { id: string } };
type HolidayParams = { params: { id: string; holidayId: string } };

/**
 * Distinguishes "the promise rejected" from "the promise resolved with a value that
 * happens not to be an `Error`" — something `.catch((e) => e)` cannot do, since a
 * thrown string and a returned string are indistinguishable once collapsed into one
 * variable. `handleError` below is only ever invoked on the `ok: false` branch, so it
 * can treat every argument it receives as a genuine failure, fail-closed, with no
 * "is this actually an error?" guard of its own.
 */
async function settle<T>(p: Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
  try {
    return { ok: true, value: await p };
  } catch (error) {
    return { ok: false, error };
  }
}

function handleError(
  err: unknown,
  path: string,
  method: string,
  detail?: string,
): NextResponse {
  if (err instanceof PracticeNotFoundError) {
    return NextResponse.json(
      {
        type: '/errors/resource-not-found',
        title: 'Practice not found',
        status: 404,
        detail: detail ?? `Practice ${err.id} not found.`,
      },
      { status: 404 },
    );
  }
  if (err instanceof HolidayNotFoundError) {
    return NextResponse.json(
      {
        type: '/errors/resource-not-found',
        title: 'Holiday not found',
        status: 404,
        detail: `Holiday ${err.id} not found.`,
      },
      { status: 404 },
    );
  }
  if (err instanceof PracticeValidationError) {
    return NextResponse.json(
      {
        type: '/errors/validation-error',
        title: 'Validation Error',
        status: 422,
        detail: err.message,
        issues: err.issues,
      },
      { status: 422 },
    );
  }
  if (err instanceof KcError) {
    return NextResponse.json(
      { type: '/errors/forbidden', title: 'Forbidden', status: err.httpStatus, detail: err.message },
      { status: err.httpStatus },
    );
  }
  logging.error(`${method} ${path} failed`, err, { path, method }).catch(() => {});
  return NextResponse.json(
    { type: '/errors/internal', title: 'Internal Server Error', status: 500 },
    { status: 500 },
  );
}

// ============================================================
// GET /api/v1/practices/:id/holidays
// ============================================================

export async function GET(_req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const gate = await requireRoles(_req, ['SUPER_ADMIN', 'CLINIC_ADMIN']);
  if ('response' in gate) return gate.response;

  const scope = await settle(assertPracticeInScope(gate.actor, Number(params.id)));
  if (scope.ok === false) return handleError(scope.error, `/api/v1/practices/${params.id}/holidays`, 'GET');

  const holidays = await settle(listHolidays(Number(params.id)));
  if (holidays.ok === false) return handleError(holidays.error, `/api/v1/practices/${params.id}/holidays`, 'GET');
  return NextResponse.json({ data: holidays.value }, { status: 200 });
}

// ============================================================
// POST /api/v1/practices/:id/holidays
// ============================================================

export async function POST(req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const gate = await requireRoles(req, ['SUPER_ADMIN', 'CLINIC_ADMIN']);
  if ('response' in gate) return gate.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { type: '/errors/bad-request', title: 'Invalid JSON', status: 400 },
      { status: 400 },
    );
  }

  const scope = await settle(assertPracticeInScope(gate.actor, Number(params.id)));
  if (scope.ok === false) return handleError(scope.error, `/api/v1/practices/${params.id}/holidays`, 'POST');

  const dto = await settle(addHoliday(Number(params.id), body, { actorId: null }));
  if (dto.ok === false) return handleError(dto.error, `/api/v1/practices/${params.id}/holidays`, 'POST');
  return NextResponse.json({ data: dto.value }, { status: 201 });
}

// ============================================================
// DELETE /api/v1/practices/:id/holidays/:holidayId
// ============================================================

export async function DELETE(_req: NextRequest, { params }: HolidayParams): Promise<NextResponse> {
  const gate = await requireRoles(_req, ['SUPER_ADMIN', 'CLINIC_ADMIN']);
  if ('response' in gate) return gate.response;

  const scope = await settle(assertPracticeInScope(gate.actor, Number(params.id)));
  if (scope.ok === false) return handleError(scope.error, `/api/v1/practices/${params.id}/holidays/${params.holidayId}`, 'DELETE');

  const removed = await settle(removeHoliday(Number(params.id), Number(params.holidayId), { actorId: null }));
  if (removed.ok === false) {
    return handleError(removed.error, `/api/v1/practices/${params.id}/holidays/${params.holidayId}`, 'DELETE');
  }
  return new NextResponse(null, { status: 204 });
}