import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth';
import { kcOk, kcHandle, kcFail } from '@/lib/kc-response';
import { assertCan, assertBillingEnabled } from '@/services/billing/kc-permissions';
import { getTax, updateTax, deleteTax } from '@/services/billing/tax.service';
import { taxUpdateSchema } from '@/services/billing/validation';

export const GET = withAuth(async (_req: NextRequest, ctx) =>
  kcHandle(async () => {
    const { actor, params } = ctx as any;
    await assertBillingEnabled();
    assertCan(actor, 'tax_read');
    return kcOk(await getTax(Number(params.id)), 'Tax detail fetched successfully');
  }),
);

export const PUT = withAuth(async (req: NextRequest, ctx) =>
  kcHandle(async () => {
    const { actor, params } = ctx as any;
    await assertBillingEnabled();
    assertCan(actor, 'tax_manage');
    const parsed = taxUpdateSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return kcFail(parsed.error.issues[0]?.message ?? 'Invalid input', 400);
    await updateTax(Number(params.id), parsed.data as any);
    return kcOk(null, 'Tax updated successfully');
  }),
);

export const DELETE = withAuth(async (_req: NextRequest, ctx) =>
  kcHandle(async () => {
    const { actor, params } = ctx as any;
    await assertBillingEnabled();
    assertCan(actor, 'tax_manage');
    await deleteTax(Number(params.id));
    return kcOk(null, 'Tax deleted successfully.');
  }),
);
