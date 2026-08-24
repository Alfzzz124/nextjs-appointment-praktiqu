/**
 * GET /api/v1/patient-medical-reports/:id/content
 *
 * Streams the document's bytes. This exists because the URL WordPress reports for
 * these files cannot be opened: `uploads/kivicare-reports/` is `Deny from all`.
 *
 * Deliberately not a signed URL. For as long as such a URL lived it would be a
 * bearer token for a clinical document, and URLs end up in chat logs and access
 * logs. Every request is authorised here instead.
 */
import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { kcFail } from '@/lib/kc-response';
import { assertCan } from '@/services/billing/kc-permissions';
import { resolveKcActor } from '@/services/billing/kc-actor';
import { medReportScopeFor } from '@/services/billing/med-report-scope';
import { getMedReport } from '@/services/billing/patient-medical-report.service';
import { fetchMedia } from '@/lib/wp-endpoint';
import { KcError } from '@/lib/kc-response';
import { inlineDisposition } from '@/lib/http/content-disposition';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withAuth(async (_req: NextRequest, ctx) => {
  const { actor, params } = ctx as any;
  try {
    assertCan(actor, 'patient_report_read');
    const kc = await resolveKcActor(actor);

    // Scope + existence. Throws 404 when the document is outside the caller's rows.
    const report = await getMedReport(Number(params.id), medReportScopeFor(kc));

    const mediaId = Number.parseInt(String(report.upload_report), 10);
    if (!Number.isFinite(mediaId)) {
      return kcFail('Document has no file', 404);
    }

    const media = await fetchMedia(mediaId);

    const headers = new Headers({
      'Content-Type': media.contentType,
      'Content-Disposition': inlineDisposition(report.name ?? media.filename),
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    });
    if (media.contentLength !== null) {
      headers.set('Content-Length', String(media.contentLength));
    }

    return new NextResponse(media.body as any, { status: 200, headers });
  } catch (err) {
    if (err instanceof KcError) return kcFail(err.message, err.httpStatus);
    // The upstream message can name a filesystem path; it never reaches the client.
    // eslint-disable-next-line no-console
    console.error('[report-content] failed', err);
    return kcFail('Could not read the document', 502);
  }
});
