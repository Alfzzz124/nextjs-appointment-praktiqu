/**
 * POST /api/v1/patient-medical-reports/:id/send-email
 *
 * Emails the uploaded document to the client, or — for staff — to an address of
 * their choosing. Deciding the recipient is this route's job: the service takes
 * one finished address, because only here is the caller's role known.
 *
 * Gated by `patient_report_manage`, which does not include CLIENT: a client
 * cannot email their own report, staff send it to them.
 */
import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth';
import { kcFail, kcHandle, kcOk } from '@/lib/kc-response';
import { assertCan } from '@/services/billing/kc-permissions';
import { resolveKcActor } from '@/services/billing/kc-actor';
import { medReportScopeFor } from '@/services/billing/med-report-scope';
import { getMedReport } from '@/services/billing/patient-medical-report.service';
import { emailMedReport } from '@/services/billing/report-email.service';
import { isSingleEmailAddress } from '@/lib/email';
import { findPatientById } from '@/repositories/wp/patients.repo';

export const runtime = 'nodejs';

export const POST = withAuth(async (req: NextRequest, ctx) =>
  kcHandle(async () => {
    const { actor, params } = ctx as any;
    assertCan(actor, 'patient_report_manage');
    const kc = await resolveKcActor(actor);
    const scope = medReportScopeFor(kc);

    // 404s before anything is sent if the row is outside the caller's scope.
    const report = await getMedReport(Number(params.id), scope);

    const body = await req.json().catch(() => ({}));

    // A CLIENT may not redirect their own clinical document to an address of
    // their choosing: that turns "read my own report" into a mail relay that
    // carries attachments. Unreachable today — `patient_report_manage` excludes
    // CLIENT — and kept so that adding CLIENT to that capability later does not
    // silently hand them the recipient field as well.
    const rawTo: unknown = actor.role === 'CLIENT' ? '' : (body?.to ?? '');

    // The mail provider accepts an array of recipients, so an unvalidated `to`
    // widens one redirect into a fan-out.
    if (rawTo !== '' && typeof rawTo !== 'string') return kcFail('to must be a string', 400);

    let to: string = rawTo as string;
    if (!to) {
      const patient = await findPatientById(BigInt(report.patient_id));
      to = patient?.email ?? '';
    }
    if (!to) return kcFail('No recipient email available for this report', 400);

    // A `typeof` check alone lets a comma- or semicolon-joined string through —
    // still one string, but multiple recipients once the mail provider parses
    // it. Applies to both an explicitly-supplied `to` and one resolved from the
    // client's own row: a malformed stored address is the same fan-out risk
    // arriving by a different route.
    if (!isSingleEmailAddress(to)) return kcFail('to must be a single email address', 400);

    await emailMedReport(Number(params.id), to, scope);
    return kcOk(true, 'Report sent successfully');
  }),
);
