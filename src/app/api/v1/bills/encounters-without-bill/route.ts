import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth';
import { kcOk, kcHandle } from '@/lib/kc-response';
import { assertCan, assertBillingEnabled, billScopeFor } from '@/services/billing/kc-permissions';
import { resolveKcActor } from '@/services/billing/kc-actor';
import { encountersWithoutBill } from '@/services/billing/bill.service';

export const GET = withAuth(async (_req: NextRequest, ctx) =>
  kcHandle(async () => {
    const { actor } = ctx as any;
    await assertBillingEnabled();
    assertCan(actor, 'patient_bill_list');
    const kc = await resolveKcActor(actor);
    return kcOk(await encountersWithoutBill(billScopeFor(kc)), 'Encounters without bill retrieved successfully');
  }),
);
