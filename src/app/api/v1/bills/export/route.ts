import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth';
import { kcOk, kcHandle, kcFail } from '@/lib/kc-response';
import { assertCan, assertBillingEnabled, billScopeFor } from '@/services/billing/kc-permissions';
import { resolveKcActor } from '@/services/billing/kc-actor';
import { exportBills } from '@/services/billing/bill.service';
import { billListQuerySchema } from '@/services/billing/validation';

export const GET = withAuth(async (req: NextRequest, ctx) =>
  kcHandle(async () => {
    const { actor } = ctx as any;
    await assertBillingEnabled();
    assertCan(actor, 'patient_bill_list');
    const kc = await resolveKcActor(actor);
    const parsed = billListQuerySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
    if (!parsed.success) return kcFail('Invalid query', 400);
    return kcOk(await exportBills(parsed.data as any, billScopeFor(kc)), 'Bills data retrieved successfully');
  }),
);
