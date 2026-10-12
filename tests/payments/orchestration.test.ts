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
    // wp_options — the per-clinic international payment option and the global rate/markup.
    kcOption: { findMany: vi.fn() },
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
  applyPaidSideEffectsPublic,
  AppointmentNotFoundError, AppointmentNotPendingError, PaymentAlreadyInitiatedError,
} from '@/services/payments/payment.service';
import { calculateTax, getBill } from '@/services/billing/bill.service';
import {
  ChargeMismatchError,
  DiscountNotSupportedError,
  PaymentMethodNotAllowedError,
  PaypalRateMissingError,
} from '@/services/payments/payment-errors';
import { PaymentSettingsUnavailableError } from '@/repositories/wp/clinic-payment-settings.repo';

const APPOINTMENT = 5150;
const DOCTOR = 29;
const CLINIC = 3;
const SERVICE = 7;

/** The wp_options row that flags CLINIC as international (spec §1 storage format). */
function clinicOption(fields: Record<string, unknown>) {
  return {
    optionName: `praktiqu_endpoint_clinic_${CLINIC}_payment`,
    optionValue: JSON.stringify({
      international: true, fx_rate: null, markup_percent: null, fixed_fee_idr: null,
      updated_at: '2026-10-06T08:00:00+00:00', updated_by: 123,
      ...fields,
    }),
  };
}

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
  // No option rows: every clinic is not international unless a test says otherwise.
  db.kcOption.findMany.mockResolvedValue([]);
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

  it('forwards method to createWcOrder and persists gateway/chargedCurrency/chargedAmount/fxRate for a paypal order', async () => {
    // Nothing previously asserted that `method` reaches createWcOrder, or that the
    // foreign-charge figures survive onto the payment_orders row — only the
    // null-fallback case above was covered for public bookings.
    // PayPal now needs an international clinic: Rp 100,000 at 18,000 with no markup
    // is ceil(555.5…) = 556 cents.
    db.kcOption.findMany.mockResolvedValue([clinicOption({ fx_rate: 18000, markup_percent: 0 })]);
    db.paymentOrder.findFirst.mockResolvedValue(null);
    wpEndpoint.createWcOrder.mockResolvedValue({
      orderId: 42, checkoutUrl: 'https://wp/checkout/42',
      chargedAmount: 5.56, chargedCurrency: 'USD', fxRate: 18000,
    });
    db.paymentOrder.create.mockResolvedValue({ id: 'po_paypal' });

    const result = await initiatePublicPayment(APPOINTMENT, 'paypal');

    expect(wpEndpoint.createWcOrder).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'paypal' }),
    );
    expect(db.paymentOrder.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        gateway: 'paypal',
        chargedCurrency: 'USD',
        chargedAmount: 5.56,
        fxRate: 18000,
      }),
    }));
    expect(result.chargedCurrency).toBe('USD');
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

describe('applyPaidSideEffectsPublic — schedules session reminders', () => {
  // Guest bookings never pass through `transitionSession`, so this status write is the
  // only place that can ever schedule reminders for a publicly-booked session. A future
  // slotDate is required: `syncSessionReminders` skips any offset whose run time has
  // already passed relative to the real clock.
  function bookedRowFuture() {
    return { ...appointmentRow('BOOKED'), slotDate: '2099-01-15' };
  }

  it('schedules T-24h and T-1h reminders after booking a paid public order', async () => {
    sessions.findSessionById
      .mockResolvedValueOnce(appointmentRow('PENDING'))
      .mockResolvedValueOnce(bookedRowFuture());

    await applyPaidSideEffectsPublic({ appointmentId: String(APPOINTMENT), wcOrderId: 42 } as any);

    expect(appointments.setAppointmentStatus).toHaveBeenCalledWith(APPOINTMENT, 1);
    const reminderCalls = jobsClient.jobs.enqueue.mock.calls
      .map((c) => c[0])
      .filter((c) => c.hook === 'praktiqu_session_send_reminder');
    expect(reminderCalls).toHaveLength(2);
    expect(reminderCalls.map((c) => c.args.channel)).toEqual(['email_24h', 'email_1h']);
    expect(reminderCalls.every((c) => c.args.sessionId === APPOINTMENT)).toBe(true);
  });

  it('does not schedule reminders when the appointment was not actually PENDING', async () => {
    sessions.findSessionById.mockResolvedValue(appointmentRow('BOOKED'));

    await applyPaidSideEffectsPublic({ appointmentId: String(APPOINTMENT), wcOrderId: 42 } as any);

    expect(appointments.setAppointmentStatus).not.toHaveBeenCalled();
    expect(jobsClient.jobs.enqueue).not.toHaveBeenCalled();
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

  it('forwards method to createWcOrder and persists gateway/chargedCurrency/chargedAmount/fxRate for a paypal order', async () => {
    // Rp 150,000 at 18,000 with no markup is ceil(833.3…) = 834 cents.
    db.kcOption.findMany.mockResolvedValue([clinicOption({ fx_rate: 18000, markup_percent: 0 })]);
    db.paymentOrder.findFirst.mockResolvedValue(null); // no existing order for this bill
    vi.mocked(getBill).mockResolvedValue(bill(150000) as never);
    db.kcUser.findUnique.mockResolvedValue({ displayName: 'Jane Doe', userEmail: 'jane@x.com' });
    wpEndpoint.createWcOrder.mockResolvedValue({
      orderId: 99, checkoutUrl: 'https://wp/checkout/99',
      chargedAmount: 8.34, chargedCurrency: 'USD', fxRate: 18000,
    });
    db.paymentOrder.create.mockResolvedValue({ id: 'po_paypal_session' });

    const result = await ensureSessionPayment(BILL_ID, 'paypal');

    expect(wpEndpoint.createWcOrder).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'paypal' }),
    );
    expect(db.paymentOrder.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        gateway: 'paypal',
        chargedCurrency: 'USD',
        chargedAmount: 8.34,
        fxRate: 18000,
      }),
    }));
    expect(result.chargedCurrency).toBe('USD');
  });
});

