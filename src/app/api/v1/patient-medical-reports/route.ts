import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth';
import { kcHandle, kcOk, kcFail } from '@/lib/kc-response';
import { assertCan } from '@/services/billing/kc-permissions';
import { resolveKcActor } from '@/services/billing/kc-actor';
import { medReportScopeFor } from '@/services/billing/med-report-scope';
import { medReportListQuerySchema, medReportCreateSchema } from '@/services/billing/validation';
import { listMedReports } from '@/services/billing/patient-medical-report.service';

export const GET = withAuth(async (req: NextRequest, ctx) => kcHandle(async () => {
  const { actor } = ctx as any;
  assertCan(actor, 'patient_report_read');
  const kc = await resolveKcActor(actor);
  const parsed = medReportListQuerySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!parsed.success) return kcFail('Invalid query', 400);
  return kcOk(await listMedReports(parsed.data as any, medReportScopeFor(kc)), 'Medical reports retrieved successfully');
}));

export const POST = withAuth(async (req: NextRequest, ctx) => kcHandle(async () => {
  const { actor } = ctx as any;
  assertCan(actor, 'patient_report_manage');
  const parsed = medReportCreateSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return kcFail('Invalid input', 400);
  // `medReportCreateSchema` no longer carries a media-id field (see the C1
  // finding in the pre-merge review of feat/encounter-documents): a media id
  // read out of this request body has no verified relationship to
  // `patientId`, and accepting one let a caller mint a report row over any
  // other clinic's uploaded file, then read its bytes via
  // `GET /patient-medical-reports/{id}/content`. `createMedReport` now
  // requires a `verifiedMediaId` that only a caller who performed the upload
  // itself can supply — this route does not upload anything, so it has no
  // such id to give it. The one place that does is
  // `POST /api/v1/encounters/{id}/documents` (multipart), which is the
  // front-end's only document-creation path per the API guide.
  //
  // Left responding 501 rather than either crashing on a missing required
  // field or quietly creating a fileless row. Whether this route should be
  // retired outright is the API owner's call, not made here.
  return kcFail(
    'Creating a report requires uploading its file first. Use POST /api/v1/encounters/{id}/documents.',
    501,
  );
}));
