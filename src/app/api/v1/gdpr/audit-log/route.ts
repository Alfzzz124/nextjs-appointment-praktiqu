import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth';
import { kcHandle, kcOk, kcFail } from '@/lib/kc-response';
import { assertCan } from '@/services/billing/kc-permissions';
import { resolveKcActor } from '@/services/billing/kc-actor';
import { listAuditLog } from '@/services/billing/gdpr.service';
import { gdprAuditListSchema } from '@/services/billing/validation';

export const GET = withAuth(async (req: NextRequest, ctx) => kcHandle(async () => {
  const { actor } = ctx as any;
  assertCan(actor, 'gdpr_audit_read');
  await resolveKcActor(actor);
  const parsed = gdprAuditListSchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!parsed.success) return kcFail('Invalid input', 400);
  return kcOk(await listAuditLog(parsed.data as any), 'Audit log retrieved successfully');
}));
