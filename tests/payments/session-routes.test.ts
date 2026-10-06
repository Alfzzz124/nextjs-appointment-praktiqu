import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

// Only the clinic-scope block below reaches these: it runs the REAL ensureSessionPayment
// (and through it the real getBill / resolveKcActor) against canned rows, so its 404 comes
// from the actual scope check rather than a stubbed rejection. Every other block stubs the
// service whole and never touches the database or WooCommerce.
const db = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  kcDoctorClinicMapping: { findFirst: vi.fn() },
  kcReceptionistClinicMapping: { findFirst: vi.fn() },
  kcClinic: { findFirst: vi.fn() },
  kcBill: { findUnique: vi.fn() },
  kcPatientEncounter: { findUnique: vi.fn() },
  kcBillItem: { findMany: vi.fn() },
  kcService: { findMany: vi.fn() },
  kcTaxData: { findMany: vi.fn() },
  kcUser: { findUnique: vi.fn() },
  paymentOrder: { findFirst: vi.fn(), create: vi.fn() },
}));
vi.mock('@/lib/db', () => ({ prisma: db }));

const wpEndpoint = vi.hoisted(() => ({ createWcOrder: vi.fn(), getWcOrderStatus: vi.fn() }));
vi.mock('@/lib/wp-endpoint', () => wpEndpoint);

const jobsClient = vi.hoisted(() => ({ jobs: { enqueue: vi.fn(), cancel: vi.fn() } }));
vi.mock('@/lib/jobs/client', () => jobsClient);

vi.mock('@/services/payments/payment.service', () => ({
  ensureSessionPayment: vi.fn(),
  checkSessionPaymentStatus: vi.fn(),
  verifyPaymentWebhookSignature: vi.fn(),
  getPaymentOrderByWcOrderId: vi.fn(),
  markPaid: vi.fn(),
  markFailed: vi.fn(),
  markExpired: vi.fn(),
  applyPaidSideEffectsPublic: vi.fn(),
  applyPaidSideEffectsSession: vi.fn(),
  cancelIfStillPending: vi.fn(),
  AmountMismatchError: class AmountMismatchError extends Error {},
  UnknownOrderError: class UnknownOrderError extends Error {},
}));
vi.mock('@/lib/auth/route-guards', () => ({
  requireRoles: vi.fn(async () => ({ actor: { id: 'u1', role: 'RECEPTIONIST', practiceId: 'p1' } })),
}));
vi.mock('@/lib/kc-response', () => ({
  KcError: class KcError extends Error { constructor(message: string, public httpStatus = 400) { super(message); } },
}));

import { POST as paymentVerify } from '@/app/api/v1/sessions/payment-verify/route';
import { POST as webhook } from '@/app/api/v1/sessions/payment-webhook/route';
import { POST as success } from '@/app/api/v1/sessions/payment-success/route';
import { POST as cancelRoute } from '@/app/api/v1/sessions/payment-cancel/route';
import * as svc from '@/services/payments/payment.service';
import { requireRoles } from '@/lib/auth/route-guards';

function req(body: unknown) {
  return new NextRequest('http://x/api/v1/sessions/payment-verify', { method: 'POST', body: JSON.stringify(body) });
}

beforeEach(() => vi.clearAllMocks());

/** Link the stub receptionist 'u1' to clinic 3, so the route can resolve its bill scope. */
function linkReceptionist() {
  db.user.findUnique.mockResolvedValue({ wpUserId: 501n });
  db.kcReceptionistClinicMapping.findFirst.mockResolvedValue({ clinicId: 3n });
}

describe('POST /sessions/payment-verify', () => {
  beforeEach(linkReceptionist);

  it('401 when unauthenticated', async () => {
    (requireRoles as any).mockResolvedValue({ response: new Response(null, { status: 401 }) });
    const res: any = await paymentVerify(req({ billId: '1' }));
    expect(res.status).toBe(401);
  });

  it('400 on missing billId', async () => {
    (requireRoles as any).mockResolvedValue({ actor: { id: 'u1', role: 'RECEPTIONIST', practiceId: 'p1' } });
    const res = await paymentVerify(req({}));
    expect(res.status).toBe(400);
  });

  it('200 with a checkout link on success', async () => {
    (requireRoles as any).mockResolvedValue({ actor: { id: 'u1', role: 'RECEPTIONIST', practiceId: 'p1' } });
    (svc.ensureSessionPayment as any).mockResolvedValue({ checkoutUrl: 'https://wp/checkout/9', status: 'pending', expectedAmount: 50000 });
    const res = await paymentVerify(req({ billId: '9' }));
    expect(res.status).toBe(200);
    expect((await res.json()).data.checkoutUrl).toBe('https://wp/checkout/9');
  });
});

