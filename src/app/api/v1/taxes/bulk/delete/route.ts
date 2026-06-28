import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth';
import { kcOk, kcHandle, kcFail } from '@/lib/kc-response';
import { assertCan, assertBillingEnabled } from '@/services/billing/kc-permissions';
import { bulkDeleteTaxes } from '@/services/billing/tax.service';
import { idsSchema } from '@/services/billing/validation';

export const POST = withAuth(async (req: NextRequest, ctx) =>
  kcHandle(async () => {
    const { actor } = ctx as any;
    await assertBillingEnabled();
    assertCan(actor, 'tax_manage');
    const parsed = idsSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return kcFail('Invalid input', 400);
    const n = await bulkDeleteTaxes(parsed.data.ids);
    return kcOk(null, `${n} taxes deleted successfully.`);
  }),
);
