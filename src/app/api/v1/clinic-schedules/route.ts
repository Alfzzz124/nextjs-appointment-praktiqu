import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth';
import { kcHandle, kcOk, kcFail } from '@/lib/kc-response';
import { assertCan } from '@/services/billing/kc-permissions';
import { resolveKcActor } from '@/services/billing/kc-actor';
import { scheduleScopeFor } from '@/services/billing/schedule-scope';
import { scheduleListQuerySchema, scheduleCreateSchema } from '@/services/billing/validation';
import { listSchedules, createSchedule } from '@/services/billing/clinic-schedule.service';

export const GET = withAuth(async (req: NextRequest, ctx) => kcHandle(async () => {
  const { actor } = ctx as any;
  assertCan(actor, 'schedule_read');
  const kc = await resolveKcActor(actor);
  const parsed = scheduleListQuerySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!parsed.success) return kcFail('Invalid query', 400);
  return kcOk(await listSchedules(parsed.data as any, scheduleScopeFor(kc)), 'Clinic schedules retrieved successfully');
}));

export const POST = withAuth(async (req: NextRequest, ctx) => kcHandle(async () => {
  const { actor } = ctx as any;
  assertCan(actor, 'schedule_manage');
  const kc = await resolveKcActor(actor);
  const parsed = scheduleCreateSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return kcFail('Invalid input', 400);
  return kcOk(await createSchedule(parsed.data as any, kc), 'Clinic schedule created successfully');
}));