describe('initiatePublicPayment — international gate (paypal/card)', () => {
  function servicePrice(charges: string) {
    services.listServicesForDoctor.mockResolvedValue([
      {
        mappingId: 11n, serviceId: BigInt(SERVICE), doctorId: BigInt(DOCTOR), clinicId: BigInt(CLINIC),
        name: 'Konsultasi', type: 'KONSELING', charges, durationMinutes: 60,
        isPublic: true, isActive: true, telemedService: null, nameAlias: null,
      },
    ]);
  }

  beforeEach(() => {
    db.paymentOrder.findFirst.mockResolvedValue(null);
    db.paymentOrder.create.mockResolvedValue({ id: 'po_usd' });
    servicePrice('200000');
  });

  it('refuses paypal on a clinic that is not international, before any WooCommerce order', async () => {
    await expect(initiatePublicPayment(APPOINTMENT, 'paypal')).rejects.toThrow(PaymentMethodNotAllowedError);
    expect(wpEndpoint.createWcOrder).not.toHaveBeenCalled();
    expect(db.paymentOrder.create).not.toHaveBeenCalled();
  });

  it('refuses card on a free order even at an international clinic', async () => {
    servicePrice('0');
    db.kcOption.findMany.mockResolvedValue([clinicOption({ fx_rate: 18000, fixed_fee_idr: 25000 })]);
    await expect(initiatePublicPayment(APPOINTMENT, 'card')).rejects.toThrow(PaymentMethodNotAllowedError);
    expect(wpEndpoint.createWcOrder).not.toHaveBeenCalled();
  });

  it('answers paypal_rate_missing (not "not allowed") for an international clinic with no usable rate', async () => {
    db.kcOption.findMany.mockResolvedValue([
      clinicOption({ fx_rate: null }),
      { optionName: 'praktiqu_endpoint_paypal_idr_rate', optionValue: '500000' },
    ]);
    await expect(initiatePublicPayment(APPOINTMENT, 'paypal')).rejects.toThrow(PaypalRateMissingError);
    expect(wpEndpoint.createWcOrder).not.toHaveBeenCalled();
  });

  it('answers payment_settings_unavailable when the settings read fails', async () => {
    db.kcOption.findMany.mockRejectedValue(new Error('Too many connections'));
    await expect(initiatePublicPayment(APPOINTMENT, 'paypal')).rejects.toThrow(PaymentSettingsUnavailableError);
    expect(wpEndpoint.createWcOrder).not.toHaveBeenCalled();
  });

  it('keeps the existing pending-order check first', async () => {
    db.paymentOrder.findFirst.mockResolvedValue({ status: 'pending' });
    await expect(initiatePublicPayment(APPOINTMENT, 'paypal')).rejects.toThrow(PaymentAlreadyInitiatedError);
    expect(db.kcOption.findMany).not.toHaveBeenCalled();
  });

  it('sends the worked example as charge and records the quote on payment_orders', async () => {
    db.kcOption.findMany.mockResolvedValue([clinicOption({ fx_rate: 18000, markup_percent: 10, fixed_fee_idr: 25000 })]);
    wpEndpoint.createWcOrder.mockResolvedValue({
      orderId: 77, checkoutUrl: 'https://paypal.com/checkout/77',
      chargedAmount: 13.62, chargedCurrency: 'USD', fxRate: 16363.64,
    });

    const result = await initiatePublicPayment(APPOINTMENT, 'paypal');

    const sent = wpEndpoint.createWcOrder.mock.calls[0][0];
    // The rupiah lines still go along: the plugin derives praktiqu_expected_idr from them.
    expect(sent.items).toEqual([{ name: 'Konsultasi', price: 200000 }]);
    expect(sent.charge).toEqual({
      currency: 'USD',
      items: [{ name: 'Konsultasi', amount: '12.23' }],
      taxes: [],
      fee: { name: 'International service fee', amount: '1.39' },
      total: '13.62',
      snapshot: {
        clinicId: CLINIC, fxRate: '18000', markupPercent: '10', fixedFeeIdr: '25000',
        source: { fxRate: 'clinic', markupPercent: 'clinic', fixedFeeIdr: 'clinic' },
      },
    });
    expect(db.paymentOrder.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        gateway: 'paypal',
        wcOrderId: 77,
        expectedAmount: 200000,
        chargedAmount: 13.62,
        chargedCurrency: 'USD',
        fxRate: Number('16363.636363636363636'),
      }),
    }));
    // The normal delayed auto-cancel, not the immediate backstop one.
    const enqueued = jobsClient.jobs.enqueue.mock.calls[0][0];
    expect(enqueued.args).toEqual({ wcOrderId: 77 });
    expect(enqueued.runAt.getTime()).toBeGreaterThan(Date.now() + 30 * 60_000);
    expect(result).toEqual({ checkoutUrl: 'https://paypal.com/checkout/77', chargedAmount: 13.62, chargedCurrency: 'USD' });
  });

  it.each([
    ['an older plugin that converted on its own', 13.61],
    ['an older plugin that reports no charge', null],
  ])('backstop: %s — immediate auto-cancel, no payment_orders row, ChargeMismatchError', async (_label, charged) => {
    db.kcOption.findMany.mockResolvedValue([clinicOption({ fx_rate: 18000, markup_percent: 10, fixed_fee_idr: 25000 })]);
    wpEndpoint.createWcOrder.mockResolvedValue({
      orderId: 78, checkoutUrl: 'https://paypal.com/checkout/78',
      chargedAmount: charged, chargedCurrency: 'USD', fxRate: 16363.64,
    });
    const before = Date.now();

    await expect(initiatePublicPayment(APPOINTMENT, 'paypal')).rejects.toThrow(ChargeMismatchError);

    expect(db.paymentOrder.create).not.toHaveBeenCalled();
    expect(jobsClient.jobs.enqueue).toHaveBeenCalledTimes(1);
    const enqueued = jobsClient.jobs.enqueue.mock.calls[0][0];
    expect(enqueued.hook).toBe('praktiqu_payment_auto_cancel');
    expect(enqueued.args).toEqual({ wcOrderId: 78 });
    expect(enqueued.runAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(enqueued.runAt.getTime()).toBeLessThanOrEqual(Date.now());
    expect(logging.logging.error).toHaveBeenCalledWith(
      'Charged amount differs from the USD quote — WooCommerce order cancel scheduled',
      undefined,
      expect.objectContaining({ metadata: expect.objectContaining({ wcOrderId: 78, quotedTotalUsd: '13.62' }) }),
    );
    // The cancel is scheduled BEFORE the log line: a failing log write must never be
    // able to stop the mis-priced order from being cancelled.
    expect(jobsClient.jobs.enqueue.mock.invocationCallOrder[0]).toBeLessThan(
      logging.logging.error.mock.invocationCallOrder[0],
    );
  });

  it('treats a charge in another currency as a mismatch even when the amount equals the quote', async () => {
    db.kcOption.findMany.mockResolvedValue([clinicOption({ fx_rate: 18000, markup_percent: 10, fixed_fee_idr: 25000 })]);
    // 13.62 is the quoted USD figure by number, but nobody is being billed 13.62 dollars.
    wpEndpoint.createWcOrder.mockResolvedValue({
      orderId: 81, checkoutUrl: 'https://paypal.com/checkout/81',
      chargedAmount: 13.62, chargedCurrency: 'IDR', fxRate: null,
    });

    await expect(initiatePublicPayment(APPOINTMENT, 'paypal')).rejects.toThrow(ChargeMismatchError);

    expect(db.paymentOrder.create).not.toHaveBeenCalled();
    expect(jobsClient.jobs.enqueue).toHaveBeenCalledTimes(1);
    const enqueued = jobsClient.jobs.enqueue.mock.calls[0][0];
    expect(enqueued.hook).toBe('praktiqu_payment_auto_cancel');
    expect(enqueued.args).toEqual({ wcOrderId: 81 });
    expect(enqueued.runAt.getTime()).toBeLessThanOrEqual(Date.now());
    expect(logging.logging.error).toHaveBeenCalledWith(
      'Charged amount differs from the USD quote — WooCommerce order cancel scheduled',
      undefined,
      expect.objectContaining({ metadata: expect.objectContaining({ wcOrderId: 81, chargedCurrency: 'IDR' }) }),
    );
  });

  it('still throws ChargeMismatchError when the cancel cannot be enqueued', async () => {
    db.kcOption.findMany.mockResolvedValue([clinicOption({ fx_rate: 18000, markup_percent: 10 })]);
    wpEndpoint.createWcOrder.mockResolvedValue({ orderId: 79, checkoutUrl: 'u', chargedAmount: 1, chargedCurrency: 'USD', fxRate: 1 });
    jobsClient.jobs.enqueue.mockRejectedValueOnce(new Error('jobs down'));

    await expect(initiatePublicPayment(APPOINTMENT, 'paypal')).rejects.toThrow(ChargeMismatchError);
    expect(db.paymentOrder.create).not.toHaveBeenCalled();
  });

  it('lets a plugin error through and writes no payment_orders row', async () => {
    db.kcOption.findMany.mockResolvedValue([clinicOption({ fx_rate: 18000 })]);
    const pluginError = Object.assign(new Error('WC order create failed 502'), { status: 502, code: 'charge_mismatch' });
    wpEndpoint.createWcOrder.mockRejectedValue(pluginError);

    await expect(initiatePublicPayment(APPOINTMENT, 'card')).rejects.toBe(pluginError);
    expect(db.paymentOrder.create).not.toHaveBeenCalled();
  });

  it('leaves xendit alone at an international clinic: no settings read, no charge', async () => {
    db.kcOption.findMany.mockResolvedValue([clinicOption({ fx_rate: 18000, fixed_fee_idr: 25000 })]);
    wpEndpoint.createWcOrder.mockResolvedValue({ orderId: 80, checkoutUrl: 'u', chargedAmount: 200000, chargedCurrency: 'IDR', fxRate: null });

    await initiatePublicPayment(APPOINTMENT, 'xendit');

    expect(db.kcOption.findMany).not.toHaveBeenCalled();
    expect(wpEndpoint.createWcOrder.mock.calls[0][0]).not.toHaveProperty('charge');
    expect(db.paymentOrder.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ expectedAmount: 200000, fxRate: null }),
    }));
  });
});

