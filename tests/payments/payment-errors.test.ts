/**
 * paymentErrorProblem — the problem+json table of spec §3 ("New errors" and "Mapping
 * plugin errors"). The WordPress message is logged, never returned.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const logging = vi.hoisted(() => ({
  logging: {
    audit: vi.fn().mockResolvedValue(undefined),
    activity: vi.fn().mockResolvedValue(undefined),
    error: vi.fn().mockResolvedValue(undefined),
    system: vi.fn().mockResolvedValue(undefined),
    warn: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock('@/lib/logging', () => logging);

import {
  ChargeMismatchError,
  DiscountNotSupportedError,
  PaymentMethodNotAllowedError,
  PaypalRateMissingError,
  paymentErrorProblem,
  statusProblem,
} from '@/services/payments/payment-errors';
import { PaymentSettingsUnavailableError } from '@/repositories/wp/clinic-payment-settings.repo';
import { WpEndpointError, WpConfigError } from '@/lib/wp-endpoint';
import { badGateway } from '@/lib/problem-details';

beforeEach(() => vi.clearAllMocks());

describe('badGateway', () => {
  it('builds a coded 502 problem', () => {
    const p = badGateway('charge_mismatch', 'detail here');
    expect(p).toMatchObject({ status: 502, title: 'Bad Gateway', code: 'charge_mismatch', detail: 'detail here' });
    expect(p.type).toMatch(/\/bad-gateway$/);
  });
});

describe('paymentErrorProblem — our own errors', () => {
  it.each([
    ['PaymentMethodNotAllowedError', 403, 'payment_method_not_allowed', new PaymentMethodNotAllowedError('x')],
    ['PaypalRateMissingError', 503, 'paypal_rate_missing', new PaypalRateMissingError('x')],
    ['PaymentSettingsUnavailableError', 503, 'payment_settings_unavailable', new PaymentSettingsUnavailableError('x')],
    ['ChargeMismatchError', 502, 'charge_mismatch', new ChargeMismatchError('x')],
    ['DiscountNotSupportedError', 422, 'discount_not_supported', new DiscountNotSupportedError('x')],
  ])('%s -> %i %s', (_name, status, code, err) => {
    expect(paymentErrorProblem(err)).toMatchObject({ status, code });
  });

  it('logs why the clinic payment settings could not be read, then answers 503', () => {
    const err = new PaymentSettingsUnavailableError('read failed', new Error('connection refused'));

    expect(paymentErrorProblem(err)).toMatchObject({ status: 503, code: 'payment_settings_unavailable' });
    expect(logging.logging.error).toHaveBeenCalledWith(
      'Clinic payment settings could not be read during payment',
      err,
      { metadata: { cause: 'connection refused' } },
    );
  });

  it('returns null for an error it does not own', () => {
    expect(paymentErrorProblem(new Error('boom'))).toBeNull();
    expect(paymentErrorProblem('not an error')).toBeNull();
  });
});

describe('paymentErrorProblem — plugin errors, by code', () => {
  it.each([
    ['clinic_not_international', 409, 403, 'payment_method_not_allowed'],
    ['charge_mismatch', 502, 502, 'charge_mismatch'],
    ['paypal_rate_missing', 503, 503, 'paypal_rate_missing'],
    ['gateway_missing', 503, 503, 'payment_method_unavailable'],
    ['woocommerce_missing', 503, 503, 'payment_unavailable'],
    ['invalid_charge', 400, 502, 'payment_gateway_rejected'],
    ['payment_start_failed', 502, 502, 'payment_start_failed'],
    ['order_create_failed', 500, 502, 'payment_start_failed'],
    ['amount_collapsed', 500, 502, 'payment_start_failed'],
  ])('%s (WP %i) -> %i %s', (code, wpStatus, status, expected) => {
    const p = paymentErrorProblem(new WpEndpointError(`WC order create failed ${wpStatus}: secret wp detail`, wpStatus, code));
    expect(p).toMatchObject({ status, code: expected });
  });

  it('maps an unreachable WordPress (status 0) to 503 payment_unavailable', () => {
    expect(paymentErrorProblem(new WpEndpointError('/payments/order unreachable: ECONNREFUSED', 0))).toMatchObject({
      status: 503, code: 'payment_unavailable',
    });
  });

  it('maps a missing service token to 502 payment_start_failed', () => {
    expect(paymentErrorProblem(new WpConfigError('WORDPRESS_SERVICE_TOKEN not set'))).toMatchObject({
      status: 502, code: 'payment_start_failed',
    });
  });

  it('logs the WordPress message and never returns it', () => {
    const err = new WpEndpointError('WC order create failed 500: secret wp detail', 500, 'order_create_failed');

    const p = paymentErrorProblem(err);

    expect(JSON.stringify(p)).not.toContain('secret wp detail');
    expect(logging.logging.error).toHaveBeenCalledWith(
      'WordPress payment call failed',
      err,
      { metadata: { status: 500, code: 'order_create_failed', message: 'WC order create failed 500: secret wp detail' } },
    );
  });
});

describe('statusProblem', () => {
  it.each([
    [400, 'bad_request'],
    [403, 'forbidden'],
    [404, 'not_found'],
    [409, 'conflict'],
    [422, 'invalid_input'],
    [500, 'internal_error'],
    [401, 'request_failed'],
  ])('%i -> %s, keeping the status and detail', (status, code) => {
    expect(statusProblem(status, 'Bill not found')).toMatchObject({ status, code, detail: 'Bill not found' });
  });
});
