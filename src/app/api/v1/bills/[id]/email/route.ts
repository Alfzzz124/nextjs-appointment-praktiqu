import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth';
import { kcOk, kcHandle, kcFail } from '@/lib/kc-response';
import { assertCan, assertBillingEnabled, billScopeFor } from '@/services/billing/kc-permissions';
import { resolveKcActor } from '@/services/billing/kc-actor';
import { emailBill } from '@/services/billing/bill-document.service';
import { getBill } from '@/services/billing/bill.service';
import { findPatientById } from '@/repositories/wp/patients.repo';

export const runtime = 'nodejs';

export const POST = withAuth(async (req: NextRequest, ctx) =>
  kcHandle(async () => {
    const { actor, params } = ctx as any;
    await assertBillingEnabled();
    assertCan(actor, 'patient_bill_view');
    const kc = await resolveKcActor(actor);
    const scope = billScopeFor(kc);
    const bill = await getBill(Number(params.id), scope); // 404s before anything is sent if out of scope
    const body = await req.json().catch(() => ({}));
    // A CLIENT may not redirect their own invoice to an arbitrary address — that is
    // an open mail-relay primitive, not a feature, once every bill in scope was
    // reachable by id. Staff roles (who already see the recipient's real address in
    // the UI) keep the override for legitimate resends (e.g. to an accountant).
    const rawTo: unknown = actor.role === 'CLIENT' ? '' : (body?.to ?? '');
    // The mail provider accepts an array of recipients, so an unvalidated `to` widens
    // "resend to one address of the staff caller's choosing" into "fan this invoice
    // out to an arbitrary list" — not what this override is meant to allow.
    if (rawTo !== '' && typeof rawTo !== 'string') return kcFail('to must be a string', 400);
    let to: string = rawTo as string;
    if (!to) {
      // `BillDetail.patient` carries only the wp_users id (getBill never joins the
      // profile) — resolve the real address the same way every other patient read in
      // this codebase does, straight from wp_users. This is also the CLIENT's own
      // fallback path: assertBillScope already forced bill.patient.id === the CLIENT's
      // own wpUserId, so a patient looked up here is always the requester themself.
      const patient = await findPatientById(BigInt(bill.patient.id));
      to = patient?.email ?? '';
    }
    if (!to) return kcFail('No recipient email available for this bill', 400);
    await emailBill(Number(params.id), to, scope);
    return kcOk(true, 'Bill sent successfully');
  }),
);
