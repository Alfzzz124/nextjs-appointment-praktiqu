/**
 * Public payment orchestration, against KiviCare's appointments.
 *
 * The appointment side moved off the `appointments` shadow table: the booking is read
 * through the sessions repo and confirmed or released through the plugin, so
 * KiviCare's confirmation mail and telemed provisioning still fire. `payment_orders`
 * stays ours — it has no KiviCare equivalent — and its `appointmentId` column now
 * carries the numeric id as text.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// `vi.mock` factories are hoisted above all top-level `const`s, so any mock object
// referenced inside a factory must itself be created inside `vi.hoisted`.
const db = vi.hoisted(() => {
  const d: any = {
    paymentOrder: { create: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn() },
    kcBill: { update: vi.fn(), findUnique: vi.fn() },
    kcPatientEncounter: { update: vi.fn(), findUnique: vi.fn() },
    kcAppointment: { updateMany: vi.fn() },
    kcUser: { findUnique: vi.fn() },
  };
  d.$transaction = vi.fn(async (fn: any) => fn(d));
  return d;
});
vi.mock('@/lib/db', () => ({ prisma: db }));

const wpEndpoint = vi.hoisted(() => ({ createWcOrder: vi.fn(), getWcOrderStatus: vi.fn() }));
vi.mock('@/lib/wp-endpoint', () => wpEndpoint);

const jobsClient = vi.hoisted(() => ({ jobs: { enqueue: vi.fn(), cancel: vi.fn() } }));
vi.mock('@/lib/jobs/client', () => jobsClient);

const appointments = vi.hoisted(() => ({
  setAppointmentStatus: vi.fn(),
  cancelAppointment: vi.fn(),
}));
vi.mock('@/repositories/wp/appointments.write', () => appointments);

const sessions = vi.hoisted(() => ({ findSessionById: vi.fn() }));
vi.mock('@/repositories/wp/sessions.repo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/repositories/wp/sessions.repo')>()),
  ...sessions,
}));

const services = vi.hoisted(() => ({ listServicesForDoctor: vi.fn() }));
vi.mock('@/repositories/wp/services.repo', () => services);

vi.mock('@/services/billing/bill.service', () => ({
  calculateTax: vi.fn().mockResolvedValue({ total_tax: 0, calculated_taxes: [] }),
  getBill: vi.fn(),
}));

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
  initiatePublicPayment, checkPublicPaymentStatus, ensureSessionPayment,
  AppointmentNotFoundError, AppointmentNotPendingError, PaymentAlreadyInitiatedError,
} from '@/services/payments/payment.service';
import { calculateTax, getBill } from '@/services/billing/bill.service';

const APPOINTMENT = 5150;
const DOCTOR = 29;
const CLINIC = 3;
const SERVICE = 7;

function appointmentRow(status: string) {
  return {
    id: APPOINTMENT,
    clinicId: CLINIC,
    professionalId: DOCTOR,
    clientId: 461,
    professionalName: 'Dr. A',
    clientName: 'Jane Doe',
    clientEmail: 'jane@x.com',
    slotDate: '2026-07-15',
    startTime: '10:00:00',
    endTime: '11:00:00',
    timezone: 'Asia/Jakarta',
    status,
    serviceIds: [SERVICE],
    description: null,
    createdAt: new Date('2026-07-01T00:00:00Z'),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  sessions.findSessionById.mockResolvedValue(appointmentRow('PENDING'));
  services.listServicesForDoctor.mockResolvedValue([
    {
      mappingId: 11n,
      serviceId: BigInt(SERVICE),
      doctorId: BigInt(DOCTOR),
      clinicId: BigInt(CLINIC),
      name: 'Consult',
      type: 'KONSELING',
      charges: '100000',
      durationMinutes: 60,
      isPublic: true,
      isActive: true,
      telemedService: null,
      nameAlias: null,
    },
  ]);
});

describe('initiatePublicPayment', () => {
  it('throws AppointmentNotFoundError when the appointment does not exist', async () => {
    sessions.findSessionById.mockResolvedValue(null);
    await expect(initiatePublicPayment(404404)).rejects.toThrow(AppointmentNotFoundError);
  });

  it('throws AppointmentNotPendingError when the appointment is already BOOKED', async () => {
    sessions.findSessionById.mockResolvedValue(appointmentRow('BOOKED'));
    await expect(initiatePublicPayment(APPOINTMENT)).rejects.toThrow(AppointmentNotPendingError);
  });

  it('throws PaymentAlreadyInitiatedError when a pending order already exists', async () => {
    db.paymentOrder.findFirst.mockResolvedValue({ status: 'pending' });
    await expect(initiatePublicPayment(APPOINTMENT)).rejects.toThrow(PaymentAlreadyInitiatedError);
  });

  it('creates a WC order + payment_orders row + auto-cancel job on success', async () => {
    db.paymentOrder.findFirst.mockResolvedValue(null);
    wpEndpoint.createWcOrder.mockResolvedValue({
      orderId: 42, checkoutUrl: 'https://wp/checkout/42',
      chargedAmount: 100000, chargedCurrency: 'IDR', fxRate: null,
    });
    db.paymentOrder.create.mockResolvedValue({ id: 'po_1' });

    const result = await initiatePublicPayment(APPOINTMENT);

    expect(result).toEqual({
      checkoutUrl: 'https://wp/checkout/42',
      chargedAmount: 100000,
      chargedCurrency: 'IDR',
    });
    expect(db.paymentOrder.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        wcOrderId: 42,
        expectedAmount: 100000,
        source: 'public',
        // The numeric id, as text — the column is a String with no FK.
        appointmentId: String(APPOINTMENT),
      }),
    }));
    expect(jobsClient.jobs.enqueue).toHaveBeenCalledWith(expect.objectContaining({
      hook: 'praktiqu_payment_auto_cancel',
      args: { wcOrderId: 42 },
    }));
  });

  it('charges the doctor’s own price for the service, not a catalogue default', async () => {
    db.paymentOrder.findFirst.mockResolvedValue(null);
    wpEndpoint.createWcOrder.mockResolvedValue({ orderId: 42, checkoutUrl: 'u' });
    db.paymentOrder.create.mockResolvedValue({ id: 'po_1' });

    await initiatePublicPayment(APPOINTMENT);

    expect(wpEndpoint.createWcOrder.mock.calls[0][0].items).toEqual([
      { name: 'Consult', price: 100000 },
    ]);
    expect(wpEndpoint.createWcOrder.mock.calls[0][0].customerEmail).toBe('jane@x.com');
  });

  it('applies clinic- and doctor-scoped taxes now that the ids are joinable', async () => {
    // Guest bookings previously got global taxes only: the appointment lived under a
    // Clinic cuid and wp_kc_tax rows are keyed on the numeric clinic id.
    db.paymentOrder.findFirst.mockResolvedValue(null);
    wpEndpoint.createWcOrder.mockResolvedValue({ orderId: 42, checkoutUrl: 'u' });
    db.paymentOrder.create.mockResolvedValue({ id: 'po_1' });

    await initiatePublicPayment(APPOINTMENT);

    expect(vi.mocked(calculateTax).mock.calls[0][0]).toMatchObject({
      clinic_id: CLINIC,
      doctor_id: DOCTOR,
    });
  });

  it('falls back to expectedAmount when the plugin is pre-1.5.0 and reports no chargedAmount (regression: dropping "?? expectedAmount" would store/display a charge of 0)', async () => {
    // `createWcOrder` (src/lib/wp-endpoint.ts) returns chargedAmount: null whenever the
    // WordPress plugin predates 1.5.0 and doesn't send the field back — a real deploy
    // shape, not a hypothetical: a `.next`-only deploy can put a new app in front of an
    // old plugin. This is exactly what a pre-1.5.0 mapper produces (chargedCurrency
    // defaults to 'IDR', fxRate stays null) — see wp-endpoint.ts lines 189-195.
    db.paymentOrder.findFirst.mockResolvedValue(null);
    wpEndpoint.createWcOrder.mockResolvedValue({
      orderId: 42, checkoutUrl: 'https://wp/checkout/42',
      chargedAmount: null, chargedCurrency: 'IDR', fxRate: null,
    });
    db.paymentOrder.create.mockResolvedValue({ id: 'po_1' });

    const result = await initiatePublicPayment(APPOINTMENT);

    // 100000 is the rupiah expectedAmount for this fixture's service price + 0 tax.
    expect(result.chargedAmount).toBe(100000);
    expect(result.chargedAmount).not.toBe(0);
    expect(result.chargedAmount).not.toBeNull();
  });
});

describe('checkPublicPaymentStatus — verify fallback', () => {
  function pendingOrder(createdAt: Date) {
    return {
      wcOrderId: 42, status: 'pending', expectedAmount: 100000, createdAt,
      source: 'public', appointmentId: String(APPOINTMENT), billId: null,
    };
  }
  const stale = () => new Date(Date.now() - 3 * 60_000);

  it('reconciles a stale pending order that WC shows as paid', async () => {
    db.paymentOrder.findFirst.mockResolvedValue(pendingOrder(stale()));
    wpEndpoint.getWcOrderStatus.mockResolvedValue({ orderId: 42, status: 'processing', isPaid: true, transactionId: 'tx-1', amount: 100000 });
    db.paymentOrder.updateMany.mockResolvedValue({ count: 1 });
    db.paymentOrder.findUnique.mockResolvedValue({ wcOrderId: 42, status: 'paid', expectedAmount: 100000, source: 'public', appointmentId: String(APPOINTMENT) });

    const result = await checkPublicPaymentStatus(APPOINTMENT);

    expect(result.status).toBe('paid');
    // Through the plugin: confirming is what sends KiviCare's booking mail.
    expect(appointments.setAppointmentStatus).toHaveBeenCalledWith(APPOINTMENT, 1);
  });

  it('does not reconcile a pending order younger than 2 minutes', async () => {
    db.paymentOrder.findFirst.mockResolvedValue(pendingOrder(new Date()));

    const result = await checkPublicPaymentStatus(APPOINTMENT);

    expect(result.status).toBe('pending');
    expect(wpEndpoint.getWcOrderStatus).not.toHaveBeenCalled();
  });

  it('releases the appointment slot when WC reports the order as failed/cancelled', async () => {
    db.paymentOrder.findFirst.mockResolvedValue(pendingOrder(stale()));
    wpEndpoint.getWcOrderStatus.mockResolvedValue({ orderId: 42, status: 'failed', isPaid: false });
    db.paymentOrder.updateMany.mockResolvedValue({ count: 1 });
    db.paymentOrder.findUnique.mockResolvedValue({ wcOrderId: 42, status: 'failed', expectedAmount: 100000, source: 'public', appointmentId: String(APPOINTMENT) });

    const result = await checkPublicPaymentStatus(APPOINTMENT);

    expect(result.status).toBe('failed');
    expect(appointments.cancelAppointment).toHaveBeenCalledWith(APPOINTMENT);
  });

  it('tolerates a small rounding drift between expectedAmount and the WC-reported amount', async () => {
    db.paymentOrder.findFirst.mockResolvedValue(pendingOrder(stale()));
    // WC's independently-recomputed total is 1 rupiah off due to per-line vs
    // whole-total rounding order — within AMOUNT_TOLERANCE_RUPIAH.
    wpEndpoint.getWcOrderStatus.mockResolvedValue({ orderId: 42, status: 'processing', isPaid: true, transactionId: 'tx-1', amount: 100001 });
    db.paymentOrder.updateMany.mockResolvedValue({ count: 1 });
    db.paymentOrder.findUnique.mockResolvedValue({ wcOrderId: 42, status: 'paid', expectedAmount: 100000, source: 'public', appointmentId: String(APPOINTMENT) });

    expect((await checkPublicPaymentStatus(APPOINTMENT)).status).toBe('paid');
  });

  it('leaves the order pending (no throw) when a genuine amount mismatch surfaces', async () => {
    db.paymentOrder.findFirst.mockResolvedValue(pendingOrder(stale()));
    wpEndpoint.getWcOrderStatus.mockResolvedValue({ orderId: 42, status: 'processing', isPaid: true, transactionId: 'tx-1', amount: 50000 });
    // markPaid's own lookup re-reads the same pending order, triggering its guard.
    db.paymentOrder.findUnique.mockResolvedValue({
      wcOrderId: 42, status: 'pending', expectedAmount: 100000, source: 'public', appointmentId: String(APPOINTMENT),
    });

    const result = await checkPublicPaymentStatus(APPOINTMENT);

    expect(result.status).toBe('pending');
    expect(db.paymentOrder.updateMany).not.toHaveBeenCalled();
    expect(appointments.setAppointmentStatus).not.toHaveBeenCalled();
    expect(logging.logging.error).toHaveBeenCalledWith(
      expect.stringContaining('amount mismatch'),
      expect.any(Error),
      expect.objectContaining({ metadata: expect.objectContaining({ wcOrderId: 42 }) }),
    );
  });
});

describe('cancelIfStillPending — auto-cancel guard', () => {
  it('cancels a public appointment that is still PENDING', async () => {
    const { cancelIfStillPending } = await import('@/services/payments/payment.service');

    await cancelIfStillPending({ source: 'public', appointmentId: String(APPOINTMENT), wcOrderId: 42 } as any);

    expect(appointments.cancelAppointment).toHaveBeenCalledWith(APPOINTMENT);
  });

  it('leaves a confirmed appointment alone', async () => {
    // The guard that matters: a late payment means the booking is real, and cancelling
    // here would drop a paid session.
    sessions.findSessionById.mockResolvedValue(appointmentRow('BOOKED'));
    const { cancelIfStillPending } = await import('@/services/payments/payment.service');

    await cancelIfStillPending({ source: 'public', appointmentId: String(APPOINTMENT), wcOrderId: 42 } as any);

    expect(appointments.cancelAppointment).not.toHaveBeenCalled();
  });

  it('is a no-op for a session/staff order (no appointment slot to release)', async () => {
    const { cancelIfStillPending } = await import('@/services/payments/payment.service');

    await cancelIfStillPending({ source: 'session', appointmentId: null, wcOrderId: 42 } as any);

    expect(appointments.cancelAppointment).not.toHaveBeenCalled();
  });
});

describe('applyPaidSideEffectsSession — settling a bill without transactions', () => {
  const BILL = '77';
  const ENCOUNTER = 91n;
  const APPOINTMENT = 5150n;

  function order() {
    return { source: 'session', billId: BILL, encounterId: null, wcOrderId: 42 } as never;
  }

  function billRow(paymentStatus: string) {
    return { id: BigInt(BILL), paymentStatus, encounterId: ENCOUNTER, appointmentId: APPOINTMENT };
  }

  it('closes the encounter, checks the appointment out, and marks the bill paid', async () => {
    db.kcBill.findUnique.mockResolvedValue(billRow('unpaid'));
    db.kcPatientEncounter.findUnique.mockResolvedValue({ status: 1 });
    const { applyPaidSideEffectsSession } = await import('@/services/payments/payment.service');

    await applyPaidSideEffectsSession(order());

    expect(db.kcPatientEncounter.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: ENCOUNTER }, data: { status: 0 } }),
    );
    expect(db.kcAppointment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: APPOINTMENT }, data: { status: 3 } }),
    );
    expect(db.kcBill.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: BigInt(BILL) }, data: { paymentStatus: 'paid' } }),
    );
    expect(jobsClient.jobs.cancel).toHaveBeenCalled();
  });

  it('writes the bill’s paid flag LAST', async () => {
    // The whole fix. The flag doubles as the "everything succeeded" marker, so writing
    // it first — as the old code did — made a mid-way failure permanent: the bill read
    // as paid, the guard short-circuited, and the encounter stayed open forever.
    db.kcBill.findUnique.mockResolvedValue(billRow('unpaid'));
    db.kcPatientEncounter.findUnique.mockResolvedValue({ status: 1 });
    const { applyPaidSideEffectsSession } = await import('@/services/payments/payment.service');

    await applyPaidSideEffectsSession(order());

    const encounterAt = db.kcPatientEncounter.update.mock.invocationCallOrder[0];
    const appointmentAt = db.kcAppointment.updateMany.mock.invocationCallOrder[0];
    const billAt = db.kcBill.update.mock.invocationCallOrder[0];
    expect(billAt).toBeGreaterThan(encounterAt);
    expect(billAt).toBeGreaterThan(appointmentAt);
  });

  it('never wraps MyISAM tables in a transaction that cannot hold', async () => {
    // wp_kc_bills / _patient_encounters / _appointments are all MyISAM: $transaction
    // there guarantees nothing and only makes the code look safe.
    db.kcBill.findUnique.mockResolvedValue(billRow('unpaid'));
    db.kcPatientEncounter.findUnique.mockResolvedValue({ status: 1 });
    const { applyPaidSideEffectsSession } = await import('@/services/payments/payment.service');

    await applyPaidSideEffectsSession(order());

    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('repairs a row left half-applied by the old ordering', async () => {
    // Bill already paid but the encounter never closed — the exact state the previous
    // code could strand, and then refuse to retry.
    db.kcBill.findUnique.mockResolvedValue(billRow('paid'));
    db.kcPatientEncounter.findUnique.mockResolvedValue({ status: 1 });
    const { applyPaidSideEffectsSession } = await import('@/services/payments/payment.service');

    await applyPaidSideEffectsSession(order());

    expect(db.kcPatientEncounter.update).toHaveBeenCalled();
  });

  it('does nothing when the bill is already fully settled', async () => {
    db.kcBill.findUnique.mockResolvedValue(billRow('paid'));
    db.kcPatientEncounter.findUnique.mockResolvedValue({ status: 0 });
    const { applyPaidSideEffectsSession } = await import('@/services/payments/payment.service');

    await applyPaidSideEffectsSession(order());

    expect(db.kcPatientEncounter.update).not.toHaveBeenCalled();
    expect(db.kcBill.update).not.toHaveBeenCalled();
    expect(jobsClient.jobs.cancel).not.toHaveBeenCalled();
  });

  it('does nothing when the bill does not exist', async () => {
    db.kcBill.findUnique.mockResolvedValue(null);
    const { applyPaidSideEffectsSession } = await import('@/services/payments/payment.service');

    await applyPaidSideEffectsSession(order());

    expect(db.kcPatientEncounter.update).not.toHaveBeenCalled();
    expect(db.kcBill.update).not.toHaveBeenCalled();
  });
});

describe('ensurePaidSideEffectsApplied — crash-window self-heal', () => {
  function paidOrder() {
    return {
      wcOrderId: 42, status: 'paid', expectedAmount: 100000, createdAt: new Date(),
      source: 'public', appointmentId: String(APPOINTMENT), billId: null,
    };
  }

  it('re-applies the transition for a paid order whose appointment never got updated', async () => {
    db.paymentOrder.findFirst.mockResolvedValue(paidOrder());

    await checkPublicPaymentStatus(APPOINTMENT);

    expect(appointments.setAppointmentStatus).toHaveBeenCalledWith(APPOINTMENT, 1);
    expect(jobsClient.jobs.cancel).toHaveBeenCalledWith({
      hook: 'praktiqu_payment_auto_cancel',
      args: { wcOrderId: 42 },
    });
  });

  it('is a cheap no-op when the appointment was already BOOKED', async () => {
    db.paymentOrder.findFirst.mockResolvedValue(paidOrder());
    sessions.findSessionById.mockResolvedValue(appointmentRow('BOOKED'));

    await checkPublicPaymentStatus(APPOINTMENT);

    expect(appointments.setAppointmentStatus).not.toHaveBeenCalled();
    expect(jobsClient.jobs.cancel).not.toHaveBeenCalled();
  });
});

describe('ensureSessionPayment — null chargedAmount fallback', () => {
  const BILL_ID = '77';

  function bill(totalAmount: number) {
    return {
      id: 77, invoiceId: 77, date: new Date('2026-07-01T00:00:00Z'), status: 'unpaid',
      clinic: { id: CLINIC }, doctor: { id: DOCTOR }, patient: { id: 461 },
      patientEncounter: { id: 91, appointmentId: APPOINTMENT },
      serviceItems: [{ id: 1, serviceId: SERVICE, service_name: 'Consult', quantity: 1, price: totalAmount, total: totalAmount }],
      service_total: totalAmount, discount: 0,
      totalTax: 0, taxItems: [], total_amount: totalAmount, actual_amount: totalAmount,
    };
  }

  it('falls back to expectedAmount when the plugin is pre-1.5.0 and reports no chargedAmount (regression: dropping "?? expectedAmount" would store/display a charge of 0)', async () => {
    // Same real-deploy scenario as the initiatePublicPayment case above: a plugin older
    // than 1.5.0 never sends chargedAmount back, so createWcOrder reports null. A
    // coerced 0 here would be shown to staff as "charged Rp 0" for a real bill.
    db.paymentOrder.findFirst.mockResolvedValue(null); // no existing order for this bill
    vi.mocked(getBill).mockResolvedValue(bill(150000) as never);
    db.kcUser.findUnique.mockResolvedValue({ displayName: 'Jane Doe', userEmail: 'jane@x.com' });
    wpEndpoint.createWcOrder.mockResolvedValue({
      orderId: 99, checkoutUrl: 'https://wp/checkout/99',
      chargedAmount: null, chargedCurrency: 'IDR', fxRate: null,
    });
    db.paymentOrder.create.mockResolvedValue({ id: 'po_2' });

    const result = await ensureSessionPayment(BILL_ID);

    expect(result.chargedAmount).toBe(150000);
    expect(result.chargedAmount).not.toBe(0);
    expect(result.chargedAmount).not.toBeNull();
  });
});
