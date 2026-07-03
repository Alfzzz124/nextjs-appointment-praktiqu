import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth';
import { kcHandle, kcOk } from '@/lib/kc-response';
import { assertCan } from '@/services/billing/kc-permissions';
import { resolveKcActor } from '@/services/billing/kc-actor';
import { medReportScopeFor } from '@/services/billing/med-report-scope';
import { resolveReportFile } from '@/services/billing/patient-medical-report.service';

export const GET = withAuth(async (_req: NextRequest, ctx) => kcHandle(async () => {
  const { actor, params } = ctx as any;
  assertCan(actor, 'patient_report_read');
  const kc = await resolveKcActor(actor);
  return kcOk(await resolveReportFile(Number(params.id), medReportScopeFor(kc)), 'Report file resolved');
}));
