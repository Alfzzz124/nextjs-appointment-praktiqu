import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth';
import { kcHandle, kcOk, kcFail } from '@/lib/kc-response';
import { assertCan } from '@/services/billing/kc-permissions';
import { resolveKcActor } from '@/services/billing/kc-actor';
import { leafScopeFor } from '@/services/billing/kc-leaf-scope';
import { medicalHistoryListQuerySchema, medicalHistoryCreateSchema } from '@/services/billing/validation';
import { listMedicalHistory, createMedicalHistory } from '@/services/billing/medical-history.service';

export const GET = withAuth(async (req: NextRequest, ctx) => kcHandle(async () => {
  const { actor } = ctx as any;
  assertCan(actor, 'medical_history_read');
  const kc = await resolveKcActor(actor);
  const parsed = medicalHistoryListQuerySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!parsed.success) return kcFail('Invalid query', 400);
  return kcOk(await listMedicalHistory(parsed.data as any, leafScopeFor(kc)), 'Medical history retrieved successfully');
}));

export const POST = withAuth(async (req: NextRequest, ctx) => kcHandle(async () => {
  const { actor } = ctx as any;
  assertCan(actor, 'medical_history_manage');
  const kc = await resolveKcActor(actor);
  const parsed = medicalHistoryCreateSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return kcFail('Invalid input', 400);
  return kcOk(await createMedicalHistory(parsed.data as any, kc), 'Medical history created successfully');
}));
