/**
 * GET /api/v1/patient-medical-reports/:id/content
 *
 * Streams the document's bytes. This exists because the URL WordPress reports for
 * these files cannot be opened: `uploads/kivicare-reports/` is `Deny from all`.
 *
 * Deliberately not a signed URL. For as long as such a URL lived it would be a
 * bearer token for a clinical document, and URLs end up in chat logs and access
 * logs. Every request is authorised here instead.
 *
 * The streaming itself lives in `reportFileResponse`, shared with `/print`.
 */
import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth';
import { KcError, kcFail } from '@/lib/kc-response';
import { assertCan } from '@/services/billing/kc-permissions';
import { resolveKcActor } from '@/services/billing/kc-actor';
import { medReportScopeFor } from '@/services/billing/med-report-scope';
import { reportFileResponse } from '@/services/billing/report-file';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withAuth(async (_req: NextRequest, ctx) => {
  const { actor, params } = ctx as any;
  try {
    assertCan(actor, 'patient_report_read');
    const kc = await resolveKcActor(actor);
    return await reportFileResponse(Number(params.id), medReportScopeFor(kc));
  } catch (err) {
    // `assertCan` and `resolveKcActor` throw KcError (403); everything past them
    // is already handled inside the helper.
    if (err instanceof KcError) return kcFail(err.message, err.httpStatus);
    // eslint-disable-next-line no-console
    console.error('[report-content] failed', err);
    return kcFail('Could not read the document', 502);
  }
});
