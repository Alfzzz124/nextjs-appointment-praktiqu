// src/lib/stripe.ts
// Stripe billing is disabled for MVP - requires STRIPE_SECRET_KEY setup

export interface CreatePaymentIntentInput {
  amount: number;
  currency: string;
  metadata?: Record<string, string>;
  customerId?: string;
  idempotencyKey?: string;
}

export interface RefundInput {
  paymentIntentId: string;
  amount?: number;
}

export interface RefundResult {
  id: string;
  status: string;
}

export async function createPaymentIntent(_input: CreatePaymentIntentInput) {
  throw new Error('Stripe billing not configured - set STRIPE_SECRET_KEY to enable');
}

export async function verifyWebhookSignature(_payload: string, _signature: string) {
  throw new Error('Stripe billing not configured');
}

export async function createRefund(_input: RefundInput): Promise<RefundResult> {
  throw new Error('Stripe billing not configured');
}

export async function retrievePaymentIntent(_id: string) {
  throw new Error('Stripe billing not configured');
}

export function getStripeInstance() {
  throw new Error('Stripe billing not configured');
}
