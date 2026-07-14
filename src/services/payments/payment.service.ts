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

import { AppointmentStatus } from '@prisma/client';
import { signAppointmentToken } from '@/lib/public/appointment-token';
import { createWcOrder, getWcOrderStatus } from '@/lib/wp-endpoint';
import { jobs } from '@/lib/jobs/client';
import { getBill } from '@/services/billing/bill.service';

export class AppointmentNotFoundError extends Error {}
export class AppointmentNotPendingError extends Error {}
export class PaymentAlreadyInitiatedError extends Error {}

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
const AUTO_CANCEL_MS = 60 * 60 * 1000; // 1 hour — see Global Constraints
const VERIFY_FALLBACK_MS = 2 * 60 * 1000; // 2 minutes — see Global Constraints

export interface PaymentStatusView {
  status: PaymentStatus;
  expectedAmount: number;
}

export async function initiatePublicPayment(appointmentId: string): Promise<{ checkoutUrl: string }> {
  const appt = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    select: {
      id: true,
      status: true,
      patient: { select: { user: { select: { displayName: true, email: true } } } },
      services: { take: 1, select: { price: true, service: { select: { name: true } } } },
    },
  });
  if (!appt) throw new AppointmentNotFoundError();
  if (appt.status !== AppointmentStatus.PENDING) throw new AppointmentNotPendingError();

  const existing = await getPaymentOrderByAppointment(appointmentId);
  if (existing && existing.status === 'pending') throw new PaymentAlreadyInitiatedError();

  const svc = appt.services[0];
  const serviceName = svc?.service.name ?? 'Service';
  const servicePrice = svc ? Number(svc.price) : 0;
  const { expectedAmount, items, taxes } = await computePublicAmount({ name: serviceName, price: servicePrice });

  const token = signAppointmentToken(appointmentId);
  const wcOrder = await createWcOrder({
    source: 'public',
    appointmentId,
    customerName: appt.patient?.user.displayName ?? 'Guest',
    customerEmail: appt.patient?.user.email ?? '',
    items,
    taxes,
    returnUrl: `${APP_URL}/book/payment/success?appt=${token}`,
    cancelUrl: `${APP_URL}/book/payment/cancel?appt=${token}`,
  });

  await createPaymentOrder({ source: 'public', appointmentId, wcOrderId: wcOrder.orderId, expectedAmount });
  await jobs.enqueue({
    hook: 'praktiqu_payment_auto_cancel',
    runAt: new Date(Date.now() + AUTO_CANCEL_MS),
    args: { wcOrderId: wcOrder.orderId },
  });

  return { checkoutUrl: wcOrder.checkoutUrl };
}

export async function applyPaidSideEffectsPublic(order: PaymentOrder): Promise<void> {
  await jobs.cancel({ hook: 'praktiqu_payment_auto_cancel', args: { wcOrderId: order.wcOrderId } });
  if (!order.appointmentId) return;
  await prisma.appointment.updateMany({
    where: { id: order.appointmentId, status: AppointmentStatus.PENDING },
    data: { status: AppointmentStatus.BOOKED },
  });
}

async function markBillPaid(billId: string, encounterId: string | null): Promise<void> {
  await prisma.$transaction(async (tx: typeof prisma) => {
    const bill = await tx.kcBill.update({ where: { id: BigInt(billId) }, data: { paymentStatus: 'paid' } });
    const encId = encounterId ? BigInt(encounterId) : bill.encounterId;
    await tx.kcPatientEncounter.update({ where: { id: encId }, data: { status: 0 } });
    if (bill.appointmentId) {
      await tx.kcAppointment.updateMany({ where: { id: bill.appointmentId }, data: { status: 3 } as any });
    }
  });
}

export async function applyPaidSideEffectsSession(order: PaymentOrder): Promise<void> {
  await jobs.cancel({ hook: 'praktiqu_payment_auto_cancel', args: { wcOrderId: order.wcOrderId } });
  if (!order.billId) return;
  await markBillPaid(order.billId, order.encounterId);
}

