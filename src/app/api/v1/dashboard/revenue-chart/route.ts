import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth';
import { kcHandle, kcOk, kcFail } from '@/lib/kc-response';
import { assertCan } from '@/services/billing/kc-permissions';
import { resolveKcActor } from '@/services/billing/kc-actor';
import { dashboardScopeFor } from '@/services/billing/schedule-scope';
import { dashboardQuerySchema } from '@/services/billing/validation';
import { getRevenueChart } from '@/services/billing/dashboard.service';

export const GET = withAuth(async (req: NextRequest, ctx) => kcHandle(async () => {
  const { actor } = ctx as any;
  assertCan(actor, 'dashboard_read');
  const kc = await resolveKcActor(actor);
  const parsed = dashboardQuerySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!parsed.success) return kcFail('Invalid query', 400);
  return kcOk(await getRevenueChart(parsed.data as any, dashboardScopeFor(kc)), 'Revenue chart');
}));
