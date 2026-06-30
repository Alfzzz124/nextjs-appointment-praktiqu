import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth';
import { kcOk, kcHandle, kcFail } from '@/lib/kc-response';
import { assertCan, assertBillingEnabled, billScopeFor } from '@/services/billing/kc-permissions';
import { resolveKcActor } from '@/services/billing/kc-actor';
import { listBills, createBill } from '@/services/billing/bill.service';
import { billListQuerySchema, billCreateSchema } from '@/services/billing/validation';

export const GET = withAuth(async (req: NextRequest, ctx) =>
  kcHandle(async () => {
    const { actor } = ctx as any;
    await assertBillingEnabled();
    assertCan(actor, 'patient_bill_list');
    const kc = await resolveKcActor(actor);
    const parsed = billListQuerySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
    if (!parsed.success) return kcFail('Invalid query', 400);
    const data = await listBills(parsed.data as any, billScopeFor(kc));
    return kcOk(data, 'Bills retrieved successfully');
  }),
);

export const POST = withAuth(async (req: NextRequest, ctx) =>
  kcHandle(async () => {
    const { actor } = ctx as any;
    await assertBillingEnabled();
    assertCan(actor, 'patient_bill_add');
    const parsed = billCreateSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return kcFail(parsed.error.issues[0]?.message ?? 'Invalid input', 400);
    const data = await createBill(parsed.data as any);
    return kcOk(data, 'Bill created successfully');
  }),
);
