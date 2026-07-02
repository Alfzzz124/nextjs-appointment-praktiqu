import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { kcFail, KcError } from '@/lib/kc-response';
import { assertCan } from '@/services/billing/kc-permissions';
import { resolveKcActor } from '@/services/billing/kc-actor';
import { getEncounter, encounterScopeFor } from '@/services/billing/encounter.service';
import { renderEncounterHtml } from '@/services/billing/encounter-document.service';

export const GET = withAuth(async (_req: NextRequest, ctx) => {
  const { actor, params } = ctx as any;
  try {
    assertCan(actor, 'encounter_read');
    const kc = await resolveKcActor(actor);
    const encounter = await getEncounter(Number(params.id), encounterScopeFor(kc));
    const html = renderEncounterHtml(encounter as any);
    return new NextResponse(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Disposition': `inline; filename="encounter_${params.id}.html"`,
      },
    });
  } catch (err) {
    if (err instanceof KcError) return kcFail(err.message, err.httpStatus);
    console.error('[kc] encounter print failed', err);
    return kcFail('Failed to render encounter', 500);
  }
});