export async function cancelIfStillPending(order: PaymentOrder): Promise<void> {
  if (order.source === 'public' && order.appointmentId) {
    await prisma.appointment.updateMany({
      where: { id: order.appointmentId, status: AppointmentStatus.PENDING },
      data: { status: AppointmentStatus.CANCELLED },
    });
  }
  // Session/staff flow: an expired unpaid bill simply stays unpaid — staff
  // bookings don't hold a slot the way public PENDING appointments do.
}

async function reconcileIfStale(order: PaymentOrder): Promise<PaymentOrder> {
  if (order.status !== 'pending') return order;
  if (Date.now() - order.createdAt.getTime() < VERIFY_FALLBACK_MS) return order;

  const wcStatus = await getWcOrderStatus(order.wcOrderId);
  if (wcStatus.isPaid) {
    const updated = await markPaid({
      wcOrderId: order.wcOrderId,
      amountPaid: wcStatus.amount,
      transactionId: wcStatus.transactionId ?? '',
      webhookPayload: { source: 'verify-fallback', wcStatus },
    });
    if (!updated) return order;
    if (updated.source === 'public') await applyPaidSideEffectsPublic(updated);
    else await applyPaidSideEffectsSession(updated);
    return updated;
  }
  if (wcStatus.status === 'cancelled' || wcStatus.status === 'failed') {
    const updated = await markFailed(order.wcOrderId, { source: 'verify-fallback', wcStatus });
    return updated ?? order;
  }
  return order;
}

export async function checkPublicPaymentStatus(appointmentId: string): Promise<PaymentStatusView> {
  const order = await getPaymentOrderByAppointment(appointmentId);
  if (!order) throw new UnknownOrderError('No payment found for this appointment');
  const reconciled = await reconcileIfStale(order);
  return { status: reconciled.status as PaymentStatus, expectedAmount: reconciled.expectedAmount };
}

export async function checkSessionPaymentStatus(billId: string): Promise<PaymentStatusView> {
  const order = await getPaymentOrderByBill(billId);
  if (!order) throw new UnknownOrderError('No payment found for this bill');
  const reconciled = await reconcileIfStale(order);
  return { status: reconciled.status as PaymentStatus, expectedAmount: reconciled.expectedAmount };
}

export async function ensureSessionPayment(
  billId: string,
): Promise<{ checkoutUrl: string | null; status: PaymentStatus; expectedAmount: number }> {
  const existing = await getPaymentOrderByBill(billId);
  if (existing) {
    const reconciled = await reconcileIfStale(existing);
    if (reconciled.status !== 'failed' && reconciled.status !== 'expired' && reconciled.status !== 'cancelled') {
      return { checkoutUrl: null, status: reconciled.status as PaymentStatus, expectedAmount: reconciled.expectedAmount };
    }
    // failed/expired/cancelled — fall through and create a fresh order.
  }

  const bill = await getBill(Number(billId));
  const { expectedAmount, items, taxes } = computeSessionAmountFromBill(bill);
  const patientUser = await prisma.kcUser.findUnique({
    where: { id: BigInt(bill.patient.id) },
    select: { displayName: true, userEmail: true },
  });

  const wcOrder = await createWcOrder({
    source: 'session',
    billId,
    encounterId: String(bill.patientEncounter.id),
    customerName: patientUser?.displayName ?? 'Patient',
    customerEmail: patientUser?.userEmail ?? '',
    items,
    taxes,
    returnUrl: `${APP_URL}/staff/bills/${billId}/payment-success`,
    cancelUrl: `${APP_URL}/staff/bills/${billId}/payment-cancel`,
  });

  await createPaymentOrder({
    source: 'session',
    billId,
    encounterId: String(bill.patientEncounter.id),
    wcOrderId: wcOrder.orderId,
    expectedAmount,
  });
  await jobs.enqueue({
    hook: 'praktiqu_payment_auto_cancel',
    runAt: new Date(Date.now() + AUTO_CANCEL_MS),
    args: { wcOrderId: wcOrder.orderId },
  });

  return { checkoutUrl: wcOrder.checkoutUrl, status: 'pending', expectedAmount };
}
