import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth';
import { kcOk, kcHandle, kcFail } from '@/lib/kc-response';
import { assertCan, assertBillingEnabled } from '@/services/billing/kc-permissions';
import { resolveKcActor } from '@/services/billing/kc-actor';
import { exportTaxes } from '@/services/billing/tax.service';
import { taxListQuerySchema } from '@/services/billing/validation';

export const GET = withAuth(async (req: NextRequest, ctx) =>
  kcHandle(async () => {
    const { actor } = ctx as any;
    await assertBillingEnabled();
    assertCan(actor, 'tax_read');
    const kc = await resolveKcActor(actor);
    const parsed = taxListQuerySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
    if (!parsed.success) return kcFail('Invalid query', 400);
    const scope = actor.role === 'SUPER_ADMIN' ? null : { clinicId: kc.clinicId ?? -1n };
    const data = await exportTaxes(parsed.data as any, scope);
    return kcOk(data, 'Taxes data retrieved successfully');
  }),
);
