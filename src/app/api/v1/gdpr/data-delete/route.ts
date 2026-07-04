import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth';
import { kcHandle, kcOk, kcFail } from '@/lib/kc-response';
import { assertCan } from '@/services/billing/kc-permissions';
import { resolveKcActor } from '@/services/billing/kc-actor';
import { softDeleteSubject } from '@/services/billing/gdpr.service';
import { gdprDeleteSchema } from '@/services/billing/validation';

export const POST = withAuth(async (req: NextRequest, ctx) => kcHandle(async () => {
  const { actor } = ctx as any;
  // gdpr_delete is SUPER_ADMIN-only via capability.
  assertCan(actor, 'gdpr_delete');
  const kc = await resolveKcActor(actor);
  const parsed = gdprDeleteSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return kcFail('Invalid input', 400);
  return kcOk(await softDeleteSubject(parsed.data.userId, kc), 'Subject data erasure flagged successfully');
}));
