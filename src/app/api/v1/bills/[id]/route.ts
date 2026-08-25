import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth';
import { kcOk, kcHandle, kcFail } from '@/lib/kc-response';
import { assertCan, assertBillingEnabled, billScopeFor } from '@/services/billing/kc-permissions';
import { resolveKcActor } from '@/services/billing/kc-actor';
import { getBill, updateBill } from '@/services/billing/bill.service';
import { billUpdateSchema } from '@/services/billing/validation';

export const GET = withAuth(async (_req: NextRequest, ctx) =>
  kcHandle(async () => {
    const { actor, params } = ctx as any;
    await assertBillingEnabled();
    assertCan(actor, 'patient_bill_view');
    const kc = await resolveKcActor(actor);
    return kcOk(await getBill(Number(params.id), billScopeFor(kc)), 'Bill retrieved successfully');
  }),
);

export const PUT = withAuth(async (req: NextRequest, ctx) =>
  kcHandle(async () => {
    const { actor, params } = ctx as any;
    await assertBillingEnabled();
    assertCan(actor, 'patient_bill_add');
    const kc = await resolveKcActor(actor);
    const parsed = billUpdateSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return kcFail(parsed.error.issues[0]?.message ?? 'Invalid input', 400);
    return kcOk(await updateBill(Number(params.id), parsed.data as any, billScopeFor(kc)), 'Bill updated successfully');
  }),
);
