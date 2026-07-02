import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth';
import { kcHandle, kcOk, kcFail } from '@/lib/kc-response';
import { assertCan } from '@/services/billing/kc-permissions';
import { resolveKcActor } from '@/services/billing/kc-actor';
import { leafScopeFor } from '@/services/billing/kc-leaf-scope';
import { idsSchema } from '@/services/billing/validation';
import { bulkDeletePrescriptions } from '@/services/billing/prescription.service';

export const POST = withAuth(async (req: NextRequest, ctx) => kcHandle(async () => {
  const { actor } = ctx as any;
  assertCan(actor, 'prescription_manage');
  const kc = await resolveKcActor(actor);
  const parsed = idsSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return kcFail('Invalid input', 400);
  const n = await bulkDeletePrescriptions(parsed.data.ids, leafScopeFor(kc));
  return kcOk({ updated: n }, `${n} prescriptions deleted.`);
}));
