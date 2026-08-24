import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth';
import { kcFail, kcHandle, kcOk } from '@/lib/kc-response';
import { assertCan } from '@/services/billing/kc-permissions';
import { resolveKcActor } from '@/services/billing/kc-actor';
import { medReportScopeFor } from '@/services/billing/med-report-scope';
import { getMedReport, deleteMedReport, renameMedReport } from '@/services/billing/patient-medical-report.service';

export const GET = withAuth(async (_req: NextRequest, ctx) => kcHandle(async () => {
  const { actor, params } = ctx as any;
  assertCan(actor, 'patient_report_read');
  const kc = await resolveKcActor(actor);
  return kcOk(await getMedReport(Number(params.id), medReportScopeFor(kc)), 'Medical report retrieved successfully');
}));

export const DELETE = withAuth(async (_req: NextRequest, ctx) => kcHandle(async () => {
  const { actor, params } = ctx as any;
  assertCan(actor, 'patient_report_manage');
  const kc = await resolveKcActor(actor);
  await deleteMedReport(Number(params.id), medReportScopeFor(kc));
  return kcOk(null, 'Medical report deleted successfully');
}));

export const PATCH = withAuth(async (req: NextRequest, ctx) => kcHandle(async () => {
  const { actor, params } = ctx as any;
  assertCan(actor, 'patient_report_manage');
  const kc = await resolveKcActor(actor);

  const body = await req.json().catch(() => ({}));
  const name = typeof body?.name === 'string' ? body.name : '';
  if (name.trim() === '') return kcFail('Name is required', 400);

  const data = await renameMedReport(Number(params.id), name, medReportScopeFor(kc));
  return kcOk(data, 'Medical report renamed successfully');
}));
