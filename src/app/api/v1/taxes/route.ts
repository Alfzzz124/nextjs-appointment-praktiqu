import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth';
import { kcOk, kcHandle, kcFail } from '@/lib/kc-response';
import { assertCan, assertBillingEnabled } from '@/services/billing/kc-permissions';
import { resolveKcActor } from '@/services/billing/kc-actor';
import { listTaxes, createTax } from '@/services/billing/tax.service';
import { taxListQuerySchema, taxCreateSchema } from '@/services/billing/validation';

export const GET = withAuth(async (req: NextRequest, ctx) =>
  kcHandle(async () => {
    const { actor } = ctx as any;
    await assertBillingEnabled();
    assertCan(actor, 'tax_read');
    const kc = await resolveKcActor(actor);
    const parsed = taxListQuerySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
    if (!parsed.success) return kcFail('Invalid query', 400);
    const scope = actor.role === 'SUPER_ADMIN' ? null : { clinicId: kc.clinicId ?? -1n };
    const data = await listTaxes(parsed.data as any, scope);
    return kcOk(data, 'Taxes retrieved successfully');
  }),
);

export const POST = withAuth(async (req: NextRequest, ctx) =>
  kcHandle(async () => {
    const { actor } = ctx as any;
    await assertBillingEnabled();
    assertCan(actor, 'tax_manage');
    const kc = await resolveKcActor(actor);
    const body = await req.json().catch(() => ({}));
    const parsed = taxCreateSchema.safeParse(body);
    if (!parsed.success) return kcFail(parsed.error.issues[0]?.message ?? 'Invalid input', 400);
    const data = await createTax(parsed.data as any, Number(kc.wpUserId));
    return kcOk(data, `Tax created successfully${data.skipped_count ? ` (${data.skipped_count} skipped as duplicates)` : ''}`);
  }),
);
