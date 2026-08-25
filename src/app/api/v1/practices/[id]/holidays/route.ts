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

function handleError(
  err: unknown,
  path: string,
  method: string,
  detail?: string,
): NextResponse | null {
  // GET/DELETE pass `null` on success (e.g. `holidays instanceof Error ? holidays :
  // null`); POST passes the raw success DTO itself, unconverted. Neither is an `Error`,
  // so without this guard every 200/201/204 response fell through to the generic
  // branch below and came back as a 500. Pre-existing bug, unrelated to row-scoping —
  // found while adding the practice ownership check below, which needed a working
  // success path to verify against.
  if (!(err instanceof Error)) return null;
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

  const scopeErr = await assertPracticeInScope(gate.actor, Number(params.id)).catch((e) => e);
  const scopeHandled = handleError(scopeErr, `/api/v1/practices/${params.id}/holidays`, 'GET');
  if (scopeHandled) return scopeHandled;

  const holidays = await listHolidays(Number(params.id)).catch((e) => e);
  const handled = handleError(holidays instanceof Error ? holidays : null, `/api/v1/practices/${params.id}/holidays`, 'GET');
  if (handled) return handled;
  return NextResponse.json({ data: holidays }, { status: 200 });
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

  const scopeErr = await assertPracticeInScope(gate.actor, Number(params.id)).catch((e) => e);
  const scopeHandled = handleError(scopeErr, `/api/v1/practices/${params.id}/holidays`, 'POST');
  if (scopeHandled) return scopeHandled;

  const dto = await addHoliday(Number(params.id), body, { actorId: null }).catch((e) => e);
  const handled = handleError(dto, `/api/v1/practices/${params.id}/holidays`, 'POST');
  if (handled) return handled;
  return NextResponse.json({ data: dto }, { status: 201 });
}

// ============================================================
// DELETE /api/v1/practices/:id/holidays/:holidayId
// ============================================================

export async function DELETE(_req: NextRequest, { params }: HolidayParams): Promise<NextResponse> {
  const gate = await requireRoles(_req, ['SUPER_ADMIN', 'CLINIC_ADMIN']);
  if ('response' in gate) return gate.response;

  const scopeErr = await assertPracticeInScope(gate.actor, Number(params.id)).catch((e) => e);
  const scopeHandled = handleError(scopeErr, `/api/v1/practices/${params.id}/holidays/${params.holidayId}`, 'DELETE');
  if (scopeHandled) return scopeHandled;

  const ok = await removeHoliday(Number(params.id), Number(params.holidayId), { actorId: null }).catch((e) => e);
  const handled = handleError(
    ok instanceof Error ? ok : null,
    `/api/v1/practices/${params.id}/holidays/${params.holidayId}`,
    'DELETE',
  );
  if (handled) return handled;
  return new NextResponse(null, { status: 204 });
}