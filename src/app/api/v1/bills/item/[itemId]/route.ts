import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth';
import { kcOk, kcHandle, kcFail } from '@/lib/kc-response';
import { assertCan, assertBillingEnabled, billScopeFor } from '@/services/billing/kc-permissions';
import { resolveKcActor } from '@/services/billing/kc-actor';
import { updateBillItem, deleteBillItem } from '@/services/billing/bill.service';
import { billItemUpdateSchema } from '@/services/billing/validation';

export const PUT = withAuth(async (req: NextRequest, ctx) =>
  kcHandle(async () => {
    const { actor, params } = ctx as any;
    await assertBillingEnabled();
    assertCan(actor, 'patient_bill_add');
    const kc = await resolveKcActor(actor);
    const parsed = billItemUpdateSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return kcFail(parsed.error.issues[0]?.message ?? 'Invalid input', 400);
    return kcOk(await updateBillItem(Number(params.itemId), parsed.data as any, billScopeFor(kc)), 'Bill item updated successfully');
  }),
);

export const DELETE = withAuth(async (_req: NextRequest, ctx) =>
  kcHandle(async () => {
    const { actor, params } = ctx as any;
    await assertBillingEnabled();
    assertCan(actor, 'patient_bill_delete');
    const kc = await resolveKcActor(actor);
    return kcOk(await deleteBillItem(Number(params.itemId), billScopeFor(kc)), 'Bill item deleted successfully');
  }),
);
