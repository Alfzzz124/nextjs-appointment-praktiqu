import { calculateTax } from '@/services/billing/bill.service';
import type { BillDetail } from '@/services/billing/bill.service';
import { toNum } from '@/lib/kc-num';
import { createHmac, timingSafeEqual } from 'node:crypto';

export interface PaymentLineItem {
  name: string;
  price: number;
}

export interface PaymentTaxLine {
  name: string;
  amount: number;
}

export interface ComputedAmount {
  expectedAmount: number;
  items: PaymentLineItem[];
  taxes: PaymentTaxLine[];
}

/** Round to a whole rupiah — IDR has no fractional subunit in practice. */
function toRupiah(n: number): number {
  return Math.round(n);
}

/**
 * Public/guest booking amount. Only GLOBAL taxes (clinicId -1/null) apply —
 * app-table Clinic cuids have no bridge to the legacy wp_kc numeric clinic id
 * that clinic-scoped kcTax rows are keyed on, so clinic-specific taxes are out
 * of scope until that bridge exists.
 */
export async function computePublicAmount(service: { name: string; price: number | string }): Promise<ComputedAmount> {
  const price = toNum(service.price);
  const { total_tax, calculated_taxes } = await calculateTax({
    serviceItems: [{ serviceId: 0, service_name: service.name, price, quantity: 1 }],
  });
  const taxes: PaymentTaxLine[] = calculated_taxes.map((t) => ({ name: t.tax_name, amount: toRupiah(t.tax_amount) }));
  return {
    expectedAmount: toRupiah(price + total_tax),
    items: [{ name: service.name, price: toRupiah(price) }],
    taxes,
  };
}

/** Staff/session amount — the bill's own totals (already tax-inclusive) drive the WC order. */
export function computeSessionAmountFromBill(bill: BillDetail): ComputedAmount {
  const items: PaymentLineItem[] = bill.serviceItems.map((i) => ({
    name: i.service_name || 'Service',
    price: toRupiah(i.price * i.quantity),
  }));
  const taxes: PaymentTaxLine[] = bill.taxItems.map((t) => ({ name: t.tax_name, amount: toRupiah(t.tax_amount) }));
  return { expectedAmount: toRupiah(bill.total_amount), items, taxes };
}

/**
 * Constant-time HMAC-SHA256 verification for `sessions/payment-webhook`.
 * Deliberately a SEPARATE secret from WORDPRESS_WEBHOOK_SECRET/AUTH_SECRET —
 * see Global Constraints in the implementation plan.
 */
export function verifyPaymentWebhookSignature(rawBody: string, signature: string | null): boolean {
  const secret = process.env.PAYMENT_WEBHOOK_SECRET ?? '';
  if (!secret) {
    if (process.env.NODE_ENV === 'production') return false;
    return true; // dev-only fallback, mirrors src/lib/jobs/webhook-handler.ts
  }
  if (!signature) return false;

  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

import { prisma } from '@/lib/db';
import type { PaymentOrder } from '@prisma/client';

export type PaymentSource = 'public' | 'session';
export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'expired' | 'cancelled';

export class AmountMismatchError extends Error {}
export class UnknownOrderError extends Error {}

export interface CreatePaymentOrderInput {
  source: PaymentSource;
  appointmentId?: string | null;
  billId?: string | null;
  encounterId?: string | null;
  wcOrderId: number;
  expectedAmount: number;
}

export async function createPaymentOrder(input: CreatePaymentOrderInput): Promise<PaymentOrder> {
  return prisma.paymentOrder.create({
    data: {
      source: input.source,
      appointmentId: input.appointmentId ?? null,
      billId: input.billId ?? null,
      encounterId: input.encounterId ?? null,
      wcOrderId: input.wcOrderId,
      expectedAmount: input.expectedAmount,
      status: 'pending',
    },
  });
}

export async function getPaymentOrderByAppointment(appointmentId: string): Promise<PaymentOrder | null> {
  return prisma.paymentOrder.findFirst({ where: { appointmentId }, orderBy: { createdAt: 'desc' } });
}

export async function getPaymentOrderByBill(billId: string): Promise<PaymentOrder | null> {
  return prisma.paymentOrder.findFirst({ where: { billId }, orderBy: { createdAt: 'desc' } });
}

export async function getPaymentOrderByWcOrderId(wcOrderId: number): Promise<PaymentOrder | null> {
  return prisma.paymentOrder.findUnique({ where: { wcOrderId } });
}

export interface MarkPaidInput {
  wcOrderId: number;
  amountPaid: number;
  transactionId: string;
  webhookPayload: unknown;
}

/** Guarded one-way transition pending -> paid. Returns null if already resolved (idempotent replay). */
export async function markPaid(input: MarkPaidInput): Promise<PaymentOrder | null> {
  const order = await prisma.paymentOrder.findUnique({ where: { wcOrderId: input.wcOrderId } });
  if (!order) throw new UnknownOrderError(`No payment order for wcOrderId ${input.wcOrderId}`);
  if (order.status === 'pending' && order.expectedAmount !== input.amountPaid) {
    throw new AmountMismatchError(`Expected ${order.expectedAmount}, got ${input.amountPaid}`);
  }

  const result = await prisma.paymentOrder.updateMany({
    where: { wcOrderId: input.wcOrderId, status: 'pending' },
    data: {
      status: 'paid',
      transactionId: input.transactionId,
      paidAt: new Date(),
      webhookPayload: input.webhookPayload as any,
    },
  });
  if (result.count === 0) return null;
  return prisma.paymentOrder.findUnique({ where: { wcOrderId: input.wcOrderId } });
}

export async function markFailed(wcOrderId: number, webhookPayload: unknown): Promise<PaymentOrder | null> {
  const result = await prisma.paymentOrder.updateMany({
    where: { wcOrderId, status: 'pending' },
    data: { status: 'failed', webhookPayload: webhookPayload as any },
  });
  if (result.count === 0) return null;
  return prisma.paymentOrder.findUnique({ where: { wcOrderId } });
}

export async function markExpired(wcOrderId: number): Promise<PaymentOrder | null> {
  const result = await prisma.paymentOrder.updateMany({
    where: { wcOrderId, status: 'pending' },
    data: { status: 'expired' },
  });
  if (result.count === 0) return null;
  return prisma.paymentOrder.findUnique({ where: { wcOrderId } });
}

// Note: the `status` column also allows 'cancelled' (see Task 1's data model),
// reserved for a future out-of-band cancellation path (e.g. a guest cancelling
// their own PENDING appointment before paying). No route in this plan drives
// that transition yet, so no markCancelled() is defined until one does —
// avoids dead exported code (YAGNI).
