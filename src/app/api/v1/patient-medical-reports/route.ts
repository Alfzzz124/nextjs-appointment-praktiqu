import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth';
import { kcHandle, kcOk, kcFail } from '@/lib/kc-response';
import { assertCan } from '@/services/billing/kc-permissions';
import { resolveKcActor } from '@/services/billing/kc-actor';
import { medReportScopeFor } from '@/services/billing/med-report-scope';
import { medReportListQuerySchema, medReportCreateSchema } from '@/services/billing/validation';
import { listMedReports, createMedReport } from '@/services/billing/patient-medical-report.service';

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
  const kc = await resolveKcActor(actor);
  const parsed = medReportCreateSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return kcFail('Invalid input', 400);
  return kcOk(await createMedReport(parsed.data as any, kc), 'Medical report created successfully');
}));
