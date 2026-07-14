import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/services/payments/payment.service', () => ({
  initiatePublicPayment: vi.fn(),
  checkPublicPaymentStatus: vi.fn(),
  AppointmentNotFoundError: class AppointmentNotFoundError extends Error {},
  AppointmentNotPendingError: class AppointmentNotPendingError extends Error {},
  PaymentAlreadyInitiatedError: class PaymentAlreadyInitiatedError extends Error {},
  UnknownOrderError: class UnknownOrderError extends Error {},
}));
vi.mock('@/lib/public/appointment-token', () => ({
  verifyAppointmentToken: vi.fn((t: string) => (t === 'bad' ? null : 'appt_1')),
}));

import { POST as initiate } from '@/app/api/v1/public/payments/route';
import { POST as verify } from '@/app/api/v1/public/payment-verify/route';
import * as svc from '@/services/payments/payment.service';

function req(body: unknown) {
  return new NextRequest('http://x/api/v1/public/payments', { method: 'POST', body: JSON.stringify(body) });
}

beforeEach(() => vi.clearAllMocks());

describe('POST /public/payments', () => {
  it('400 on invalid token', async () => {
    const res = await initiate(req({ token: 'bad' }));
    expect(res.status).toBe(400);
  });

  it('201 with checkoutUrl on success', async () => {
    (svc.initiatePublicPayment as any).mockResolvedValue({ checkoutUrl: 'https://wp/checkout/1' });
    const res = await initiate(req({ token: 'good' }));
    expect(res.status).toBe(201);
    expect((await res.json()).data.checkoutUrl).toBe('https://wp/checkout/1');
  });

  it('409 when the appointment is not pending', async () => {
    (svc.initiatePublicPayment as any).mockRejectedValue(new (svc as any).AppointmentNotPendingError());
    const res = await initiate(req({ token: 'good' }));
    expect(res.status).toBe(409);
  });

  it('404 when the appointment does not exist', async () => {
    (svc.initiatePublicPayment as any).mockRejectedValue(new (svc as any).AppointmentNotFoundError());
    const res = await initiate(req({ token: 'good' }));
    expect(res.status).toBe(404);
  });
});

describe('POST /public/payment-verify', () => {
  it('400 on invalid token', async () => {
    const res = await verify(req({ token: 'bad' }));
    expect(res.status).toBe(400);
  });

  it('200 with current status', async () => {
    (svc.checkPublicPaymentStatus as any).mockResolvedValue({ status: 'paid', expectedAmount: 100000 });
    const res = await verify(req({ token: 'good' }));
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ status: 'paid', expectedAmount: 100000 });
  });

  it('404 when no payment exists for the appointment', async () => {
    (svc.checkPublicPaymentStatus as any).mockRejectedValue(new (svc as any).UnknownOrderError());
    const res = await verify(req({ token: 'good' }));
    expect(res.status).toBe(404);
  });
});
