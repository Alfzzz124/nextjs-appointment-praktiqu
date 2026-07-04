import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth';
import { kcHandle, kcOk, kcFail } from '@/lib/kc-response';
import { assertCan } from '@/services/billing/kc-permissions';
import { resolveKcActor } from '@/services/billing/kc-actor';
import { reminderCreateSchema } from '@/services/billing/validation';
import { listReminders, createReminder } from '@/services/billing/followup.service';
import { followupScopeFor } from '@/services/billing/followup-scope';

export const GET = withAuth(async (_req: NextRequest, ctx) =>
  kcHandle(async () => {
    const { actor, params } = ctx as any;
    assertCan(actor, 'followup_read');
    const kc = await resolveKcActor(actor);
    const data = await listReminders(Number(params.id), followupScopeFor(kc));
    return kcOk(data, 'Followup reminders retrieved successfully');
  }),
);

export const POST = withAuth(async (req: NextRequest, ctx) =>
  kcHandle(async () => {
    const { actor, params } = ctx as any;
    assertCan(actor, 'followup_manage');
    const kc = await resolveKcActor(actor);
    const parsed = reminderCreateSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return kcFail('Invalid input', 400);
    const created = await createReminder(Number(params.id), parsed.data as any, followupScopeFor(kc));
    return kcOk(created, 'Followup reminder created successfully');
  }),
);
