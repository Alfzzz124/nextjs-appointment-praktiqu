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
vi.mock('@/lib/logging', () => ({
  logging: {
    audit: vi.fn().mockResolvedValue(undefined),
    activity: vi.fn().mockResolvedValue(undefined),
    error: vi.fn().mockResolvedValue(undefined),
    system: vi.fn().mockResolvedValue(undefined),
    warn: vi.fn().mockResolvedValue(undefined),
  },
}));
// Tokens carry wp_kc_appointments.id now; a non-numeric payload fails closed.
vi.mock('@/lib/public/appointment-token', () => ({
  verifyAppointmentIdToken: vi.fn((t: string) => (t === 'bad' ? null : 5150)),
}));

import { POST as initiate } from '@/app/api/v1/public/payments/route';
import { POST as verify } from '@/app/api/v1/public/payment-verify/route';
import * as svc from '@/services/payments/payment.service';
import {
  ChargeMismatchError,
  PaymentMethodNotAllowedError,
  PaypalRateMissingError,
} from '@/services/payments/payment-errors';
import { PaymentSettingsUnavailableError } from '@/repositories/wp/clinic-payment-settings.repo';
import { WpEndpointError } from '@/lib/wp-endpoint';

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
    // The numeric id reaches the service, not the raw token payload.
    expect(svc.initiatePublicPayment).toHaveBeenCalledWith(5150, 'xendit');
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

describe('POST /public/payments — method', () => {
  it('defaults to xendit when the body omits a method', async () => {
    (svc.initiatePublicPayment as any).mockResolvedValue({
      checkoutUrl: 'https://wp/checkout/1',
      chargedAmount: 200000,
      chargedCurrency: 'IDR',
    });
    const res = await initiate(req({ token: 'good' }));
    expect(res.status).toBe(201);
    expect(svc.initiatePublicPayment).toHaveBeenCalledWith(5150, 'xendit');
  });

  it('forwards paypal and returns the charged figures', async () => {
    (svc.initiatePublicPayment as any).mockResolvedValue({
      checkoutUrl: 'https://paypal.com/checkout/abc',
      chargedAmount: 11.12,
      chargedCurrency: 'USD',
    });
    const res = await initiate(req({ token: 'good', method: 'paypal' }));
    expect(res.status).toBe(201);
    expect(svc.initiatePublicPayment).toHaveBeenCalledWith(5150, 'paypal');
    const body = await res.json();
    expect(body.data.chargedAmount).toBe(11.12);
    expect(body.data.chargedCurrency).toBe('USD');
  });

  it('forwards card', async () => {
    (svc.initiatePublicPayment as any).mockResolvedValue({
      checkoutUrl: 'https://paypal.com/checkout/abc',
      chargedAmount: 11.12,
      chargedCurrency: 'USD',
    });
    await initiate(req({ token: 'good', method: 'card' }));
    expect(svc.initiatePublicPayment).toHaveBeenCalledWith(5150, 'card');
  });

  it('400 on an unknown method, without calling the service', async () => {
    const res = await initiate(req({ token: 'good', method: 'gopay' }));
    expect(res.status).toBe(400);
    expect(svc.initiatePublicPayment).not.toHaveBeenCalled();
  });
});

describe('POST /public/payments — international payment errors', () => {
  it.each([
    ['a clinic that is not international', 403, 'payment_method_not_allowed', () => new PaymentMethodNotAllowedError('no')],
    ['an international clinic with no usable rate', 503, 'paypal_rate_missing', () => new PaypalRateMissingError('no rate')],
    ['a settings read error', 503, 'payment_settings_unavailable', () => new PaymentSettingsUnavailableError('db down')],
    ['the backstop', 502, 'charge_mismatch', () => new ChargeMismatchError('13.61 != 13.62')],
  ])('answers %s with %i %s', async (_label, status, code, makeErr) => {
    (svc.initiatePublicPayment as any).mockRejectedValue(makeErr());
    const res = await initiate(req({ token: 'good', method: 'paypal' }));
    expect(res.status).toBe(status);
    expect(await res.json()).toMatchObject({ status, code });
    // The 503 configuration states carry no Retry-After.
    expect(res.headers.get('Retry-After')).toBeNull();
  });

  it.each([
    ['clinic_not_international', 409, 403, 'payment_method_not_allowed'],
    ['charge_mismatch', 502, 502, 'charge_mismatch'],
    ['paypal_rate_missing', 503, 503, 'paypal_rate_missing'],
    ['gateway_missing', 503, 503, 'payment_method_unavailable'],
    ['woocommerce_missing', 503, 503, 'payment_unavailable'],
    ['invalid_charge', 400, 502, 'payment_gateway_rejected'],
    ['order_create_failed', 500, 502, 'payment_start_failed'],
  ])('maps plugin code %s (WP %i) to %i %s, without the WordPress message', async (wpCode, wpStatus, status, code) => {
    (svc.initiatePublicPayment as any).mockRejectedValue(
      new WpEndpointError(`WC order create failed ${wpStatus}: secret wp detail`, wpStatus, wpCode),
    );
    const res = await initiate(req({ token: 'good', method: 'paypal' }));
    expect(res.status).toBe(status);
    const body = await res.json();
    expect(body).toMatchObject({ status, code });
    expect(JSON.stringify(body)).not.toContain('secret wp detail');
  });

  it('maps an unreachable WordPress to 503 payment_unavailable', async () => {
    (svc.initiatePublicPayment as any).mockRejectedValue(new WpEndpointError('/payments/order unreachable', 0));
    const res = await initiate(req({ token: 'good', method: 'card' }));
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe('payment_unavailable');
  });

  it('still answers 500 for an error nobody recognises', async () => {
    (svc.initiatePublicPayment as any).mockRejectedValue(new Error('boom'));
    const res = await initiate(req({ token: 'good' }));
    expect(res.status).toBe(500);
  });
});
