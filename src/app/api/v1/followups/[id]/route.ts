import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth';
import { kcHandle, kcOk, kcFail } from '@/lib/kc-response';
import { assertCan } from '@/services/billing/kc-permissions';
import { resolveKcActor } from '@/services/billing/kc-actor';
import { followupUpdateSchema } from '@/services/billing/validation';
import { getFollowup, updateFollowup, deleteFollowup } from '@/services/billing/followup.service';
import { followupScopeFor } from '@/services/billing/followup-scope';

export const GET = withAuth(async (_req: NextRequest, ctx) =>
  kcHandle(async () => {
    const { actor, params } = ctx as any;
    assertCan(actor, 'followup_read');
    const kc = await resolveKcActor(actor);
    const data = await getFollowup(Number(params.id), followupScopeFor(kc));
    return kcOk(data, 'Followup retrieved successfully');
  }),
);

export const PUT = withAuth(async (req: NextRequest, ctx) =>
  kcHandle(async () => {
    const { actor, params } = ctx as any;
    assertCan(actor, 'followup_manage');
    const kc = await resolveKcActor(actor);
    const parsed = followupUpdateSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return kcFail('Invalid input', 400);
    await updateFollowup(Number(params.id), parsed.data, kc, followupScopeFor(kc));
    return kcOk(null, 'Followup updated successfully');
  }),
);

export const DELETE = withAuth(async (_req: NextRequest, ctx) =>
  kcHandle(async () => {
    const { actor, params } = ctx as any;
    assertCan(actor, 'followup_manage');
    const kc = await resolveKcActor(actor);
    await deleteFollowup(Number(params.id), kc, followupScopeFor(kc));
    return kcOk(null, 'Followup deleted successfully');
  }),
);
