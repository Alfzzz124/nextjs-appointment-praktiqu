import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth';
import { kcHandle, kcOk, kcFail } from '@/lib/kc-response';
import { assertCan } from '@/services/billing/kc-permissions';
import { resolveKcActor } from '@/services/billing/kc-actor';
import { leafScopeFor } from '@/services/billing/kc-leaf-scope';
import { prescriptionUpdateSchema } from '@/services/billing/validation';
import { getPrescription, updatePrescription, deletePrescription } from '@/services/billing/prescription.service';

export const GET = withAuth(async (_req: NextRequest, ctx) => kcHandle(async () => {
  const { actor, params } = ctx as any;
  assertCan(actor, 'prescription_read');
  const kc = await resolveKcActor(actor);
  return kcOk(await getPrescription(Number(params.id), leafScopeFor(kc)), 'Prescription retrieved successfully');
}));

export const PUT = withAuth(async (req: NextRequest, ctx) => kcHandle(async () => {
  const { actor, params } = ctx as any;
  assertCan(actor, 'prescription_manage');
  const kc = await resolveKcActor(actor);
  const parsed = prescriptionUpdateSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return kcFail('Invalid input', 400);
  await updatePrescription(Number(params.id), parsed.data, leafScopeFor(kc));
  return kcOk(null, 'Prescription updated successfully');
}));

export const DELETE = withAuth(async (_req: NextRequest, ctx) => kcHandle(async () => {
  const { actor, params } = ctx as any;
  assertCan(actor, 'prescription_manage');
  const kc = await resolveKcActor(actor);
  await deletePrescription(Number(params.id), leafScopeFor(kc));
  return kcOk(null, 'Prescription deleted successfully');
}));
