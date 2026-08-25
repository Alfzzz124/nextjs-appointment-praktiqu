import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth';
import { kcOk, kcHandle, kcFail } from '@/lib/kc-response';
import { assertCan, assertBillingEnabled, taxScopeFor } from '@/services/billing/kc-permissions';
import { resolveKcActor } from '@/services/billing/kc-actor';
import { getTax, updateTax, deleteTax } from '@/services/billing/tax.service';
import { taxUpdateSchema } from '@/services/billing/validation';

export const GET = withAuth(async (_req: NextRequest, ctx) =>
  kcHandle(async () => {
    const { actor, params } = ctx as any;
    await assertBillingEnabled();
    assertCan(actor, 'tax_read');
    const kc = await resolveKcActor(actor);
    return kcOk(await getTax(Number(params.id), taxScopeFor(kc)), 'Tax detail fetched successfully');
  }),
);

export const PUT = withAuth(async (req: NextRequest, ctx) =>
  kcHandle(async () => {
    const { actor, params } = ctx as any;
    await assertBillingEnabled();
    assertCan(actor, 'tax_manage');
    const kc = await resolveKcActor(actor);
    const parsed = taxUpdateSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return kcFail(parsed.error.issues[0]?.message ?? 'Invalid input', 400);
    await updateTax(Number(params.id), parsed.data as any, taxScopeFor(kc));
    return kcOk(null, 'Tax updated successfully');
  }),
);

export const DELETE = withAuth(async (_req: NextRequest, ctx) =>
  kcHandle(async () => {
    const { actor, params } = ctx as any;
    await assertBillingEnabled();
    assertCan(actor, 'tax_manage');
    const kc = await resolveKcActor(actor);
    await deleteTax(Number(params.id), taxScopeFor(kc));
    return kcOk(null, 'Tax deleted successfully.');
  }),
);
