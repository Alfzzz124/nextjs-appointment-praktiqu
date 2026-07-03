import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth';
import { kcHandle, kcOk, kcFail } from '@/lib/kc-response';
import { assertCan } from '@/services/billing/kc-permissions';
import { resolveKcActor } from '@/services/billing/kc-actor';
import { scheduleScopeFor } from '@/services/billing/schedule-scope';
import { scheduleUpdateSchema } from '@/services/billing/validation';
import { getSchedule, updateSchedule, deleteSchedule } from '@/services/billing/clinic-schedule.service';

export const GET = withAuth(async (_req: NextRequest, ctx) => kcHandle(async () => {
  const { actor, params } = ctx as any;
  assertCan(actor, 'schedule_read');
  const kc = await resolveKcActor(actor);
  return kcOk(await getSchedule(Number(params.id), scheduleScopeFor(kc)), 'Clinic schedule retrieved successfully');
}));

export const PUT = withAuth(async (req: NextRequest, ctx) => kcHandle(async () => {
  const { actor, params } = ctx as any;
  assertCan(actor, 'schedule_manage');
  const kc = await resolveKcActor(actor);
  const parsed = scheduleUpdateSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return kcFail('Invalid input', 400);
  await updateSchedule(Number(params.id), parsed.data, scheduleScopeFor(kc));
  return kcOk(null, 'Clinic schedule updated successfully');
}));

export const DELETE = withAuth(async (_req: NextRequest, ctx) => kcHandle(async () => {
  const { actor, params } = ctx as any;
  assertCan(actor, 'schedule_manage');
  const kc = await resolveKcActor(actor);
  await deleteSchedule(Number(params.id), scheduleScopeFor(kc));
  return kcOk(null, 'Clinic schedule deleted successfully');
}));
