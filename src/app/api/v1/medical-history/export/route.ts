import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth';
import { kcHandle, kcOk, kcFail } from '@/lib/kc-response';
import { assertCan } from '@/services/billing/kc-permissions';
import { resolveKcActor } from '@/services/billing/kc-actor';
import { leafScopeFor } from '@/services/billing/kc-leaf-scope';
import { medicalHistoryListQuerySchema } from '@/services/billing/validation';
import { exportMedicalHistory } from '@/services/billing/medical-history.service';

export const GET = withAuth(async (req: NextRequest, ctx) => kcHandle(async () => {
  const { actor } = ctx as any;
  assertCan(actor, 'medical_history_read');
  const kc = await resolveKcActor(actor);
  const parsed = medicalHistoryListQuerySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!parsed.success) return kcFail('Invalid query', 400);
  return kcOk(await exportMedicalHistory(parsed.data as any, leafScopeFor(kc)), 'Medical history data retrieved successfully');
}));
