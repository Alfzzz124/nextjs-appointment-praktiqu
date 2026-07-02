import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth';
import { kcHandle, kcOk, kcFail } from '@/lib/kc-response';
import { assertCan } from '@/services/billing/kc-permissions';
import { resolveKcActor } from '@/services/billing/kc-actor';
import { leafScopeFor } from '@/services/billing/kc-leaf-scope';
import { prescriptionListQuerySchema, prescriptionCreateSchema } from '@/services/billing/validation';
import { listPrescriptions, createPrescription } from '@/services/billing/prescription.service';

export const GET = withAuth(async (req: NextRequest, ctx) => kcHandle(async () => {
  const { actor } = ctx as any;
  assertCan(actor, 'prescription_read');
  const kc = await resolveKcActor(actor);
  const parsed = prescriptionListQuerySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!parsed.success) return kcFail('Invalid query', 400);
  return kcOk(await listPrescriptions(parsed.data as any, leafScopeFor(kc)), 'Prescriptions retrieved successfully');
}));

export const POST = withAuth(async (req: NextRequest, ctx) => kcHandle(async () => {
  const { actor } = ctx as any;
  assertCan(actor, 'prescription_manage');
  const kc = await resolveKcActor(actor);
  const parsed = prescriptionCreateSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return kcFail('Invalid input', 400);
  return kcOk(await createPrescription(parsed.data as any, kc), 'Prescription created successfully');
}));
