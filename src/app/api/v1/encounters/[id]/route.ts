import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth';
import { kcHandle, kcOk, kcFail } from '@/lib/kc-response';
import { assertCan } from '@/services/billing/kc-permissions';
import { resolveKcActor } from '@/services/billing/kc-actor';
import { encounterUpdateSchema } from '@/services/billing/validation';
import { getEncounter, updateEncounter, deleteEncounter, encounterScopeFor } from '@/services/billing/encounter.service';

export const GET = withAuth(async (_req: NextRequest, ctx) =>
  kcHandle(async () => {
    const { actor, params } = ctx as any;
    assertCan(actor, 'encounter_read');
    const kc = await resolveKcActor(actor);
    const data = await getEncounter(Number(params.id), encounterScopeFor(kc));
    return kcOk(data, 'Encounter retrieved successfully');
  }),
);

export const PUT = withAuth(async (req: NextRequest, ctx) =>
  kcHandle(async () => {
    const { actor, params } = ctx as any;
    assertCan(actor, 'encounter_manage');
    const kc = await resolveKcActor(actor);
    const parsed = encounterUpdateSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return kcFail('Invalid input', 400);
    await updateEncounter(Number(params.id), parsed.data, encounterScopeFor(kc));
    return kcOk(null, 'Encounter updated successfully');
  }),
);

export const DELETE = withAuth(async (_req: NextRequest, ctx) =>
  kcHandle(async () => {
    const { actor, params } = ctx as any;
    assertCan(actor, 'encounter_manage');
    const kc = await resolveKcActor(actor);
    await deleteEncounter(Number(params.id), encounterScopeFor(kc));
    return kcOk(null, 'Encounter deleted successfully');
  }),
);
