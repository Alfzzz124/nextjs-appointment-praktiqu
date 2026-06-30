import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth';
import { kcOk, kcHandle, kcFail } from '@/lib/kc-response';
import { assertCan, assertBillingEnabled } from '@/services/billing/kc-permissions';
import { emailBill } from '@/services/billing/bill-document.service';
import { getBill } from '@/services/billing/bill.service';

export const runtime = 'nodejs';

export const POST = withAuth(async (req: NextRequest, ctx) =>
  kcHandle(async () => {
    const { actor, params } = ctx as any;
    await assertBillingEnabled();
    assertCan(actor, 'patient_bill_view');
    const body = await req.json().catch(() => ({}));
    let to: string = body?.to ?? '';
    if (!to) {
      const bill = await getBill(Number(params.id));
      to = (bill as any).patient?.email ?? '';
    }
    if (!to) return kcFail('No recipient email available for this bill', 400);
    await emailBill(Number(params.id), to);
    return kcOk(true, 'Bill sent successfully');
  }),
);
