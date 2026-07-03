import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth';
import { kcHandle, kcOk, kcFail } from '@/lib/kc-response';
import { assertCan } from '@/services/billing/kc-permissions';
import { resolveKcActor } from '@/services/billing/kc-actor';
import { receptionistScopeFor } from '@/services/billing/staff-scope';
import { idsStatusSchema } from '@/services/billing/validation';
import { bulkSetReceptionistStatus } from '@/services/billing/receptionist.service';

export const POST = withAuth(async (req: NextRequest, ctx) => kcHandle(async () => {
  const { actor } = ctx as any;
  assertCan(actor, 'receptionist_manage');
  const kc = await resolveKcActor(actor);
  const parsed = idsStatusSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return kcFail('Invalid input', 400);
  const n = await bulkSetReceptionistStatus(parsed.data.ids, parsed.data.status, receptionistScopeFor(kc));
  return kcOk({ updated: n }, `${n} receptionists updated.`);
}));
