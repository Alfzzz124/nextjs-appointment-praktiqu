/**
 * Stripe SDK wrapper.
 *
 * Goals:
 *   - Single source of truth for the Stripe client (server-side only).
 *   - Hide API-version drift behind a stable `getStripeInstance()`.
 *   - Expose the four call sites the billing feature needs:
 *       createPaymentIntent, verifyWebhookSignature, createRefund, retrievePaymentIntent.
 *
 * Reference: https://stripe.com/docs/api
 *
 * NOTE: This module is server-only. Importing it from a client component will
 * leak the secret key. The Stripe Elements client is loaded directly in the
 * browser using NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY.
 */

import Stripe from 'stripe';

/** Lazily constructed Stripe client. Throws if STRIPE_SECRET_KEY is missing in prod. */
let _stripe: Stripe | null = null;

export function getStripeInstance(): Stripe {
  if (_stripe) return _stripe;

  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey && process.env.NODE_ENV === 'production') {
    throw new Error('STRIPE_SECRET_KEY is not set; cannot initialize Stripe client.');
  }

  _stripe = new Stripe(secretKey ?? 'sk_test_missing', {
    apiVersion: '2024-06-20' as Stripe.LatestApiVersion,
    typescript: true,
    appInfo: {
      name: 'praktiqu-billing',
      version: '0.1.0',
    },
  });
  return _stripe;
}

export interface CreatePaymentIntentInput {
  /** Amount in the smallest currency unit (e.g. cents/rupiah). */
  amount: number;
  currency: string; // e.g. 'idr', 'usd'
  metadata?: Record<string, string>;
  /** Stripe customer ID, if a customer was pre-created. */
  customerId?: string;
  /** Optional idempotency key — Stripe will dedupe within 24h. */
  idempotencyKey?: string;
}

export interface PaymentIntentResult {
  id: string;
  clientSecret: string;
  status: Stripe.PaymentIntent.Status;
  amount: number;
  currency: string;
}

export async function createPaymentIntent(
  input: CreatePaymentIntentInput
): Promise<PaymentIntentResult> {
  const stripe = getStripeInstance();
  const params: Stripe.PaymentIntentCreateParams = {
    amount: input.amount,
    currency: input.currency.toLowerCase(),
    metadata: input.metadata,
    automatic_payment_methods: { enabled: true },
  };
  if (input.customerId) params.customer = input.customerId;

  const options: Stripe.RequestOptions = {};
  if (input.idempotencyKey) options.idempotencyKey = input.idempotencyKey;

  const intent = await stripe.paymentIntents.create(params, options);
  if (!intent.client_secret) {
    throw new Error('Stripe did not return a client_secret');
  }
  return {
    id: intent.id,
    clientSecret: intent.client_secret,
    status: intent.status,
    amount: intent.amount,
    currency: intent.currency,
  };
}

export interface VerifyWebhookInput {
  payload: string | Buffer;
  signature: string | null;
}

export interface VerifiedWebhookEvent {
  id: string;
  type: string;
  data: { object: unknown };
  raw: Stripe.Event;
}

export class WebhookSignatureError extends Error {
  readonly code = 'invalid_signature';
  constructor(message = 'Invalid Stripe webhook signature') {
    super(message);
    this.name = 'WebhookSignatureError';
  }
}

export function verifyWebhookSignature(input: VerifyWebhookInput): VerifiedWebhookEvent {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new WebhookSignatureError('STRIPE_WEBHOOK_SECRET is not configured');
    }
    // Dev fallback: try parsing without verification so local flows work.
  }
  const stripe = getStripeInstance();
  try {
    const event = stripe.webhooks.constructEvent(
      input.payload,
      input.signature ?? '',
      secret ?? 'whsec_dev'
    );
    return { id: event.id, type: event.type, data: event.data as { object: unknown }, raw: event };
  } catch (err) {
    throw new WebhookSignatureError(
      err instanceof Error ? err.message : 'Failed to verify Stripe webhook signature'
    );
  }
}

export interface CreateRefundInput {
  paymentIntentId: string;
  amount?: number; // omit for full refund
  reason?: 'duplicate' | 'fraudulent' | 'requested_by_customer';
  metadata?: Record<string, string>;
  idempotencyKey?: string;
}

export interface RefundResult {
  id: string;
  status: Stripe.Refund.Status | string;
  amount: number;
  paymentIntentId: string;
}

export async function createRefund(input: CreateRefundInput): Promise<RefundResult> {
  const stripe = getStripeInstance();
  const params: Stripe.RefundCreateParams = {
    payment_intent: input.paymentIntentId,
    ...(input.amount != null ? { amount: input.amount } : {}),
    ...(input.reason ? { reason: input.reason } : {}),
    metadata: input.metadata,
  };
  const options: Stripe.RequestOptions = {};
  if (input.idempotencyKey) options.idempotencyKey = input.idempotencyKey;

  const refund = await stripe.refunds.create(params, options);
  return {
    id: refund.id,
    status: refund.status ?? 'unknown',
    amount: refund.amount,
    paymentIntentId:
      typeof refund.payment_intent === 'string'
        ? refund.payment_intent
        : (refund.payment_intent?.id ?? input.paymentIntentId),
  };
}

export async function retrievePaymentIntent(paymentIntentId: string): Promise<Stripe.PaymentIntent> {
  const stripe = getStripeInstance();
  return stripe.paymentIntents.retrieve(paymentIntentId);
}

export const stripeHelpers = {
  getStripeInstance,
  createPaymentIntent,
  verifyWebhookSignature,
  createRefund,
  retrievePaymentIntent,
};
