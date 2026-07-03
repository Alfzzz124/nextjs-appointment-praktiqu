import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth';
import { kcHandle, kcOk, kcFail } from '@/lib/kc-response';
import { assertCan } from '@/services/billing/kc-permissions';
import { resolveKcActor } from '@/services/billing/kc-actor';
import { leafScopeFor } from '@/services/billing/kc-leaf-scope';
import { medicalHistoryUpdateSchema } from '@/services/billing/validation';
import { getMedicalHistory, updateMedicalHistory, deleteMedicalHistory } from '@/services/billing/medical-history.service';

export const GET = withAuth(async (_req: NextRequest, ctx) => kcHandle(async () => {
  const { actor, params } = ctx as any;
  assertCan(actor, 'medical_history_read');
  const kc = await resolveKcActor(actor);
  return kcOk(await getMedicalHistory(Number(params.id), leafScopeFor(kc)), 'Medical history retrieved successfully');
}));

export const PUT = withAuth(async (req: NextRequest, ctx) => kcHandle(async () => {
  const { actor, params } = ctx as any;
  assertCan(actor, 'medical_history_manage');
  const kc = await resolveKcActor(actor);
  const parsed = medicalHistoryUpdateSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return kcFail('Invalid input', 400);
  await updateMedicalHistory(Number(params.id), parsed.data, leafScopeFor(kc));
  return kcOk(null, 'Medical history updated successfully');
}));

export const DELETE = withAuth(async (_req: NextRequest, ctx) => kcHandle(async () => {
  const { actor, params } = ctx as any;
  assertCan(actor, 'medical_history_manage');
  const kc = await resolveKcActor(actor);
  await deleteMedicalHistory(Number(params.id), leafScopeFor(kc));
  return kcOk(null, 'Medical history deleted successfully');
}));
