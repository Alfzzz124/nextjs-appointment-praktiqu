import { describe, it, expect, vi, beforeEach } from 'vitest';

// `vi.mock` factories are hoisted above all top-level `const`s, so any mock
// object referenced inside a factory must itself be created inside
// `vi.hoisted` (same pattern as tests/unit/professional/professional.service.test.ts
// and tests/unit/professional/availability.service.test.ts). Writing the plain
// `const db = {...}` form from the brief throws "Cannot access 'db' before
// initialization" because the factory runs (triggered by the hoisted imports
// below) before the `const db` line has executed.
const db = vi.hoisted(() => {
  const d: any = {
    paymentOrder: { create: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn() },
    appointment: { findUnique: vi.fn(), updateMany: vi.fn() },
    kcBill: { update: vi.fn() },
    kcPatientEncounter: { update: vi.fn() },
    kcAppointment: { updateMany: vi.fn() },
  };
  d.$transaction = vi.fn(async (fn: any) => fn(d));
  return d;
});
vi.mock('@/lib/db', () => ({ prisma: db }));

const wpEndpoint = vi.hoisted(() => ({ createWcOrder: vi.fn(), getWcOrderStatus: vi.fn() }));
vi.mock('@/lib/wp-endpoint', () => wpEndpoint);

const jobsClient = vi.hoisted(() => ({ jobs: { enqueue: vi.fn(), cancel: vi.fn() } }));
vi.mock('@/lib/jobs/client', () => jobsClient);

vi.mock('@/services/billing/bill.service', () => ({
  calculateTax: vi.fn().mockResolvedValue({ total_tax: 0, calculated_taxes: [] }),
  getBill: vi.fn(),
}));

beforeEach(() => vi.clearAllMocks());

import {
  initiatePublicPayment, checkPublicPaymentStatus,
  AppointmentNotFoundError, AppointmentNotPendingError, PaymentAlreadyInitiatedError,
} from '@/services/payments/payment.service';
import { getBill } from '@/services/billing/bill.service';

describe('initiatePublicPayment', () => {
  it('throws AppointmentNotFoundError when the appointment does not exist', async () => {
    db.appointment.findUnique.mockResolvedValue(null);
    await expect(initiatePublicPayment('appt_missing')).rejects.toThrow(AppointmentNotFoundError);
  });

  it('throws AppointmentNotPendingError when the appointment is already BOOKED', async () => {
    db.appointment.findUnique.mockResolvedValue({
      id: 'appt_1', status: 'BOOKED',
      patient: { user: { displayName: 'Jane', email: 'jane@x.com' } },
      services: [{ price: 100000, service: { name: 'Consult' } }],
    });
    await expect(initiatePublicPayment('appt_1')).rejects.toThrow(AppointmentNotPendingError);
  });

  it('throws PaymentAlreadyInitiatedError when a pending order already exists', async () => {
    db.appointment.findUnique.mockResolvedValue({
      id: 'appt_1', status: 'PENDING',
      patient: { user: { displayName: 'Jane', email: 'jane@x.com' } },
      services: [{ price: 100000, service: { name: 'Consult' } }],
    });
    db.paymentOrder.findFirst.mockResolvedValue({ status: 'pending' });
    await expect(initiatePublicPayment('appt_1')).rejects.toThrow(PaymentAlreadyInitiatedError);
  });

  it('creates a WC order + payment_orders row + auto-cancel job on success', async () => {
    db.appointment.findUnique.mockResolvedValue({
      id: 'appt_1', status: 'PENDING',
      patient: { user: { displayName: 'Jane', email: 'jane@x.com' } },
      services: [{ price: 100000, service: { name: 'Consult' } }],
    });
    db.paymentOrder.findFirst.mockResolvedValue(null);
    wpEndpoint.createWcOrder.mockResolvedValue({ orderId: 42, checkoutUrl: 'https://wp/checkout/42' });
    db.paymentOrder.create.mockResolvedValue({ id: 'po_1' });

    const result = await initiatePublicPayment('appt_1');
    expect(result).toEqual({ checkoutUrl: 'https://wp/checkout/42' });
    expect(db.paymentOrder.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ wcOrderId: 42, expectedAmount: 100000, source: 'public' }),
    }));
    expect(jobsClient.jobs.enqueue).toHaveBeenCalledWith(expect.objectContaining({
      hook: 'praktiqu_payment_auto_cancel',
      args: { wcOrderId: 42 },
    }));
  });
});

describe('checkPublicPaymentStatus — verify fallback', () => {
  it('reconciles a stale pending order that WC shows as paid', async () => {
    const staleCreatedAt = new Date(Date.now() - 3 * 60_000); // 3 minutes old
    db.paymentOrder.findFirst.mockResolvedValue({
      wcOrderId: 42, status: 'pending', expectedAmount: 100000, createdAt: staleCreatedAt,
      source: 'public', appointmentId: 'appt_1', billId: null,
    });
    wpEndpoint.getWcOrderStatus.mockResolvedValue({ orderId: 42, status: 'processing', isPaid: true, transactionId: 'tx-1', amount: 100000 });
    db.paymentOrder.updateMany.mockResolvedValue({ count: 1 });
    db.paymentOrder.findUnique.mockResolvedValue({ wcOrderId: 42, status: 'paid', expectedAmount: 100000, source: 'public', appointmentId: 'appt_1' });

    const result = await checkPublicPaymentStatus('appt_1');
    expect(result.status).toBe('paid');
    expect(db.appointment.updateMany).toHaveBeenCalledWith({
      where: { id: 'appt_1', status: 'PENDING' },
      data: { status: 'BOOKED' },
    });
  });

  it('does not reconcile a pending order younger than 2 minutes', async () => {
    db.paymentOrder.findFirst.mockResolvedValue({
      wcOrderId: 42, status: 'pending', expectedAmount: 100000, createdAt: new Date(), source: 'public', appointmentId: 'appt_1',
    });
    const result = await checkPublicPaymentStatus('appt_1');
    expect(result.status).toBe('pending');
    expect(wpEndpoint.getWcOrderStatus).not.toHaveBeenCalled();
  });
});

describe('cancelIfStillPending — auto-cancel guard', () => {
  it('cancels a public appointment that is still PENDING', async () => {
    const { cancelIfStillPending } = await import('@/services/payments/payment.service');
    await cancelIfStillPending({ source: 'public', appointmentId: 'appt_1', wcOrderId: 42 } as any);
    expect(db.appointment.updateMany).toHaveBeenCalledWith({
      where: { id: 'appt_1', status: 'PENDING' },
      data: { status: 'CANCELLED' },
    });
  });

  it('is a no-op for a session/staff order (no appointment slot to release)', async () => {
    const { cancelIfStillPending } = await import('@/services/payments/payment.service');
    await cancelIfStillPending({ source: 'session', appointmentId: null, wcOrderId: 42 } as any);
    expect(db.appointment.updateMany).not.toHaveBeenCalled();
  });
});
