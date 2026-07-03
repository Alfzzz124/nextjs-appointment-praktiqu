import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth';
import { kcHandle, kcOk, kcFail } from '@/lib/kc-response';
import { assertCan } from '@/services/billing/kc-permissions';
import { resolveKcActor } from '@/services/billing/kc-actor';
import { scheduleScopeFor } from '@/services/billing/schedule-scope';
import { unavailableScheduleSchema } from '@/services/billing/validation';
import { getUnavailableSchedule } from '@/services/billing/clinic-schedule.service';

export const POST = withAuth(async (req: NextRequest, ctx) => kcHandle(async () => {
  const { actor } = ctx as any;
  assertCan(actor, 'schedule_read');
  const kc = await resolveKcActor(actor);
  const parsed = unavailableScheduleSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return kcFail('Invalid input', 400);
  return kcOk(await getUnavailableSchedule(parsed.data as any, scheduleScopeFor(kc)), 'Unavailable schedule retrieved successfully');
}));
