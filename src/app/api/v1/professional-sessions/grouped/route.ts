/**
 * GET /api/v1/doctor-sessions/grouped — the schedule list screen.
 *
 * One row per (doctor × clinic) rather than per stored window: a doctor working Monday
 * and Tuesday with a lunch break is four rows in the table but one line in the UI.
 */
import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth';
import { kcHandle, kcOk, kcFail } from '@/lib/kc-response';
import { assertCan } from '@/services/billing/kc-permissions';
import { resolveKcActor } from '@/services/billing/kc-actor';
import { doctorSessionScopeFor } from '@/services/billing/staff-scope';
import { doctorSessionGroupListQuerySchema } from '@/services/billing/validation';
import { listDoctorSessionGroups } from '@/services/billing/doctor-session.service';

export const GET = withAuth(async (req: NextRequest, ctx) => kcHandle(async () => {
  const { actor } = ctx as any;
  assertCan(actor, 'doctor_session_read');
  const kc = await resolveKcActor(actor);
  const parsed = doctorSessionGroupListQuerySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!parsed.success) return kcFail('Invalid query', 400);
  return kcOk(
    await listDoctorSessionGroups(parsed.data as any, doctorSessionScopeFor(kc)),
    'Doctor sessions retrieved successfully',
  );
}));