describe('POST /sessions/payment-verify — method', () => {
  const staff = { actor: { id: 'u1', role: 'RECEPTIONIST', practiceId: 'p1' } };

  beforeEach(linkReceptionist);

  it('defaults to xendit when the body omits a method', async () => {
    (requireRoles as any).mockResolvedValue(staff);
    (svc.ensureSessionPayment as any).mockResolvedValue({
      checkoutUrl: 'https://wp/checkout/9', status: 'pending',
      expectedAmount: 200000, chargedAmount: 200000, chargedCurrency: 'IDR',
    });
    await paymentVerify(req({ billId: '9' }));
    expect(svc.ensureSessionPayment).toHaveBeenCalledWith('9', 'xendit', { clinicId: 3n });
  });

  it('forwards paypal and returns the charged figures', async () => {
    (requireRoles as any).mockResolvedValue(staff);
    (svc.ensureSessionPayment as any).mockResolvedValue({
      checkoutUrl: 'https://paypal.com/checkout/abc', status: 'pending',
      expectedAmount: 200000, chargedAmount: 11.12, chargedCurrency: 'USD',
    });
    const res = await paymentVerify(req({ billId: '9', method: 'paypal' }));
    expect(svc.ensureSessionPayment).toHaveBeenCalledWith('9', 'paypal', { clinicId: 3n });
    const body = await res.json();
    expect(body.data.chargedAmount).toBe(11.12);
    expect(body.data.chargedCurrency).toBe('USD');
  });

  it('400 on an unknown method, without calling the service', async () => {
    (requireRoles as any).mockResolvedValue(staff);
    const res = await paymentVerify(req({ billId: '9', method: 'gopay' }));
    expect(res.status).toBe(400);
    expect(svc.ensureSessionPayment).not.toHaveBeenCalled();
  });
});

/**
 * The route used to gate on role alone and hand the bill id straight to an unscoped
 * getBill, so any clinic's staff could open a WooCommerce order against another
 * clinic's bill. Scope now follows the bill routes (resolveKcActor → billScopeFor):
 * clinic admins and receptionists see their clinic's bills, professionals their own
 * encounters' bills, super admins everything. Out of scope is a 404, never a 403.
 */
