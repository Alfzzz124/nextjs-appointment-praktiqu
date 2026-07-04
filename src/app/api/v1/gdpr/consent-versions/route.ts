import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth';
import { kcHandle, kcOk, kcFail } from '@/lib/kc-response';
import { assertCan } from '@/services/billing/kc-permissions';
import { resolveKcActor } from '@/services/billing/kc-actor';
import { listConsentVersions, createConsentVersion } from '@/services/billing/gdpr.service';
import { gdprVersionListSchema, gdprVersionCreateSchema } from '@/services/billing/validation';

export const GET = withAuth(async (req: NextRequest, ctx) => kcHandle(async () => {
  const { actor } = ctx as any;
  assertCan(actor, 'gdpr_read');
  await resolveKcActor(actor);
  const parsed = gdprVersionListSchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!parsed.success) return kcFail('Invalid input', 400);
  return kcOk(await listConsentVersions(parsed.data as any), 'Consent versions retrieved successfully');
}));

export const POST = withAuth(async (req: NextRequest, ctx) => kcHandle(async () => {
  const { actor } = ctx as any;
  assertCan(actor, 'gdpr_manage');
  // Only admins publish consent versions.
  if (actor.role === 'CLIENT') return kcFail('Forbidden', 403);
  const kc = await resolveKcActor(actor);
  const parsed = gdprVersionCreateSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return kcFail('Invalid input', 400);
  return kcOk(await createConsentVersion(parsed.data as any, kc), 'Consent version created successfully');
}));
