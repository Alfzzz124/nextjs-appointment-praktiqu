import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth';
import { kcOk, kcHandle, kcFail } from '@/lib/kc-response';
import { assertCan, assertBillingEnabled } from '@/services/billing/kc-permissions';
import { bulkSetTaxStatus } from '@/services/billing/tax.service';
import { idsStatusSchema } from '@/services/billing/validation';

export const PUT = withAuth(async (req: NextRequest, ctx) =>
  kcHandle(async () => {
    const { actor } = ctx as any;
    await assertBillingEnabled();
    assertCan(actor, 'tax_manage');
    const parsed = idsStatusSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return kcFail('Invalid input', 400);
    const n = await bulkSetTaxStatus(parsed.data.ids, parsed.data.status);
    return kcOk(null, `${n} taxes status updated.`);
  }),
);