describe('POST /sessions/payment-verify — clinic scope', () => {
  const CLINIC_A = 3n, CLINIC_B = 4n;
  const BILL_A = '101', BILL_B = '202';
  const staffOfClinicA = [
    { id: 'recep-a', role: 'RECEPTIONIST', practiceId: null },
    { id: 'admin-a', role: 'CLINIC_ADMIN', practiceId: null },
    { id: 'doc-a', role: 'PROFESSIONAL', practiceId: null },
  ];

  function billRow(id: bigint, clinicId: bigint, encounterId: bigint) {
    return {
      id, clinicId, encounterId, appointmentId: null, discount: '0',
      totalAmount: '150000', actualAmount: '150000', paymentStatus: 'unpaid', createdAt: new Date(),
    };
  }

  beforeEach(async () => {
    const actual = await vi.importActual<typeof import('@/services/payments/payment.service')>('@/services/payments/payment.service');
    vi.mocked(svc.ensureSessionPayment).mockImplementation(actual.ensureSessionPayment);

    // Clinic A staff. The super admin ('super') deliberately has no WordPress link.
    const wpUserIds: Record<string, bigint> = { 'recep-a': 501n, 'admin-a': 502n, 'doc-a': 601n };
    db.user.findUnique.mockImplementation(async ({ where }: any) => (wpUserIds[where.id] ? { wpUserId: wpUserIds[where.id] } : null));
    db.kcReceptionistClinicMapping.findFirst.mockImplementation(async ({ where }: any) => (where.receptionistId === 501n ? { clinicId: CLINIC_A } : null));
    db.kcDoctorClinicMapping.findFirst.mockImplementation(async ({ where }: any) => (where.doctorId === 601n ? { clinicId: CLINIC_A } : null));
    db.kcClinic.findFirst.mockImplementation(async ({ where }: any) => (where.clinicAdminId === 502n ? { id: CLINIC_A } : null));

    const bills: Record<string, unknown> = { [BILL_A]: billRow(101n, CLINIC_A, 1001n), [BILL_B]: billRow(202n, CLINIC_B, 2002n) };
    const encounters: Record<string, unknown> = {
      '1001': { doctorId: 601n, patientId: 701n },
      '2002': { doctorId: 602n, patientId: 702n },
    };
    db.kcBill.findUnique.mockImplementation(async ({ where }: any) => bills[String(where.id)] ?? null);
    db.kcPatientEncounter.findUnique.mockImplementation(async ({ where }: any) => encounters[String(where.id)] ?? null);
    db.kcBillItem.findMany.mockResolvedValue([]);
    db.kcService.findMany.mockResolvedValue([]);
    db.kcTaxData.findMany.mockResolvedValue([]);
    db.kcUser.findUnique.mockResolvedValue({ displayName: 'Jane Doe', userEmail: 'jane@x.com' });
    db.paymentOrder.findFirst.mockResolvedValue(null);
    db.paymentOrder.create.mockImplementation(async ({ data }: any) => data);
    wpEndpoint.createWcOrder.mockResolvedValue({
      orderId: 777, checkoutUrl: 'https://wp/checkout/777', chargedAmount: null, chargedCurrency: 'IDR', fxRate: null,
    });
    jobsClient.jobs.enqueue.mockResolvedValue(undefined);
  });

  afterEach(() => vi.mocked(svc.ensureSessionPayment).mockReset());

  it.each(staffOfClinicA)('$role of the bill\'s clinic gets a checkout link', async (actor) => {
    (requireRoles as any).mockResolvedValue({ actor });
    const res = await paymentVerify(req({ billId: BILL_A }));
    expect(res.status).toBe(200);
    expect((await res.json()).data.checkoutUrl).toBe('https://wp/checkout/777');
  });

  it.each(staffOfClinicA)('$role of another clinic gets 404 and no order is opened', async (actor) => {
    (requireRoles as any).mockResolvedValue({ actor });
    const res = await paymentVerify(req({ billId: BILL_B }));
    expect(res.status).toBe(404);
    expect(wpEndpoint.createWcOrder).not.toHaveBeenCalled();
    expect(db.paymentOrder.create).not.toHaveBeenCalled();
  });

  it('another clinic\'s existing order is not disclosed either', async () => {
    // A live order short-circuits before any bill is loaded and answers with its status
    // and amount, so a check placed only on the create path would still leak both.
    (requireRoles as any).mockResolvedValue({ actor: staffOfClinicA[0] });
    db.paymentOrder.findFirst.mockResolvedValue({
      wcOrderId: 9, billId: BILL_B, status: 'pending', expectedAmount: 150000,
      chargedAmount: null, chargedCurrency: 'IDR', createdAt: new Date(),
    });
    const res = await paymentVerify(req({ billId: BILL_B }));
    expect(res.status).toBe(404);
    expect(await res.json()).not.toHaveProperty('data');
  });

  it('a professional cannot pay a colleague\'s bill in the same clinic', async () => {
    // Same rule as GET /bills/:id: a professional's scope is their own encounters.
    (requireRoles as any).mockResolvedValue({ actor: staffOfClinicA[2] });
    db.kcBill.findUnique.mockResolvedValue(billRow(303n, CLINIC_A, 3003n));
    db.kcPatientEncounter.findUnique.mockResolvedValue({ doctorId: 603n, patientId: 703n });
    const res = await paymentVerify(req({ billId: '303' }));
    expect(res.status).toBe(404);
    expect(wpEndpoint.createWcOrder).not.toHaveBeenCalled();
  });

  it('SUPER_ADMIN may start a payment for any clinic\'s bill, without a WordPress link', async () => {
    (requireRoles as any).mockResolvedValue({ actor: { id: 'super', role: 'SUPER_ADMIN', practiceId: null } });
    const res = await paymentVerify(req({ billId: BILL_B }));
    expect(res.status).toBe(200);
    expect(wpEndpoint.createWcOrder).toHaveBeenCalledWith(expect.objectContaining({ billId: BILL_B }));
  });
});

