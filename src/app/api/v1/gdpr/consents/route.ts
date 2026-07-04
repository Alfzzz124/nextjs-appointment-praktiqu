import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth';
import { kcHandle, kcOk, kcFail } from '@/lib/kc-response';
import { assertCan } from '@/services/billing/kc-permissions';
import { resolveKcActor } from '@/services/billing/kc-actor';
import { consentScopeFor, listConsents, grantConsent } from '@/services/billing/gdpr.service';
import { gdprConsentListSchema, gdprConsentCreateSchema } from '@/services/billing/validation';

export const GET = withAuth(async (req: NextRequest, ctx) => kcHandle(async () => {
  const { actor } = ctx as any;
  assertCan(actor, 'gdpr_read');
  const kc = await resolveKcActor(actor);
  const parsed = gdprConsentListSchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!parsed.success) return kcFail('Invalid input', 400);
  return kcOk(await listConsents(parsed.data as any, consentScopeFor(kc)), 'Consents retrieved successfully');
}));

export const POST = withAuth(async (req: NextRequest, ctx) => kcHandle(async () => {
  const { actor, ip } = ctx as any;
  assertCan(actor, 'gdpr_manage');
  const kc = await resolveKcActor(actor);
  const parsed = gdprConsentCreateSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return kcFail('Invalid input', 400);
  return kcOk(await grantConsent(parsed.data as any, kc, ip ?? null), 'Consent granted successfully');
}));
