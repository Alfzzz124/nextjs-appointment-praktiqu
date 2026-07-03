import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth';
import { kcHandle, kcOk, kcFail } from '@/lib/kc-response';
import { assertCan } from '@/services/billing/kc-permissions';
import { resolveKcActor } from '@/services/billing/kc-actor';
import { doctorSessionScopeFor } from '@/services/billing/staff-scope';
import { doctorSessionListQuerySchema } from '@/services/billing/validation';
import { exportDoctorSessions } from '@/services/billing/doctor-session.service';

export const GET = withAuth(async (req: NextRequest, ctx) => kcHandle(async () => {
  const { actor } = ctx as any;
  assertCan(actor, 'doctor_session_read');
  const kc = await resolveKcActor(actor);
  const parsed = doctorSessionListQuerySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!parsed.success) return kcFail('Invalid query', 400);
  return kcOk(await exportDoctorSessions(parsed.data as any, doctorSessionScopeFor(kc)), 'Doctor sessions data retrieved successfully');
}));
