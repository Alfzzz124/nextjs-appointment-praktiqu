import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth';
import { kcHandle, kcOk, kcFail } from '@/lib/kc-response';
import { assertCan } from '@/services/billing/kc-permissions';
import { resolveKcActor } from '@/services/billing/kc-actor';
import { followupListQuerySchema, followupCreateSchema } from '@/services/billing/validation';
import { listFollowups, createFollowup } from '@/services/billing/followup.service';
import { followupScopeFor } from '@/services/billing/followup-scope';

export const GET = withAuth(async (req: NextRequest, ctx) =>
  kcHandle(async () => {
    const { actor } = ctx as any;
    assertCan(actor, 'followup_read');
    const kc = await resolveKcActor(actor);
    const parsed = followupListQuerySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
    if (!parsed.success) return kcFail('Invalid query', 400);
    const data = await listFollowups(parsed.data as any, followupScopeFor(kc));
    return kcOk(data, 'Followups retrieved successfully');
  }),
);

export const POST = withAuth(async (req: NextRequest, ctx) =>
  kcHandle(async () => {
    const { actor } = ctx as any;
    assertCan(actor, 'followup_manage');
    const kc = await resolveKcActor(actor);
    const parsed = followupCreateSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return kcFail('Invalid input', 400);
    const created = await createFollowup(parsed.data as any, kc);
    return kcOk(created, 'Followup created successfully');
  }),
);
