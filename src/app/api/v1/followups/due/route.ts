import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth';
import { kcHandle, kcOk } from '@/lib/kc-response';
import { assertCan } from '@/services/billing/kc-permissions';
import { resolveKcActor } from '@/services/billing/kc-actor';
import { listDueFollowups } from '@/services/billing/followup.service';
import { followupScopeFor } from '@/services/billing/followup-scope';

export const GET = withAuth(async (_req: NextRequest, ctx) =>
  kcHandle(async () => {
    const { actor } = ctx as any;
    assertCan(actor, 'followup_read');
    const kc = await resolveKcActor(actor);
    const data = await listDueFollowups(kc, followupScopeFor(kc));
    return kcOk(data, 'Due followups retrieved successfully');
  }),
);