function webhookReq(rawBody: string, signature: string | null) {
  const headers: Record<string, string> = {};
  if (signature) headers['x-praktiqu-webhook-signature'] = signature;
  return new NextRequest('http://x/api/v1/sessions/payment-webhook', { method: 'POST', body: rawBody, headers });
}

describe('POST /sessions/payment-webhook', () => {
  it('401 on invalid signature', async () => {
    (svc.verifyPaymentWebhookSignature as any).mockReturnValue(false);
    const res = await webhook(webhookReq('{}', 'bad-sig'));
    expect(res.status).toBe(401);
  });

  it('404 for an unknown wcOrderId', async () => {
    (svc.verifyPaymentWebhookSignature as any).mockReturnValue(true);
    (svc.getPaymentOrderByWcOrderId as any).mockResolvedValue(null);
    const res = await webhook(webhookReq(JSON.stringify({ event: 'payment.completed', wcOrderId: 999 }), 'ok'));
    expect(res.status).toBe(404);
  });

  it('200 + applies public side effects on payment.completed', async () => {
    (svc.verifyPaymentWebhookSignature as any).mockReturnValue(true);
    // Returned from BOTH the pre-switch lookup and the post-markPaid
    // re-fetch (mockResolvedValue, not Once) — status: 'paid' reflects the
    // state after markPaid's guarded write, which the route re-reads rather
    // than trusting markPaid's own return value (see the route's crash-window
    // self-heal comment: markPaid returns null both on a lost race AND on a
    // prior-crash replay, so re-reading current state is the only way to
    // apply side effects in the replay case too).
    (svc.getPaymentOrderByWcOrderId as any).mockResolvedValue({ wcOrderId: 42, source: 'public', status: 'paid' });
    (svc.markPaid as any).mockResolvedValue({ wcOrderId: 42, source: 'public', status: 'paid' });
    const res = await webhook(webhookReq(JSON.stringify({ event: 'payment.completed', wcOrderId: 42, amountPaid: 100000, transactionId: 'tx' }), 'ok'));
    expect(res.status).toBe(200);
    expect(svc.applyPaidSideEffectsPublic).toHaveBeenCalled();
  });

  it('200 + still applies side effects when markPaid returns null (replay of an already-paid order)', async () => {
    (svc.verifyPaymentWebhookSignature as any).mockReturnValue(true);
    (svc.getPaymentOrderByWcOrderId as any).mockResolvedValue({ wcOrderId: 42, source: 'session', status: 'paid' });
    (svc.markPaid as any).mockResolvedValue(null); // e.g. a prior crash already flipped this row to 'paid'
    const res = await webhook(webhookReq(JSON.stringify({ event: 'payment.completed', wcOrderId: 42, amountPaid: 100000, transactionId: 'tx' }), 'ok'));
    expect(res.status).toBe(200);
    expect(svc.applyPaidSideEffectsSession).toHaveBeenCalled();
  });

  it('409 on amount mismatch', async () => {
    (svc.verifyPaymentWebhookSignature as any).mockReturnValue(true);
    (svc.getPaymentOrderByWcOrderId as any).mockResolvedValue({ wcOrderId: 42, source: 'public' });
    (svc.markPaid as any).mockRejectedValue(new (svc as any).AmountMismatchError());
    const res = await webhook(webhookReq(JSON.stringify({ event: 'payment.completed', wcOrderId: 42, amountPaid: 1, transactionId: 'tx' }), 'ok'));
    expect(res.status).toBe(409);
  });

  it('200 + cancels appointment on payment.failed (releases the slot the same way payment.expired does)', async () => {
    (svc.verifyPaymentWebhookSignature as any).mockReturnValue(true);
    (svc.getPaymentOrderByWcOrderId as any).mockResolvedValue({ wcOrderId: 42, source: 'public' });
    (svc.markFailed as any).mockResolvedValue({ wcOrderId: 42, source: 'public', appointmentId: 'appt_1' });
    const res = await webhook(webhookReq(JSON.stringify({ event: 'payment.failed', wcOrderId: 42 }), 'ok'));
    expect(res.status).toBe(200);
    expect(svc.cancelIfStillPending).toHaveBeenCalled();
  });

  it('200 + skips cancelIfStillPending on payment.failed when markFailed returns null (replay)', async () => {
    (svc.verifyPaymentWebhookSignature as any).mockReturnValue(true);
    (svc.getPaymentOrderByWcOrderId as any).mockResolvedValue({ wcOrderId: 42, source: 'public' });
    (svc.markFailed as any).mockResolvedValue(null); // already resolved by an earlier delivery
    const res = await webhook(webhookReq(JSON.stringify({ event: 'payment.failed', wcOrderId: 42 }), 'ok'));
    expect(res.status).toBe(200);
    expect(svc.cancelIfStillPending).not.toHaveBeenCalled();
  });

  it('200 + cancels appointment on payment.expired', async () => {
    (svc.verifyPaymentWebhookSignature as any).mockReturnValue(true);
    (svc.getPaymentOrderByWcOrderId as any).mockResolvedValue({ wcOrderId: 42, source: 'public' });
    (svc.markExpired as any).mockResolvedValue({ wcOrderId: 42, source: 'public', appointmentId: 'appt_1' });
    const res = await webhook(webhookReq(JSON.stringify({ event: 'payment.expired', wcOrderId: 42 }), 'ok'));
    expect(res.status).toBe(200);
    expect(svc.cancelIfStillPending).toHaveBeenCalled();
  });
});

