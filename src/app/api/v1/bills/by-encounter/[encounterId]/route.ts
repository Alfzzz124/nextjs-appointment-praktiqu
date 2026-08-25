import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth';
import { kcOk, kcHandle } from '@/lib/kc-response';
import { assertCan, assertBillingEnabled, billScopeFor } from '@/services/billing/kc-permissions';
import { resolveKcActor } from '@/services/billing/kc-actor';
import { getBillByEncounter } from '@/services/billing/bill.service';

export const GET = withAuth(async (_req: NextRequest, ctx) =>
  kcHandle(async () => {
    const { actor, params } = ctx as any;
    await assertBillingEnabled();
    assertCan(actor, 'patient_bill_view');
    const kc = await resolveKcActor(actor);
    return kcOk(await getBillByEncounter(Number(params.encounterId), billScopeFor(kc)), 'Bill fetched');
  }),
);
