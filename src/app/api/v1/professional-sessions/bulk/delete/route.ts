import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth';
import { kcHandle, kcOk, kcFail } from '@/lib/kc-response';
import { assertCan } from '@/services/billing/kc-permissions';
import { resolveKcActor } from '@/services/billing/kc-actor';
import { doctorSessionScopeFor } from '@/services/billing/staff-scope';
import { doctorSessionBulkDeleteSchema } from '@/services/billing/validation';
import {
  bulkDeleteDoctorSessions,
  bulkDeleteDoctorSessionGroups,
} from '@/services/billing/doctor-session.service';

/**
 * Delete many schedules at once.
 *
 * Accepts `groups` — what the list screen selects, since a line there is a whole
 * (doctor × clinic) schedule — or `ids` for the row-level callers that predate it.
 */
export const POST = withAuth(async (req: NextRequest, ctx) => kcHandle(async () => {
  const { actor } = ctx as any;
  assertCan(actor, 'doctor_session_manage');
  const kc = await resolveKcActor(actor);
  const parsed = doctorSessionBulkDeleteSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return kcFail('Invalid input', 400);
  const scope = doctorSessionScopeFor(kc);
  let n = 0;
  // zod widens every key to optional here because the repo compiles with strictNullChecks
  // off; the schema itself requires both ids.
  if (parsed.data.groups?.length) n += await bulkDeleteDoctorSessionGroups(parsed.data.groups as any, scope);
  if (parsed.data.ids?.length) n += await bulkDeleteDoctorSessions(parsed.data.ids, scope);
  return kcOk({ removed: n, updated: n }, `${n} doctor sessions deleted.`);
}));