describe('ensureSessionPayment — international gate (paypal/card)', () => {
  const BILL_ID = '77';

  function bill(overrides: Record<string, unknown> = {}) {
    return {
      id: 77, invoiceId: 77, date: new Date('2026-07-01T00:00:00Z'), status: 'unpaid',
      clinic: { id: CLINIC }, doctor: { id: DOCTOR }, patient: { id: 461 },
      patientEncounter: { id: 91, appointmentId: APPOINTMENT },
      serviceItems: [{ id: 1, serviceId: SERVICE, service_name: 'Konsultasi', quantity: 1, price: 200000, total: 200000 }],
      service_total: 200000, discount: 0,
      totalTax: 0, taxItems: [], total_amount: 200000, actual_amount: 200000,
      ...overrides,
    };
  }

  beforeEach(() => {
    db.paymentOrder.findFirst.mockResolvedValue(null);
    db.paymentOrder.create.mockResolvedValue({ id: 'po_session_usd' });
    db.kcUser.findUnique.mockResolvedValue({ displayName: 'Jane Doe', userEmail: 'jane@x.com' });
    vi.mocked(getBill).mockResolvedValue(bill() as never);
  });

  it('refuses paypal on a discounted bill before reading settings or creating an order', async () => {
    vi.mocked(getBill).mockResolvedValue(bill({ discount: 20000, total_amount: 180000 }) as never);
    db.kcOption.findMany.mockResolvedValue([clinicOption({ fx_rate: 18000 })]);

    await expect(ensureSessionPayment(BILL_ID, 'paypal')).rejects.toThrow(DiscountNotSupportedError);
    expect(db.kcOption.findMany).not.toHaveBeenCalled();
    expect(wpEndpoint.createWcOrder).not.toHaveBeenCalled();
  });

  it('still lets xendit pay a discounted bill', async () => {
    vi.mocked(getBill).mockResolvedValue(bill({ discount: 20000, total_amount: 180000 }) as never);
    wpEndpoint.createWcOrder.mockResolvedValue({ orderId: 90, checkoutUrl: 'u', chargedAmount: 180000, chargedCurrency: 'IDR', fxRate: null });

    await ensureSessionPayment(BILL_ID, 'xendit');

    expect(wpEndpoint.createWcOrder.mock.calls[0][0]).not.toHaveProperty('charge');
  });

  it('refuses paypal on a clinic that is not international', async () => {
    await expect(ensureSessionPayment(BILL_ID, 'paypal')).rejects.toThrow(PaymentMethodNotAllowedError);
    expect(wpEndpoint.createWcOrder).not.toHaveBeenCalled();
  });

  it('treats a bill with clinic id 0 as not international, without a settings query', async () => {
    vi.mocked(getBill).mockResolvedValue(bill({ clinic: { id: 0 } }) as never);

    await expect(ensureSessionPayment(BILL_ID, 'card')).rejects.toThrow(PaymentMethodNotAllowedError);
    expect(db.kcOption.findMany).not.toHaveBeenCalled();
  });

  it('answers paypal_rate_missing for an international clinic with no usable rate', async () => {
    db.kcOption.findMany.mockResolvedValue([clinicOption({ fx_rate: null })]);
    await expect(ensureSessionPayment(BILL_ID, 'paypal')).rejects.toThrow(PaypalRateMissingError);
  });

  it('answers payment_settings_unavailable when the settings read fails', async () => {
    db.kcOption.findMany.mockRejectedValue(new Error('Too many connections'));
    await expect(ensureSessionPayment(BILL_ID, 'paypal')).rejects.toThrow(PaymentSettingsUnavailableError);
  });

  it('sends charge and keeps expectedAmount = bill.total_amount', async () => {
    db.kcOption.findMany.mockResolvedValue([clinicOption({ fx_rate: 18000, markup_percent: 10, fixed_fee_idr: 25000 })]);
    wpEndpoint.createWcOrder.mockResolvedValue({ orderId: 91, checkoutUrl: 'https://paypal.com/91', chargedAmount: 13.62, chargedCurrency: 'USD', fxRate: 16363.64 });

    const result = await ensureSessionPayment(BILL_ID, 'paypal');

    expect(wpEndpoint.createWcOrder.mock.calls[0][0].charge).toMatchObject({ total: '13.62', fee: { amount: '1.39' } });
    expect(db.paymentOrder.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        source: 'session', expectedAmount: 200000, chargedAmount: 13.62, chargedCurrency: 'USD',
        fxRate: Number('16363.636363636363636'),
      }),
    }));
    expect(result).toMatchObject({ checkoutUrl: 'https://paypal.com/91', status: 'pending', expectedAmount: 200000 });
  });

  it('backstop: a different charged amount cancels at once and writes no row', async () => {
    db.kcOption.findMany.mockResolvedValue([clinicOption({ fx_rate: 18000, markup_percent: 10, fixed_fee_idr: 25000 })]);
    wpEndpoint.createWcOrder.mockResolvedValue({ orderId: 92, checkoutUrl: 'u', chargedAmount: 12.23, chargedCurrency: 'USD', fxRate: 16363.64 });

    await expect(ensureSessionPayment(BILL_ID, 'card')).rejects.toThrow(ChargeMismatchError);
    expect(db.paymentOrder.create).not.toHaveBeenCalled();
    expect(jobsClient.jobs.enqueue).toHaveBeenCalledWith(expect.objectContaining({
      hook: 'praktiqu_payment_auto_cancel', args: { wcOrderId: 92 },
    }));
  });

  it('reuses an existing pending order without running the gate', async () => {
    db.paymentOrder.findFirst.mockResolvedValue({
      wcOrderId: 50, status: 'pending', expectedAmount: 200000, createdAt: new Date(),
      source: 'session', billId: BILL_ID, chargedAmount: 13.62, chargedCurrency: 'USD',
    });

    const result = await ensureSessionPayment(BILL_ID, 'paypal');

    expect(result).toMatchObject({ checkoutUrl: null, status: 'pending' });
    expect(db.kcOption.findMany).not.toHaveBeenCalled();
    expect(wpEndpoint.createWcOrder).not.toHaveBeenCalled();
  });
});
