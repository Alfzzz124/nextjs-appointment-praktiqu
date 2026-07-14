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
