/**
 * Stream a client's uploaded report document.
 *
 * Two routes hand back the same bytes. `/content` is the view-or-download link,
 * and `/print` is what the front-end fetches as a blob before opening the print
 * dialog. They are one operation published under two names, so the policy lives
 * here once instead of being copied and then drifting apart.
 *
 * This deliberately departs from KiviCare Pro's own `printReport()`
 * (`Wordpress-Plugin/kivicare-pro/app/controllers/api/KCProPatientMedicalReportController.php:716`),
 * which sets `Content-Disposition: inline` for every type it serves. An uploaded
 * `.html` or `.svg` served inline runs as script on this origin, where the
 * signed-in session lives, so `contentDispositionFor` downgrades everything
 * outside the five types `validateUpload` sniffs to `attachment`. A clinician can
 * still download a legitimate `.docx`; it just will not render in the page.
 */
import { NextResponse } from 'next/server';
import { KcError, kcFail } from '@/lib/kc-response';
import { getMedReport } from '@/services/billing/patient-medical-report.service';
import type { MedReportScope } from '@/services/billing/med-report-scope';
import { fetchMedia } from '@/lib/wp-endpoint';
import { contentDispositionFor } from '@/lib/http/content-disposition';

export async function reportFileResponse(
  id: number,
  scope: MedReportScope | null,
): Promise<NextResponse> {
  try {
    // Scope + existence. Throws 404 when the document is outside the caller's rows.
    const report = await getMedReport(id, scope);

    const mediaId = Number.parseInt(String(report.upload_report), 10);
    if (!Number.isFinite(mediaId)) {
      return kcFail('Document has no file', 404);
    }

    const media = await fetchMedia(mediaId);

    const headers = new Headers({
      'Content-Type': media.contentType,
      'Content-Disposition': contentDispositionFor(media.contentType, report.name ?? media.filename),
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
    console.error('[report-file] failed', err);
    return kcFail('Could not read the document', 502);
  }
}
