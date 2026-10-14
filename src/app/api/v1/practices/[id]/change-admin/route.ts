/**
 * POST /api/v1/practices/:id/change-admin — make a clinic admin the admin of this clinic.
 *
 * SUPER_ADMIN only. Body: `{ "newAdminId": <wp_users.ID> }`, a number or a numeric string,
 * whose account holds the kiviCare_clinic_admin capability. A clinic has exactly one admin
 * (wp_kc_clinics.clinic_admin_id); one admin may hold several clinics.
 *
 * This used to look `newAdminId` up as an auth cuid and then write Number(cuid) — NaN — into
 * clinic_admin_id, so it could not succeed with any input.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withAuth } from '@/lib/auth';
import { forbidden } from '@/lib/problem-details';
import {
  changePracticeAdmin,
  NotAClinicAdminError,
  PracticeNotFoundError,
} from '@/services/practice/service';
import { logging } from '@/lib/logging';

/** A wp_users.ID / wp_kc_clinics.id small enough to survive Number(). */
const ID = /^[1-9][0-9]{0,14}$/;

const schema = z.object({
  newAdminId: z
    .union([z.number().int().positive().max(Number.MAX_SAFE_INTEGER), z.string().regex(ID)])
    .transform(Number),
});

const practiceNotFound = () =>
  NextResponse.json(
    { type: '/errors/resource-not-found', title: 'Practice not found', status: 404 },
    { status: 404 },
  );

export const POST = withAuth(async (req: NextRequest, ctx) => {
  const { actor, params } = ctx as any;
  if (actor.role !== 'SUPER_ADMIN') {
    return NextResponse.json(forbidden('Insufficient permissions'), { status: 403 });
  }
  if (!ID.test(String(params?.id ?? ''))) return practiceNotFound();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { type: '/errors/bad-request', title: 'Invalid JSON', status: 400 },
      { status: 400 },
    );
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        type: '/errors/validation-error',
        title: 'Validation Error',
        status: 422,
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
      { status: 422 },
    );
  }

  try {
    const result = await changePracticeAdmin(Number(params.id), parsed.data.newAdminId, actor.id);
    return NextResponse.json({ message: 'Practice admin updated', data: result }, { status: 200 });
  } catch (err) {
    if (err instanceof PracticeNotFoundError) return practiceNotFound();
    if (err instanceof NotAClinicAdminError) {
      return NextResponse.json(
        {
          type: '/errors/validation-error',
          title: 'Not a clinic admin',
          status: 422,
          code: 'not_a_clinic_admin',
          detail: err.message,
        },
        { status: 422 },
      );
    }
    await logging.error('changePracticeAdmin failed', err, { path: `/api/v1/practices/${params.id}/change-admin` });
    return NextResponse.json(
      { type: '/errors/internal', title: 'Internal Server Error', status: 500 },
      { status: 500 },
    );
  }
});
