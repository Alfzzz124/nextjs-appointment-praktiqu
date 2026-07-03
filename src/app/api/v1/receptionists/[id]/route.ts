import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth';
import { kcHandle, kcOk, kcFail } from '@/lib/kc-response';
import { assertCan } from '@/services/billing/kc-permissions';
import { resolveKcActor } from '@/services/billing/kc-actor';
import { receptionistScopeFor } from '@/services/billing/staff-scope';
import { receptionistUpdateSchema } from '@/services/billing/validation';
import { getReceptionist, updateReceptionist, deleteReceptionist } from '@/services/billing/receptionist.service';

export const GET = withAuth(async (_req: NextRequest, ctx) => kcHandle(async () => {
  const { actor, params } = ctx as any;
  assertCan(actor, 'receptionist_read');
  const kc = await resolveKcActor(actor);
  return kcOk(await getReceptionist(Number(params.id), receptionistScopeFor(kc)), 'Receptionist retrieved successfully');
}));

export const PUT = withAuth(async (req: NextRequest, ctx) => kcHandle(async () => {
  const { actor, params } = ctx as any;
  assertCan(actor, 'receptionist_manage');
  const kc = await resolveKcActor(actor);
  const parsed = receptionistUpdateSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return kcFail('Invalid input', 400);
  await updateReceptionist(Number(params.id), parsed.data, receptionistScopeFor(kc));
  return kcOk(null, 'Receptionist updated successfully');
}));

export const DELETE = withAuth(async (_req: NextRequest, ctx) => kcHandle(async () => {
  const { actor, params } = ctx as any;
  assertCan(actor, 'receptionist_manage');
  const kc = await resolveKcActor(actor);
  await deleteReceptionist(Number(params.id), receptionistScopeFor(kc));
  return kcOk(null, 'Receptionist deleted successfully');
}));
