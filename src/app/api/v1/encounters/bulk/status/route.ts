import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth';
import { kcHandle, kcOk, kcFail } from '@/lib/kc-response';
import { assertCan } from '@/services/billing/kc-permissions';
import { resolveKcActor } from '@/services/billing/kc-actor';
import { idsStatusSchema } from '@/services/billing/validation';
import { bulkSetEncounterStatus, encounterScopeFor } from '@/services/billing/encounter.service';

export const POST = withAuth(async (req: NextRequest, ctx) =>
  kcHandle(async () => {
    const { actor } = ctx as any;
    assertCan(actor, 'encounter_manage');
    const kc = await resolveKcActor(actor);
    const parsed = idsStatusSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return kcFail('Invalid input', 400);
    const n = await bulkSetEncounterStatus(parsed.data.ids, parsed.data.status, encounterScopeFor(kc));
    return kcOk({ updated: n }, `${n} encounters status updated.`);
  }),
);
