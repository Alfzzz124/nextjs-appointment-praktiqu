import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth';
import { kcHandle, kcOk } from '@/lib/kc-response';
import { assertCan } from '@/services/billing/kc-permissions';
import { resolveKcActor } from '@/services/billing/kc-actor';
import { consentScopeFor, withdrawConsent } from '@/services/billing/gdpr.service';

export const POST = withAuth(async (_req: NextRequest, ctx) => kcHandle(async () => {
  const { actor, params } = ctx as any;
  assertCan(actor, 'gdpr_manage');
  const kc = await resolveKcActor(actor);
  await withdrawConsent(Number(params.id), consentScopeFor(kc));
  return kcOk(null, 'Consent withdrawn successfully');
}));
