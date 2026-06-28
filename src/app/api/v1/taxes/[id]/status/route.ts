import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth';
import { kcOk, kcHandle, kcFail } from '@/lib/kc-response';
import { assertCan, assertBillingEnabled } from '@/services/billing/kc-permissions';
import { setTaxStatus } from '@/services/billing/tax.service';
import { statusSchema } from '@/services/billing/validation';

export const PUT = withAuth(async (req: NextRequest, ctx) =>
  kcHandle(async () => {
    const { actor, params } = ctx as any;
    await assertBillingEnabled();
    assertCan(actor, 'tax_manage');
    const parsed = statusSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return kcFail('Invalid status', 400);
    await setTaxStatus(Number(params.id), parsed.data.status);
    return kcOk(null, 'Tax status updated.');
  }),
);
