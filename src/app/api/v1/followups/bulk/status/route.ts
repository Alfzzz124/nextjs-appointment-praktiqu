import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth';
import { kcHandle, kcOk, kcFail } from '@/lib/kc-response';
import { assertCan } from '@/services/billing/kc-permissions';
import { resolveKcActor } from '@/services/billing/kc-actor';
import { followupBulkStatusSchema } from '@/services/billing/validation';
import { bulkSetFollowupStatus } from '@/services/billing/followup.service';
import { followupScopeFor } from '@/services/billing/followup-scope';

export const POST = withAuth(async (req: NextRequest, ctx) =>
  kcHandle(async () => {
    const { actor } = ctx as any;
    assertCan(actor, 'followup_manage');
    const kc = await resolveKcActor(actor);
    const parsed = followupBulkStatusSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return kcFail('Invalid input', 400);
    const n = await bulkSetFollowupStatus(parsed.data.ids, parsed.data.status, parsed.data.note, kc, followupScopeFor(kc));
    return kcOk({ updated: n }, `${n} followups status updated.`);
  }),
);
