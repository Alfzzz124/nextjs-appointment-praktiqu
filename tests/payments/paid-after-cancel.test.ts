/**
 * A payment that lands after the booking was cancelled.
 *
 * WooCommerce still accepts payment on a cancelled order, so closing the order at
 * cancellation (close-orders-on-cancel) cannot shut the gap on its own. Before this,
 * applyPaidSideEffectsPublic stopped silently on a non-PENDING appointment: the money
 * came in and left no trace. It now puts the booking on the refund list, writes an audit
 * row and tells the clinic admin — once, however often the webhook or the status poll
 * comes back for the same order.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({ prisma: {} }));
vi.mock('@/lib/wp-endpoint', () => ({ createWcOrder: vi.fn(), getWcOrderStatus: vi.fn() }));
vi.mock('@/lib/jobs/client', () => ({ jobs: { enqueue: vi.fn(), cancel: vi.fn() } }));
vi.mock('@/services/billing/bill.service', () => ({ calculateTax: vi.fn(), getBill: vi.fn() }));
vi.mock('@/repositories/wp/services.repo', () => ({
  listServicesForDoctor: vi.fn(),
  findServiceById: vi.fn().mockResolvedValue({ id: 7n, name: 'Konsultasi Psikologi' }),
}));

const appointments = vi.hoisted(() => ({ setAppointmentStatus: vi.fn(), cancelAppointment: vi.fn() }));
vi.mock('@/repositories/wp/appointments.write', () => appointments);

const sessions = vi.hoisted(() => ({ findSessionById: vi.fn() }));
vi.mock('@/repositories/wp/sessions.repo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/repositories/wp/sessions.repo')>()),
  ...sessions,
}));

const clinics = vi.hoisted(() => ({ findClinicById: vi.fn() }));
vi.mock('@/repositories/wp/clinics.repo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/repositories/wp/clinics.repo')>()),
  ...clinics,
}));

const email = vi.hoisted(() => ({ sendEmail: vi.fn() }));
vi.mock('@/lib/email', async (orig) => ({
  ...(await orig<typeof import('@/lib/email')>()),
  sendEmail: (...a: unknown[]) => email.sendEmail(...a),
}));

const log = vi.hoisted(() => ({
  logging: { audit: vi.fn(), warn: vi.fn(), error: vi.fn(), activity: vi.fn(), system: vi.fn() },
}));
vi.mock('@/lib/logging', () => log);

const store = vi.hoisted(() => ({
  findApproval: vi.fn(),
  recordRefundNeeded: vi.fn(),
  findWpUserContact: vi.fn(),
}));
vi.mock('@/services/approval/store', async (orig) => ({
  ...(await orig<typeof import('@/services/approval/store')>()),
  findApproval: (...a: unknown[]) => store.findApproval(...a),
  recordRefundNeeded: (...a: unknown[]) => store.recordRefundNeeded(...a),
  findWpUserContact: (...a: unknown[]) => store.findWpUserContact(...a),
}));

const settings = vi.hoisted(() => ({ requiresApproval: vi.fn() }));
vi.mock('@/services/approval/settings', async (orig) => ({
  ...(await orig<typeof import('@/services/approval/settings')>()),
  requiresApproval: (...a: unknown[]) => settings.requiresApproval(...a),
}));

vi.mock('@/services/session/reminder-schedule', async (orig) => ({
  ...(await orig<typeof import('@/services/session/reminder-schedule')>()),
  syncSessionReminders: vi.fn(),
}));

import { applyPaidSideEffectsPublic } from '@/services/payments/payment.service';
import { SESSION_STATUS } from '@/repositories/wp/sessions.repo';

const APPOINTMENT = 5150;
const DOCTOR = 29;
const CLINIC = 3;

function appointment(status: string) {
  return {
    id: APPOINTMENT,
    clinicId: CLINIC,
    professionalId: DOCTOR,
    clientId: 461,
    professionalName: 'Dr. A',
    clientName: 'Jane Doe',
    clientEmail: 'jane@x.com',
    slotDate: '2099-07-15',
    startTime: '10:00:00',
    endTime: '11:00:00',
    timezone: 'Asia/Jakarta',
    status,
    serviceIds: [7],
    description: null,
    createdAt: new Date('2026-07-01T00:00:00Z'),
  } as never;
}

const order = {
  id: 'po_1',
  source: 'public',
  appointmentId: String(APPOINTMENT),
  wcOrderId: 9001,
  gateway: 'xendit',
  transactionId: 'txn_1',
  status: 'paid',
} as never;

beforeEach(() => {
  vi.clearAllMocks();
  store.findApproval.mockResolvedValue(null);
  store.recordRefundNeeded.mockResolvedValue(true);
  store.findWpUserContact.mockResolvedValue({ email: 'admin@klinik.test', name: 'Rina Admin' });
  clinics.findClinicById.mockResolvedValue({ id: 3n, name: 'Klinik Uji', email: 'klinik@klinik.test', clinicAdminId: 24n });
  settings.requiresApproval.mockResolvedValue(false);
  email.sendEmail.mockResolvedValue({ ok: true });
  sessions.findSessionById.mockResolvedValue(appointment(SESSION_STATUS.CANCELLED));
});

describe('applyPaidSideEffectsPublic — paid after the booking was cancelled', () => {
  it('puts the booking on the refund list, audits it, and mails the clinic admin once', async () => {
    await applyPaidSideEffectsPublic(order, { justPaid: true });

    expect(store.recordRefundNeeded).toHaveBeenCalledWith(
      expect.objectContaining({
        appointmentId: APPOINTMENT,
        doctorWpUserId: DOCTOR,
        clinicId: CLINIC,
        paymentOrderId: 'po_1',
      }),
    );
    expect(log.logging.audit).toHaveBeenCalledWith(
      'payment.paid_after_cancel',
      expect.objectContaining({
        resource: 'session',
        resourceId: String(APPOINTMENT),
        action: 'payment.paid_after_cancel',
        metadata: expect.objectContaining({ wcOrderId: 9001, paymentOrderId: 'po_1', clinicId: CLINIC }),
      }),
    );
    expect(email.sendEmail).toHaveBeenCalledTimes(1);
    const sent = email.sendEmail.mock.calls[0][0];
    expect(sent.to).toBe('admin@klinik.test');
    expect(sent.subject).toContain('dibatalkan');
    // What the admin has to do and where: the refund tab of the Persetujuan page.
    expect(sent.text).toContain('membayar setelah booking dibatalkan');
    expect(sent.text).toContain('dikembalikan');
    expect(sent.text).toContain('Refund');
    expect(sent.text).toContain('/dashboard/persetujuan');
    expect(sent.text).toContain('Jane Doe');
    // The appointment itself is never revived.
    expect(appointments.setAppointmentStatus).not.toHaveBeenCalled();
  });

  it('a replay (the record already says refund needed) writes no second audit row or mail', async () => {
    store.recordRefundNeeded.mockResolvedValue(false);

    await applyPaidSideEffectsPublic(order, { justPaid: true });

    expect(log.logging.audit).not.toHaveBeenCalled();
    expect(email.sendEmail).not.toHaveBeenCalled();
  });

  it('writes the record before the audit row and the mail, so a replay finds it', async () => {
    const calls: string[] = [];
    store.recordRefundNeeded.mockImplementation(async () => (calls.push('record'), true));
    log.logging.audit.mockImplementation(async () => void calls.push('audit'));
    email.sendEmail.mockImplementation(async () => (calls.push('mail'), { ok: true }));

    await applyPaidSideEffectsPublic(order, { justPaid: true });

    expect(calls).toEqual(['record', 'audit', 'mail']);
  });

  it('falls back to the clinic address when the clinic has no admin', async () => {
    clinics.findClinicById.mockResolvedValue({ id: 3n, name: 'Klinik Uji', email: 'klinik@klinik.test', clinicAdminId: 0n });

    await applyPaidSideEffectsPublic(order, { justPaid: true });

    expect(email.sendEmail).toHaveBeenCalledTimes(1);
    expect(email.sendEmail.mock.calls[0][0].to).toBe('klinik@klinik.test');
  });

  it('with nobody to mail, the record and audit stand and the gap is logged', async () => {
    clinics.findClinicById.mockResolvedValue({ id: 3n, name: 'Klinik Uji', email: '', clinicAdminId: 0n });

    await applyPaidSideEffectsPublic(order, { justPaid: true });

    expect(store.recordRefundNeeded).toHaveBeenCalled();
    expect(log.logging.audit).toHaveBeenCalledTimes(1);
    expect(email.sendEmail).not.toHaveBeenCalled();
    expect(log.logging.warn).toHaveBeenCalled();
  });

  it('a mail that fails does not fail the payment side effects', async () => {
    email.sendEmail.mockRejectedValue(new Error('smtp down'));

    await expect(applyPaidSideEffectsPublic(order, { justPaid: true })).resolves.toBeUndefined();

    expect(log.logging.audit).toHaveBeenCalledTimes(1);
  });
  it('a later re-read of an order paid long ago does not put a since-cancelled booking on the refund list', async () => {
    // The status poll and the crash self-heal re-apply side effects to any paid order. A
    // booking paid normally and cancelled by staff afterwards was not paid after its
    // cancellation: only the call that turned the order paid may say that.
    await applyPaidSideEffectsPublic(order);

    expect(store.recordRefundNeeded).not.toHaveBeenCalled();
    expect(log.logging.audit).not.toHaveBeenCalled();
    expect(email.sendEmail).not.toHaveBeenCalled();
    expect(appointments.setAppointmentStatus).not.toHaveBeenCalled();
  });
});

describe('applyPaidSideEffectsPublic — the ordinary paths are unchanged', () => {
  it('a PENDING booking is still confirmed through the plugin, with no refund record', async () => {
    sessions.findSessionById.mockResolvedValue(appointment(SESSION_STATUS.PENDING));

    await applyPaidSideEffectsPublic(order);

    expect(appointments.setAppointmentStatus).toHaveBeenCalledTimes(1);
    expect(store.recordRefundNeeded).not.toHaveBeenCalled();
    expect(email.sendEmail).not.toHaveBeenCalled();
  });

  it('an already BOOKED booking is the idempotent case: nothing happens', async () => {
    sessions.findSessionById.mockResolvedValue(appointment(SESSION_STATUS.BOOKED));

    await applyPaidSideEffectsPublic(order);

    expect(appointments.setAppointmentStatus).not.toHaveBeenCalled();
    expect(store.recordRefundNeeded).not.toHaveBeenCalled();
  });
});
