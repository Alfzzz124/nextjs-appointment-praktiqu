import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth';
import { kcHandle, kcOk } from '@/lib/kc-response';
import { assertCan } from '@/services/billing/kc-permissions';
import { scheduleModule } from '@/services/billing/clinic-schedule.service';

export const GET = withAuth(async (_req: NextRequest, ctx) => kcHandle(async () => {
  const { actor } = ctx as any;
  assertCan(actor, 'schedule_read');
  return kcOk(scheduleModule(), 'Clinic schedule module config');
}));
