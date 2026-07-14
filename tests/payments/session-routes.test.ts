import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

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
import * as svc from '@/services/payments/payment.service';
import { requireRoles } from '@/lib/auth/route-guards';

function req(body: unknown) {
  return new NextRequest('http://x/api/v1/sessions/payment-verify', { method: 'POST', body: JSON.stringify(body) });
}

beforeEach(() => vi.clearAllMocks());

describe('POST /sessions/payment-verify', () => {
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

  it('200 + cancels appointment on payment.expired', async () => {
    (svc.verifyPaymentWebhookSignature as any).mockReturnValue(true);
    (svc.getPaymentOrderByWcOrderId as any).mockResolvedValue({ wcOrderId: 42, source: 'public' });
    (svc.markExpired as any).mockResolvedValue({ wcOrderId: 42, source: 'public', appointmentId: 'appt_1' });
    const res = await webhook(webhookReq(JSON.stringify({ event: 'payment.expired', wcOrderId: 42 }), 'ok'));
    expect(res.status).toBe(200);
    expect(svc.cancelIfStillPending).toHaveBeenCalled();
  });
});
