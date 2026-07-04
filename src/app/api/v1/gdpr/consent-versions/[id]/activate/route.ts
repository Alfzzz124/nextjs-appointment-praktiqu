import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth';
import { kcHandle, kcOk, kcFail } from '@/lib/kc-response';
import { assertCan } from '@/services/billing/kc-permissions';
import { resolveKcActor } from '@/services/billing/kc-actor';
import { activateConsentVersion } from '@/services/billing/gdpr.service';

export const POST = withAuth(async (_req: NextRequest, ctx) => kcHandle(async () => {
  const { actor, params } = ctx as any;
  assertCan(actor, 'gdpr_manage');
  // Only admins activate consent versions.
  if (actor.role === 'CLIENT') return kcFail('Forbidden', 403);
  await resolveKcActor(actor);
  await activateConsentVersion(Number(params.id));
  return kcOk(null, 'Consent version activated successfully');
}));
