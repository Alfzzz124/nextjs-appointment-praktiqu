import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth';
import { kcHandle, kcOk, kcFail } from '@/lib/kc-response';
import { assertCan } from '@/services/billing/kc-permissions';
import { resolveKcActor } from '@/services/billing/kc-actor';
import { medReportScopeFor } from '@/services/billing/med-report-scope';
import { idsSchema } from '@/services/billing/validation';
import { bulkDeleteMedReports } from '@/services/billing/patient-medical-report.service';

export const POST = withAuth(async (req: NextRequest, ctx) => kcHandle(async () => {
  const { actor } = ctx as any;
  assertCan(actor, 'patient_report_manage');
  const kc = await resolveKcActor(actor);
  const parsed = idsSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return kcFail('Invalid input', 400);
  const n = await bulkDeleteMedReports(parsed.data.ids, medReportScopeFor(kc));
  return kcOk({ updated: n }, `${n} medical reports deleted.`);
}));