describe.each([
  ['payment-success', success],
  ['payment-cancel', cancelRoute],
])('POST /sessions/%s', (_name, handler) => {
  it('400 on missing billId', async () => {
    const res = await handler(req({}));
    expect(res.status).toBe(400);
  });

  it('200 with the reconciled status', async () => {
    (svc.checkSessionPaymentStatus as any).mockResolvedValue({ status: 'paid', expectedAmount: 50000 });
    const res = await handler(req({ billId: '9' }));
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ status: 'paid', expectedAmount: 50000 });
  });

  it('404 when no payment exists for the bill', async () => {
    (svc.checkSessionPaymentStatus as any).mockRejectedValue(new (svc as any).UnknownOrderError());
    const res = await handler(req({ billId: '9' }));
    expect(res.status).toBe(404);
  });
});

describe('POST /sessions/payment-webhook — null transactionId', () => {
  // The plugin sends `$order->get_transaction_id() ?: null`, so transactionId is null
  // for every payment.expired and payment.failed event. A schema of
  // z.string().optional() accepts undefined but REJECTS null, so both failure events
  // 400'd while payment.completed (which carries a real capture id) passed. On the
  // live box that meant a cancelled WooCommerce order never released its appointment.
  it('accepts payment.expired with transactionId: null', async () => {
    (svc.verifyPaymentWebhookSignature as any).mockReturnValue(true);
    (svc.getPaymentOrderByWcOrderId as any).mockResolvedValue({ wcOrderId: 49746, source: 'public', status: 'pending' });
    (svc.markExpired as any).mockResolvedValue({ wcOrderId: 49746, source: 'public', status: 'expired' });
    const res = await webhook(webhookReq(JSON.stringify({
      event: 'payment.expired', wcOrderId: 49746, amountPaid: 48.89, currency: 'USD', transactionId: null,
    }), 'ok'));
    expect(res.status).toBe(200);
    expect(svc.markExpired).toHaveBeenCalledWith(49746);
    expect(svc.cancelIfStillPending).toHaveBeenCalled();
  });

  it('accepts payment.failed with transactionId: null', async () => {
    (svc.verifyPaymentWebhookSignature as any).mockReturnValue(true);
    (svc.getPaymentOrderByWcOrderId as any).mockResolvedValue({ wcOrderId: 49747, source: 'public', status: 'pending' });
    (svc.markFailed as any).mockResolvedValue({ wcOrderId: 49747, source: 'public', status: 'failed' });
    const res = await webhook(webhookReq(JSON.stringify({
      event: 'payment.failed', wcOrderId: 49747, transactionId: null,
    }), 'ok'));
    expect(res.status).toBe(200);
    expect(svc.markFailed).toHaveBeenCalled();
  });
});
