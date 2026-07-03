import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth';
import { kcHandle, kcOk, kcFail } from '@/lib/kc-response';
import { assertCan } from '@/services/billing/kc-permissions';
import { resolveKcActor } from '@/services/billing/kc-actor';
import { receptionistScopeFor } from '@/services/billing/staff-scope';
import { receptionistListQuerySchema } from '@/services/billing/validation';
import { exportReceptionists } from '@/services/billing/receptionist.service';

export const GET = withAuth(async (req: NextRequest, ctx) => kcHandle(async () => {
  const { actor } = ctx as any;
  assertCan(actor, 'receptionist_read');
  const kc = await resolveKcActor(actor);
  const parsed = receptionistListQuerySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!parsed.success) return kcFail('Invalid query', 400);
  return kcOk(await exportReceptionists(parsed.data as any, receptionistScopeFor(kc)), 'Receptionists data retrieved successfully');
}));
