import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth';
import { kcHandle, kcOk } from '@/lib/kc-response';
import { assertCan } from '@/services/billing/kc-permissions';
import { resolveKcActor } from '@/services/billing/kc-actor';
import { getConsentVersion } from '@/services/billing/gdpr.service';

export const GET = withAuth(async (_req: NextRequest, ctx) => kcHandle(async () => {
  const { actor, params } = ctx as any;
  assertCan(actor, 'gdpr_read');
  await resolveKcActor(actor);
  return kcOk(await getConsentVersion(Number(params.id)), 'Consent version retrieved successfully');
}));
