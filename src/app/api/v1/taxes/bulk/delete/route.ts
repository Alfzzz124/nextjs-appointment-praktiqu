import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth';
import { kcOk, kcHandle, kcFail } from '@/lib/kc-response';
import { assertCan, assertBillingEnabled, taxScopeFor } from '@/services/billing/kc-permissions';
import { resolveKcActor } from '@/services/billing/kc-actor';
import { bulkDeleteTaxes } from '@/services/billing/tax.service';
import { idsSchema } from '@/services/billing/validation';

export const POST = withAuth(async (req: NextRequest, ctx) =>
  kcHandle(async () => {
    const { actor } = ctx as any;
    await assertBillingEnabled();
    assertCan(actor, 'tax_manage');
    const kc = await resolveKcActor(actor);
    const parsed = idsSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return kcFail('Invalid input', 400);
    const n = await bulkDeleteTaxes(parsed.data.ids, taxScopeFor(kc));
    return kcOk(null, `${n} taxes deleted successfully.`);
  }),
);
