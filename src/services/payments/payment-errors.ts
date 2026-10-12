/**
 * Payment-route errors and their problem+json mapping (spec §3, "New errors" and
 * "Mapping plugin errors").
 *
 * Both payment routes — `POST /public/payments` and `POST /sessions/payment-verify` —
 * answer these with a coded problem, so the FE branches on `code`, never on status.
 * The WordPress message is logged and never returned to the client.
 */
import { WpEndpointError } from '@/lib/wp-endpoint';
import { logging } from '@/lib/logging';
import { PaymentSettingsUnavailableError } from '@/repositories/wp/clinic-payment-settings.repo';
import {
  badGateway,
  badRequest,
  conflict,
  forbidden,
  notFound,
  problem,
  serviceUnavailable,
  validationError,
  type ProblemDetails,
} from '@/lib/problem-details';

/** paypal/card on a clinic that is not international, or on a free order. 403. */
export class PaymentMethodNotAllowedError extends Error {}
/** The clinic is international but has no usable rate (rule 3). 503, no Retry-After. */
export class PaypalRateMissingError extends Error {}
/** The order total differs from the quote (plugin check or our backstop). 502. */
export class ChargeMismatchError extends Error {}
/** Staff route: paypal/card on a bill with a discount. 422. */
export class DiscountNotSupportedError extends Error {}

function wpErrorProblem(err: WpEndpointError): ProblemDetails {
  // Fire-and-forget: logging.write swallows its own failures and never rejects.
  void logging.error('WordPress payment call failed', err, {
    metadata: { status: err.status, code: err.code ?? null, message: err.message },
  });

  switch (err.code) {
    case 'clinic_not_international':
      return forbidden('payment_method_not_allowed', 'This payment method is not available for this clinic');
    case 'charge_mismatch':
      return badGateway('charge_mismatch', 'The payment amount could not be confirmed. Please try again.');
    case 'paypal_rate_missing':
      return serviceUnavailable('paypal_rate_missing', 'PayPal is temporarily unavailable for this clinic');
    case 'gateway_missing':
      return serviceUnavailable('payment_method_unavailable', 'This payment method is temporarily unavailable');
    case 'woocommerce_missing':
      return serviceUnavailable('payment_unavailable', 'Payments are temporarily unavailable. Please try again.');
    case 'invalid_charge':
      return badGateway('payment_gateway_rejected', 'The payment could not be started. Please try again.');
  }
  if (err.status === 0) {
    return serviceUnavailable('payment_unavailable', 'Payments are temporarily unavailable. Please try again.');
  }
  return badGateway('payment_start_failed', 'The payment could not be started. Please try again.');
}

/**
 * Coded problem for a payment error, or null for anything else (the caller keeps its
 * existing handling). WpEndpointError is mapped by `code`, never by passing its status
 * through.
 */
export function paymentErrorProblem(err: unknown): ProblemDetails | null {
  if (err instanceof PaymentMethodNotAllowedError) {
    return forbidden('payment_method_not_allowed', 'This payment method is not available for this clinic');
  }
  if (err instanceof PaypalRateMissingError) {
    return serviceUnavailable('paypal_rate_missing', 'PayPal is temporarily unavailable for this clinic');
  }
  if (err instanceof PaymentSettingsUnavailableError) {
    // Fire-and-forget, like wpErrorProblem: the 503 says "try again", the log says why.
    void logging.error('Clinic payment settings could not be read during payment', err, {
      metadata: { cause: err.cause instanceof Error ? err.cause.message : String(err.cause ?? '') },
    });
    return serviceUnavailable('payment_settings_unavailable', 'Payment settings could not be read. Please try again.');
  }
  if (err instanceof ChargeMismatchError) {
    return badGateway('charge_mismatch', 'The payment amount could not be confirmed. Please try again.');
  }
  if (err instanceof DiscountNotSupportedError) {
    return validationError('discount_not_supported', 'PayPal and card cannot be used on a discounted bill');
  }
  if (err instanceof WpEndpointError) return wpErrorProblem(err);
  return null;
}

/**
 * A coded problem for a plain HTTP status — KcError's `httpStatus`, or 500 for an
 * error nothing recognised. Lets `sessions/payment-verify` answer every error with a
 * `code`, not only the payment ones.
 */
export function statusProblem(status: number, detail: string): ProblemDetails {
  switch (status) {
    case 400:
      return badRequest('bad_request', detail);
    case 403:
      return forbidden('forbidden', detail);
    case 404:
      return notFound('not_found', detail);
    case 409:
      return conflict('conflict', detail);
    case 422:
      return validationError('invalid_input', detail);
    default:
      return problem({
        type: 'about:blank',
        title: detail,
        status,
        code: status >= 500 ? 'internal_error' : 'request_failed',
        detail,
      });
  }
}
