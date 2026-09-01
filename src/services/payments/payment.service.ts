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
 * Public/guest booking amount.
 *
 * Clinic- and doctor-scoped taxes now apply. They could not before: the booking lived
 * in the `appointments` shadow table under a Clinic cuid, and `wp_kc_tax` rows are
 * keyed on the numeric KiviCare clinic id, so every guest booking was charged global
 * taxes only. With one id space the scope ids pass straight through. Callers that
 * genuinely have no clinic still get the global set.
 */
export async function computePublicAmount(service: {
  name: string;
  price: number | string;
  /** `wp_kc_services.id` — lets a service-scoped tax match. */
  serviceId?: number;
  clinicId?: number;
  doctorId?: number;
}): Promise<ComputedAmount> {
  const price = toNum(service.price);
  const { total_tax, calculated_taxes } = await calculateTax({
    clinic_id: service.clinicId,
    doctor_id: service.doctorId,
    serviceItems: [
      { serviceId: service.serviceId ?? 0, service_name: service.name, price, quantity: 1 },
    ],
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
  gateway?: PaymentMethod;
  chargedAmount?: number | null;
  chargedCurrency?: string;
  fxRate?: number | null;
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
      gateway: input.gateway ?? 'xendit',
      chargedAmount: input.chargedAmount ?? input.expectedAmount, // null/undefined -> the rupiah figure
      chargedCurrency: input.chargedCurrency ?? 'IDR',
      fxRate: input.fxRate ?? null,
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
  /** ISO 4217 code from the webhook. Omitted means IDR (pre-1.5.0 plugin). */
  currency?: string;
  transactionId: string;
  webhookPayload: unknown;
}

/** Guarded one-way transition pending -> paid. Returns null if already resolved (idempotent replay). */
export async function markPaid(input: MarkPaidInput): Promise<PaymentOrder | null> {
  const order = await prisma.paymentOrder.findUnique({ where: { wcOrderId: input.wcOrderId } });
  if (!order) throw new UnknownOrderError(`No payment order for wcOrderId ${input.wcOrderId}`);
  if (order.status === 'pending') {
    // A PayPal order is charged in USD, so comparing against the rupiah
    // expectedAmount would read 11.12 vs 200000 as a catastrophic mismatch and
    // leave a genuinely-paid appointment stuck in PENDING.
    const { chargedAmount, chargedCurrency } = chargedView(order);
    const currency = input.currency ?? chargedCurrency;
    const tolerance = currency === 'IDR' ? AMOUNT_TOLERANCE_RUPIAH : AMOUNT_TOLERANCE_MINOR_UNIT;
    const expected = currency === 'IDR' ? order.expectedAmount : chargedAmount;
    if (Math.abs(expected - input.amountPaid) > tolerance) {
      throw new AmountMismatchError(
        `Expected ${expected} ${currency} (±${tolerance}), got ${input.amountPaid}`,
      );
    }
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

import { signAppointmentToken } from '@/lib/public/appointment-token';
import { createWcOrder, getWcOrderStatus, type PaymentMethod } from '@/lib/wp-endpoint';
import { jobs } from '@/lib/jobs/client';
import { getBill } from '@/services/billing/bill.service';
import { logging } from '@/lib/logging';
import { APPOINTMENT_STATUS } from '@/repositories/wp/appointments.repo';
import { cancelAppointment, setAppointmentStatus } from '@/repositories/wp/appointments.write';
import { listServicesForDoctor } from '@/repositories/wp/services.repo';
import { SESSION_STATUS, findSessionById } from '@/repositories/wp/sessions.repo';
import { getPublicAppUrl } from '@/lib/public-url';

export class AppointmentNotFoundError extends Error {}
export class AppointmentNotPendingError extends Error {}
export class PaymentAlreadyInitiatedError extends Error {}

const AUTO_CANCEL_MS = 60 * 60 * 1000; // 1 hour — see Global Constraints
const VERIFY_FALLBACK_MS = 2 * 60 * 1000; // 2 minutes — see Global Constraints

/** Multi-item/multi-tax bills can differ by a rupiah or two between
 *  Σround(line) and round(Σline) — tolerate a small drift rather than
 *  rejecting a genuinely-correct payment. */
const AMOUNT_TOLERANCE_RUPIAH = 2;

/** One cent. USD is charged to 2 decimals, so anything beyond this is a real mismatch. */
const AMOUNT_TOLERANCE_MINOR_UNIT = 0.01;

export interface PaymentStatusView {
  status: PaymentStatus;
  /** Always integer rupiah — the app's own source of truth. */
  expectedAmount: number;
  /** What the payer was billed, in `chargedCurrency`. */
  chargedAmount: number;
  chargedCurrency: string;
}

/**
 * What the payer was actually billed, for display.
 *
 * `chargedAmount` is NULL on rows written before the column existed. Those are
 * all Xendit orders in rupiah, where `expectedAmount` already is the charge, so
 * that is the fallback. Prisma hands back a `Decimal` object rather than a
 * number, which is why this goes through `toNum` instead of a cast.
 */
export function chargedView(order: PaymentOrder): { chargedAmount: number; chargedCurrency: string } {
  return {
    chargedAmount: order.chargedAmount === null ? order.expectedAmount : toNum(order.chargedAmount),
    chargedCurrency: order.chargedCurrency || 'IDR',
  };
}

export async function initiatePublicPayment(
  appointmentId: number,
  method: PaymentMethod = 'xendit',
): Promise<{ checkoutUrl: string; chargedAmount: number; chargedCurrency: string }> {
  const appt = await findSessionById(appointmentId);
  if (!appt) throw new AppointmentNotFoundError();
  if (appt.status !== SESSION_STATUS.PENDING) throw new AppointmentNotPendingError();

  const orderKey = String(appointmentId);
  const existing = await getPaymentOrderByAppointment(orderKey);
  if (existing && existing.status === 'pending') throw new PaymentAlreadyInitiatedError();

  // The charge is the doctor's own price for the service, from the mapping — the same
  // number the booking page quoted. KiviCare keeps the service ids in `visit_type`; a
  // public booking carries exactly one.
  const serviceId = appt.serviceIds[0];
  const offered = serviceId
    ? await listServicesForDoctor({
        doctorId: BigInt(appt.professionalId),
        clinicId: BigInt(appt.clinicId),
      })
    : [];
  const mapping = offered.find((s) => Number(s.serviceId) === serviceId);

  const serviceName = mapping ? (mapping.nameAlias ?? mapping.name) : 'Service';
  const servicePrice = mapping ? toNum(mapping.charges ?? 0) : 0;
  const { expectedAmount, items, taxes } = await computePublicAmount({
    name: serviceName,
    price: servicePrice,
    serviceId,
    clinicId: appt.clinicId,
    doctorId: appt.professionalId,
  });

  const token = signAppointmentToken(appointmentId);
  const wcOrder = await createWcOrder({
    source: 'public',
    appointmentId: orderKey,
    customerName: appt.clientName || 'Guest',
    customerEmail: appt.clientEmail,
    items,
    taxes,
    returnUrl: `${getPublicAppUrl()}/book/payment/success?appt=${token}`,
    cancelUrl: `${getPublicAppUrl()}/book/payment/cancel?appt=${token}`,
    method,
  });

  await createPaymentOrder({
    source: 'public',
    appointmentId: orderKey,
    wcOrderId: wcOrder.orderId,
    expectedAmount,
    gateway: method,
    chargedAmount: wcOrder.chargedAmount,
    chargedCurrency: wcOrder.chargedCurrency,
    fxRate: wcOrder.fxRate,
  });
  await jobs.enqueue({
    hook: 'praktiqu_payment_auto_cancel',
    runAt: new Date(Date.now() + AUTO_CANCEL_MS),
    args: { wcOrderId: wcOrder.orderId },
  });

  return {
    checkoutUrl: wcOrder.checkoutUrl,
    chargedAmount: wcOrder.chargedAmount ?? expectedAmount,
    chargedCurrency: wcOrder.chargedCurrency,
  };
}

export async function applyPaidSideEffectsPublic(order: PaymentOrder): Promise<void> {
  if (!order.appointmentId) return;

  // Read-then-write rather than a guarded UPDATE, because confirming goes through the
  // plugin: KiviCare's status listeners send the confirmation mail and provision the
  // telemed link. Re-entering with an already-BOOKED appointment is the idempotent
  // case and stops here.
  const appt = await findSessionById(Number(order.appointmentId));
  if (!appt || appt.status !== SESSION_STATUS.PENDING) return;

  await setAppointmentStatus(Number(order.appointmentId), APPOINTMENT_STATUS.BOOKED);
  await jobs.cancel({ hook: 'praktiqu_payment_auto_cancel', args: { wcOrderId: order.wcOrderId } });
}

/** KiviCare encounter status: 1 = open, 0 = closed. */
const ENCOUNTER_CLOSED = 0;

/**
 * Settle a bill: close the encounter, check the appointment out, mark the bill paid.
 *
 * Deliberately NOT wrapped in `prisma.$transaction`. Every table it touches —
 * `wp_kc_bills`, `wp_kc_patient_encounters`, `wp_kc_appointments` — is MyISAM, which
 * has no transactions. The old wrapper compiled, ran, and guaranteed nothing; keeping
 * it would only make the code look safe. Atomicity is replaced by ordering plus
 * re-runnability.
 *
 * **The order matters and is the actual fix.** The bill's `paid` flag is written LAST,
 * because it doubles as the "everything succeeded" marker that the guard above reads.
 * The old code wrote it FIRST: a failure between that write and the encounter update
 * left the bill paid with the encounter still open, and the guard then short-circuited
 * every retry — so the inconsistency was permanent. Now a failure anywhere leaves the
 * bill unpaid, and the next `ensurePaidSideEffectsApplied` redoes the lot.
 *
 * The two downstream writes are absolute sets, not increments, so repeating them is
 * harmless — which is what makes the retry safe.
 *
 * Returns true when it changed something, so the caller only cancels the auto-cancel
 * job on a run that did real work.
 */
async function markBillPaid(billId: string, encounterId: string | null): Promise<boolean> {
  const bill = await prisma.kcBill.findUnique({ where: { id: BigInt(billId) } });
  if (!bill) return false;

  const encId = encounterId ? BigInt(encounterId) : bill.encounterId;
  const encounter = await prisma.kcPatientEncounter.findUnique({
    where: { id: encId },
    select: { status: true },
  });

  // Fully settled already — the common case on a repeat status poll. Checked against
  // the encounter too, not just the bill, so a row left half-applied by the previous
  // ordering is detected and repaired below rather than declared done.
  if (bill.paymentStatus === 'paid' && encounter?.status === ENCOUNTER_CLOSED) return false;

  await prisma.kcPatientEncounter.update({
    where: { id: encId },
    data: { status: ENCOUNTER_CLOSED },
  });

  if (bill.appointmentId) {
    await prisma.kcAppointment.updateMany({
      where: { id: bill.appointmentId },
      data: { status: APPOINTMENT_STATUS.CHECK_OUT },
    });
  }

  // Last: this is the marker the guard reads.
  await prisma.kcBill.update({
    where: { id: BigInt(billId) },
    data: { paymentStatus: 'paid' },
  });

  return true;
}

export async function applyPaidSideEffectsSession(order: PaymentOrder): Promise<void> {
  if (!order.billId) return;
  const applied = await markBillPaid(order.billId, order.encounterId);
  if (!applied) return; // already applied — nothing left to do
  await jobs.cancel({ hook: 'praktiqu_payment_auto_cancel', args: { wcOrderId: order.wcOrderId } });
}

/**
 * Idempotently (re-)apply paid side effects for an order already marked
 * 'paid'. Closes a crash-window gap: if the process died between markPaid's
 * guarded write and the side-effect call, a later read of this order would
 * otherwise never retry the (now cheap, guard-first) side effect.
 */
async function ensurePaidSideEffectsApplied(order: PaymentOrder): Promise<void> {
  if (order.status !== 'paid') return;
  if (order.source === 'public') await applyPaidSideEffectsPublic(order);
  else await applyPaidSideEffectsSession(order);
}

export async function cancelIfStillPending(order: PaymentOrder): Promise<void> {
  if (order.source === 'public' && order.appointmentId) {
    const appt = await findSessionById(Number(order.appointmentId));
    // Only an unpaid, unconfirmed booking is released. A BOOKED appointment means the
    // payment landed after all, and cancelling it here would drop a paid session.
    if (appt && appt.status === SESSION_STATUS.PENDING) {
      await cancelAppointment(Number(order.appointmentId));
    }
  }
  // Session/staff flow: an expired unpaid bill simply stays unpaid — staff
  // bookings don't hold a slot the way public PENDING appointments do.
}

async function reconcileIfStale(order: PaymentOrder): Promise<PaymentOrder> {
  if (order.status === 'paid') {
    await ensurePaidSideEffectsApplied(order);
    return order;
  }
  if (order.status !== 'pending') return order;
  if (Date.now() - order.createdAt.getTime() < VERIFY_FALLBACK_MS) return order;

  const wcStatus = await getWcOrderStatus(order.wcOrderId);
  if (wcStatus.isPaid) {
    let updated: PaymentOrder | null;
    try {
      updated = await markPaid({
        wcOrderId: order.wcOrderId,
        amountPaid: wcStatus.amount,
        currency: wcStatus.currency,
        transactionId: wcStatus.transactionId ?? '',
        webhookPayload: { source: 'verify-fallback', wcStatus },
      });
    } catch (err) {
      if (err instanceof AmountMismatchError) {
        await logging.error('Verify-fallback amount mismatch — leaving order pending for manual review', err, {
          metadata: { wcOrderId: order.wcOrderId, expectedAmount: order.expectedAmount, wcAmount: wcStatus.amount },
        });
        return order;
      }
      throw err;
    }
    if (!updated) return order;
    if (updated.source === 'public') await applyPaidSideEffectsPublic(updated);
    else await applyPaidSideEffectsSession(updated);
    return updated;
  }
  if (wcStatus.status === 'cancelled' || wcStatus.status === 'failed') {
    const updated = await markFailed(order.wcOrderId, { source: 'verify-fallback', wcStatus });
    if (updated) await cancelIfStillPending(updated);
    return updated ?? order;
  }
  return order;
}

export async function checkPublicPaymentStatus(appointmentId: number): Promise<PaymentStatusView> {
  const order = await getPaymentOrderByAppointment(String(appointmentId));
  if (!order) throw new UnknownOrderError('No payment found for this appointment');
  const reconciled = await reconcileIfStale(order);
  return {
    status: reconciled.status as PaymentStatus,
    expectedAmount: reconciled.expectedAmount,
    ...chargedView(reconciled),
  };
}

export async function checkSessionPaymentStatus(billId: string): Promise<PaymentStatusView> {
  const order = await getPaymentOrderByBill(billId);
  if (!order) throw new UnknownOrderError('No payment found for this bill');
  const reconciled = await reconcileIfStale(order);
  return {
    status: reconciled.status as PaymentStatus,
    expectedAmount: reconciled.expectedAmount,
    ...chargedView(reconciled),
  };
}

export async function ensureSessionPayment(
  billId: string,
  method: PaymentMethod = 'xendit',
): Promise<{ checkoutUrl: string | null; status: PaymentStatus; expectedAmount: number; chargedAmount: number; chargedCurrency: string }> {
  const existing = await getPaymentOrderByBill(billId);
  if (existing) {
    const reconciled = await reconcileIfStale(existing);
    if (reconciled.status !== 'failed' && reconciled.status !== 'expired' && reconciled.status !== 'cancelled') {
      return {
        checkoutUrl: null,
        status: reconciled.status as PaymentStatus,
        expectedAmount: reconciled.expectedAmount,
        ...chargedView(reconciled),
      };
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
    returnUrl: `${getPublicAppUrl()}/staff/bills/${billId}/payment-success`,
    cancelUrl: `${getPublicAppUrl()}/staff/bills/${billId}/payment-cancel`,
    method,
  });

  await createPaymentOrder({
    source: 'session',
    billId,
    encounterId: String(bill.patientEncounter.id),
    wcOrderId: wcOrder.orderId,
    expectedAmount,
    gateway: method,
    chargedAmount: wcOrder.chargedAmount,
    chargedCurrency: wcOrder.chargedCurrency,
    fxRate: wcOrder.fxRate,
  });
  await jobs.enqueue({
    hook: 'praktiqu_payment_auto_cancel',
    runAt: new Date(Date.now() + AUTO_CANCEL_MS),
    args: { wcOrderId: wcOrder.orderId },
  });

  return {
    checkoutUrl: wcOrder.checkoutUrl,
    status: 'pending',
    expectedAmount,
    chargedAmount: wcOrder.chargedAmount ?? expectedAmount,
    chargedCurrency: wcOrder.chargedCurrency,
  };
}
