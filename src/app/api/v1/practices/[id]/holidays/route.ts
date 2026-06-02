/**
 * GET    /api/v1/practices/:id/holidays  — list holidays
 * POST   /api/v1/practices/:id/holidays  — add a holiday
 * DELETE /api/v1/practices/:id/holidays  — remove all holidays for a practice (bulk)
 * DELETE /api/v1/practices/:id/holidays/:holidayId — remove a specific holiday
 */
import { NextRequest, NextResponse } from 'next/server';
import {
  HolidayNotFoundError,
  PracticeNotFoundError,
  PracticeValidationError,
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
  const holidays = await listHolidays(params.id).catch((e) => e);
  const handled = handleError(holidays instanceof Error ? holidays : null, `/api/v1/practices/${params.id}/holidays`, 'GET');
  if (handled) return handled;
  return NextResponse.json({ data: holidays }, { status: 200 });
}

// ============================================================
// POST /api/v1/practices/:id/holidays
// ============================================================

export async function POST(req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { type: '/errors/bad-request', title: 'Invalid JSON', status: 400 },
      { status: 400 },
    );
  }

  const dto = await addHoliday(params.id, body, { actorId: null }).catch((e) => e);
  const handled = handleError(dto, `/api/v1/practices/${params.id}/holidays`, 'POST');
  if (handled) return handled;
  return NextResponse.json({ data: dto }, { status: 201 });
}

// ============================================================
// DELETE /api/v1/practices/:id/holidays/:holidayId
// ============================================================

export async function DELETE(_req: NextRequest, { params }: HolidayParams): Promise<NextResponse> {
  const ok = await removeHoliday(params.id, params.holidayId, { actorId: null }).catch((e) => e);
  const handled = handleError(
    ok instanceof Error ? ok : null,
    `/api/v1/practices/${params.id}/holidays/${params.holidayId}`,
    'DELETE',
  );
  if (handled) return handled;
  return new NextResponse(null, { status: 204 });
}