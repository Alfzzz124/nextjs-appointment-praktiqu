import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth';
import { kcHandle, kcOk } from '@/lib/kc-response';
import { assertCan } from '@/services/billing/kc-permissions';
import { resolveKcActor } from '@/services/billing/kc-actor';
import { sendReminderNow } from '@/services/billing/followup.service';
import { followupScopeFor } from '@/services/billing/followup-scope';

export const POST = withAuth(async (_req: NextRequest, ctx) =>
  kcHandle(async () => {
    const { actor, params } = ctx as any;
    assertCan(actor, 'followup_manage');
    const kc = await resolveKcActor(actor);
    const result = await sendReminderNow(Number(params.id), kc, followupScopeFor(kc));
    return kcOk(result, 'Followup reminder sent successfully');
  }),
);
