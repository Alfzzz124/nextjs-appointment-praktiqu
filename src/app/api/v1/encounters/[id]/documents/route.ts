/**
 * GET /api/v1/encounters/:id/documents
 *
 * A separate endpoint rather than a field on the session-note DTO (design D5):
 * the note payload has only just settled after E3, and most reads of a note do not
 * want its attachments.
 */
import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth';
import { kcHandle, kcOk } from '@/lib/kc-response';
import { assertCan } from '@/services/billing/kc-permissions';
import { resolveKcActor } from '@/services/billing/kc-actor';
import { listEncounterDocuments } from '@/services/encounter-documents/service';

export const dynamic = 'force-dynamic';

const DEFAULT_PER_PAGE = 20;
const MAX_PER_PAGE = 100;

export const GET = withAuth(async (req: NextRequest, ctx) =>
  kcHandle(async () => {
    const { actor, params } = ctx as any;
    assertCan(actor, 'patient_report_read');
    const kc = await resolveKcActor(actor);

    const url = new URL(req.url);
    const page = Math.max(1, Number(url.searchParams.get('page') ?? 1) || 1);
    const requested = Number(url.searchParams.get('perPage') ?? DEFAULT_PER_PAGE) || DEFAULT_PER_PAGE;
    const perPage = Math.min(MAX_PER_PAGE, Math.max(1, requested));

    const data = await listEncounterDocuments(Number(params.id), kc, { page, perPage });
    return kcOk(data, 'Encounter documents retrieved successfully');
  }),
);
