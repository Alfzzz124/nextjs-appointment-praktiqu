import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth';
import { kcHandle, kcOk } from '@/lib/kc-response';
import { assertCan } from '@/services/billing/kc-permissions';
import { resolveKcActor } from '@/services/billing/kc-actor';
import { completeFollowup } from '@/services/billing/followup.service';
import { followupScopeFor } from '@/services/billing/followup-scope';

export const POST = withAuth(async (req: NextRequest, ctx) =>
  kcHandle(async () => {
    const { actor, params } = ctx as any;
    assertCan(actor, 'followup_manage');
    const kc = await resolveKcActor(actor);
    const body = await req.json().catch(() => ({}));
    const note = typeof body?.note === 'string' ? body.note : undefined;
    await completeFollowup(Number(params.id), note, kc, followupScopeFor(kc));
    return kcOk(null, 'Followup completed successfully');
  }),
);
