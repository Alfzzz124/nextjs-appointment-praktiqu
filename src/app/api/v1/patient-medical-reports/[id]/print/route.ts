/**
 * GET /api/v1/patient-medical-reports/:id/print
 *
 * The same bytes `/content` serves. The front-end fetches this as a blob and
 * hands it to the browser's print dialog.
 *
 * A report is an uploaded file, not a document we compose, so there is nothing
 * to render into a PDF here — `name`, `patient_id`, `date` and a media id are
 * the whole row, and the clinical content is the file itself. KiviCare Pro's own
 * controller reaches the same conclusion: its `printReport()` streams the upload.
 *
 * The row-scope check, the `Deny from all` upload directory, and the
 * inline-versus-attachment decision all live in `reportFileResponse`.
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
    if (err instanceof KcError) return kcFail(err.message, err.httpStatus);
    // eslint-disable-next-line no-console
    console.error('[report-print] failed', err);
    return kcFail('Could not read the document', 502);
  }
});
