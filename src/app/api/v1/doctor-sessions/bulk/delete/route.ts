import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth';
import { kcHandle, kcOk, kcFail } from '@/lib/kc-response';
import { assertCan } from '@/services/billing/kc-permissions';
import { resolveKcActor } from '@/services/billing/kc-actor';
import { doctorSessionScopeFor } from '@/services/billing/staff-scope';
import { idsSchema } from '@/services/billing/validation';
import { bulkDeleteDoctorSessions } from '@/services/billing/doctor-session.service';

export const POST = withAuth(async (req: NextRequest, ctx) => kcHandle(async () => {
  const { actor } = ctx as any;
  assertCan(actor, 'doctor_session_manage');
  const kc = await resolveKcActor(actor);
  const parsed = idsSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return kcFail('Invalid input', 400);
  const n = await bulkDeleteDoctorSessions(parsed.data.ids, doctorSessionScopeFor(kc));
  return kcOk({ updated: n }, `${n} doctor sessions deleted.`);
}));
