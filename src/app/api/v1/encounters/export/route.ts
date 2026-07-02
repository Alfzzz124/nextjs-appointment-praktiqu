import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth';
import { kcHandle, kcOk, kcFail } from '@/lib/kc-response';
import { assertCan } from '@/services/billing/kc-permissions';
import { resolveKcActor } from '@/services/billing/kc-actor';
import { encounterListQuerySchema } from '@/services/billing/validation';
import { exportEncounters, encounterScopeFor } from '@/services/billing/encounter.service';

export const GET = withAuth(async (req: NextRequest, ctx) =>
  kcHandle(async () => {
    const { actor } = ctx as any;
    assertCan(actor, 'encounter_read');
    const kc = await resolveKcActor(actor);
    const parsed = encounterListQuerySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
    if (!parsed.success) return kcFail('Invalid query', 400);
    const data = await exportEncounters(parsed.data as any, encounterScopeFor(kc));
    return kcOk(data, 'Encounters data retrieved successfully');
  }),
);
