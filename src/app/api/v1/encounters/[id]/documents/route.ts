/**
 * GET /api/v1/encounters/:id/documents
 *
 * A separate endpoint rather than a field on the session-note DTO (design D5):
 * the note payload has only just settled after E3, and most reads of a note do not
 * want its attachments.
 */
import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth';
import { kcHandle, kcOk, kcFail } from '@/lib/kc-response';
import { assertCan } from '@/services/billing/kc-permissions';
import { resolveKcActor } from '@/services/billing/kc-actor';
import { listEncounterDocuments, uploadEncounterDocument } from '@/services/encounter-documents/service';
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_MB } from '@/services/uploads/validate-upload';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const DEFAULT_PER_PAGE = 20;
const MAX_PER_PAGE = 100;

/**
 * Parse a `page`/`perPage` query param into `[1, max]`.
 *
 * A missing param, or one that doesn't parse to a finite number, falls back to
 * `fallback`. Anything else — including `0` or a negative number — is a real,
 * finite value and gets clamped into range rather than defaulted: `Number(...) ||
 * fallback` used to treat `0` as falsy and silently hand back the default, so a
 * caller asking for zero rows got the full default page instead.
 */
function clampNumericParam(raw: string | null, fallback: number, max = Infinity): number {
  if (raw === null) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(1, parsed));
}

export const GET = withAuth(async (req: NextRequest, ctx) =>
  kcHandle(async () => {
    const { actor, params } = ctx as any;
    assertCan(actor, 'patient_report_read');
    const kc = await resolveKcActor(actor);

    const url = new URL(req.url);
    const page = clampNumericParam(url.searchParams.get('page'), 1);
    const perPage = clampNumericParam(url.searchParams.get('perPage'), DEFAULT_PER_PAGE, MAX_PER_PAGE);

    const data = await listEncounterDocuments(Number(params.id), kc, { page, perPage });
    return kcOk(data, 'Encounter documents retrieved successfully');
  }),
);

export const POST = withAuth(async (req: NextRequest, ctx) =>
  kcHandle(async () => {
    const { actor, params } = ctx as any;
    assertCan(actor, 'patient_report_manage');
    const kc = await resolveKcActor(actor);

    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return kcFail('Expected multipart/form-data', 400);
    }

    const part = form.get('file');
    if (typeof part === 'string' || part === null) {
      return kcFail('No file provided', 400);
    }
    // Check the declared size before buffering, so an oversized upload never
    // reaches the heap.
    if (part.size > MAX_UPLOAD_BYTES) {
      return kcFail(`File exceeds the ${MAX_UPLOAD_MB} MB limit`, 422);
    }

    const bytes = new Uint8Array(await part.arrayBuffer());
    const name = String(form.get('name') ?? '').trim();

    const result = await uploadEncounterDocument(
      Number(params.id),
      { filename: part.name, bytes, name },
      kc,
    );

    return kcOk(result, result.linked
      ? 'Document uploaded successfully'
      : 'Document uploaded, but could not be linked to this encounter');
  }),
);
