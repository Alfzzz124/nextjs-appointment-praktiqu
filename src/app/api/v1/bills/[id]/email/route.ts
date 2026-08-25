import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth';
import { kcOk, kcHandle, kcFail } from '@/lib/kc-response';
import { assertCan, assertBillingEnabled, billScopeFor } from '@/services/billing/kc-permissions';
import { resolveKcActor } from '@/services/billing/kc-actor';
import { emailBill } from '@/services/billing/bill-document.service';
import { getBill } from '@/services/billing/bill.service';

export const runtime = 'nodejs';

export const POST = withAuth(async (req: NextRequest, ctx) =>
  kcHandle(async () => {
    const { actor, params } = ctx as any;
    await assertBillingEnabled();
    assertCan(actor, 'patient_bill_view');
    const kc = await resolveKcActor(actor);
    const scope = billScopeFor(kc);
    const bill = await getBill(Number(params.id), scope); // 404s before anything is sent if out of scope
    const body = await req.json().catch(() => ({}));
    // A CLIENT may not redirect their own invoice to an arbitrary address — that is
    // an open mail-relay primitive, not a feature, once every bill in scope was
    // reachable by id. Staff roles (who already see the recipient's real address in
    // the UI) keep the override for legitimate resends (e.g. to an accountant).
    let to: string = actor.role === 'CLIENT' ? '' : (body?.to ?? '');
    if (!to) to = (bill as any).patient?.email ?? '';
    if (!to) return kcFail('No recipient email available for this bill', 400);
    await emailBill(Number(params.id), to, scope);
    return kcOk(true, 'Bill sent successfully');
  }),
);
