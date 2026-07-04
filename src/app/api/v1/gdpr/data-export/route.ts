import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth';
import { kcHandle, kcOk, kcFail } from '@/lib/kc-response';
import { assertCan } from '@/services/billing/kc-permissions';
import { resolveKcActor } from '@/services/billing/kc-actor';
import { exportSubjectData } from '@/services/billing/gdpr.service';
import { gdprExportSchema } from '@/services/billing/validation';

export const POST = withAuth(async (req: NextRequest, ctx) => kcHandle(async () => {
  const { actor } = ctx as any;
  assertCan(actor, 'gdpr_export');
  const kc = await resolveKcActor(actor);
  const parsed = gdprExportSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return kcFail('Invalid input', 400);
  let subjectUserId: number;
  if (actor.role === 'CLIENT') {
    subjectUserId = Number(kc.wpUserId);
  } else {
    if (parsed.data.userId === undefined) return kcFail('userId is required', 400);
    subjectUserId = parsed.data.userId;
  }
  return kcOk(await exportSubjectData(subjectUserId), 'Subject data exported successfully');
}));
