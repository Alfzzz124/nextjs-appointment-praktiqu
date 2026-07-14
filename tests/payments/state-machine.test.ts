import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db');

import {
  createPaymentOrder, getPaymentOrderByWcOrderId, markPaid, markFailed, markExpired,
  AmountMismatchError, UnknownOrderError,
} from '@/services/payments/payment.service';
import { prisma } from '@/lib/db';

const mockPrisma = prisma as any;

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.paymentOrder = {
    create: vi.fn(),
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    updateMany: vi.fn(),
  };
});

describe('payment.service state machine', () => {
  it('createPaymentOrder writes a pending row', async () => {
    mockPrisma.paymentOrder.create.mockResolvedValue({ id: 'po_1', status: 'pending' });
    await createPaymentOrder({ source: 'public', appointmentId: 'appt_1', wcOrderId: 42, expectedAmount: 100000 });
    expect(mockPrisma.paymentOrder.create).toHaveBeenCalledWith({
      data: {
        source: 'public', appointmentId: 'appt_1', billId: null, encounterId: null,
        wcOrderId: 42, expectedAmount: 100000, status: 'pending',
      },
    });
  });

  it('markPaid throws UnknownOrderError for an unrecognized wcOrderId', async () => {
    mockPrisma.paymentOrder.findUnique.mockResolvedValue(null);
    await expect(markPaid({ wcOrderId: 999, amountPaid: 1000, transactionId: 'tx', webhookPayload: {} }))
      .rejects.toThrow(UnknownOrderError);
  });

  it('markPaid throws AmountMismatchError when paid amount != expectedAmount', async () => {
    mockPrisma.paymentOrder.findUnique.mockResolvedValue({ wcOrderId: 42, expectedAmount: 100000, status: 'pending' });
    await expect(markPaid({ wcOrderId: 42, amountPaid: 50000, transactionId: 'tx', webhookPayload: {} }))
      .rejects.toThrow(AmountMismatchError);
  });

  it('markPaid transitions pending -> paid exactly once (idempotent on replay)', async () => {
    mockPrisma.paymentOrder.findUnique
      .mockResolvedValueOnce({ wcOrderId: 42, expectedAmount: 100000, status: 'pending' })
      .mockResolvedValueOnce({ wcOrderId: 42, expectedAmount: 100000, status: 'paid' });
    mockPrisma.paymentOrder.updateMany.mockResolvedValueOnce({ count: 1 });
    const first = await markPaid({ wcOrderId: 42, amountPaid: 100000, transactionId: 'tx', webhookPayload: {} });
    expect(first?.status).toBe('paid');

    // Replay: row is no longer 'pending', so the guarded updateMany matches zero rows.
    mockPrisma.paymentOrder.findUnique.mockResolvedValueOnce({ wcOrderId: 42, expectedAmount: 100000, status: 'paid' });
    mockPrisma.paymentOrder.updateMany.mockResolvedValueOnce({ count: 0 });
    const second = await markPaid({ wcOrderId: 42, amountPaid: 100000, transactionId: 'tx', webhookPayload: {} });
    expect(second).toBeNull();
  });

  it('markExpired never overrides an already-paid order', async () => {
    mockPrisma.paymentOrder.updateMany.mockResolvedValueOnce({ count: 0 });
    const result = await markExpired(42);
    expect(result).toBeNull();
    expect(mockPrisma.paymentOrder.updateMany).toHaveBeenCalledWith({
      where: { wcOrderId: 42, status: 'pending' },
      data: { status: 'expired' },
    });
  });

  it('markFailed is a guarded one-way transition', async () => {
    mockPrisma.paymentOrder.updateMany.mockResolvedValueOnce({ count: 1 });
    mockPrisma.paymentOrder.findUnique.mockResolvedValueOnce({ wcOrderId: 42, status: 'failed' });
    const result = await markFailed(42, { reason: 'declined' });
    expect(result?.status).toBe('failed');
    expect(mockPrisma.paymentOrder.updateMany).toHaveBeenCalledWith({
      where: { wcOrderId: 42, status: 'pending' },
      data: { status: 'failed', webhookPayload: { reason: 'declined' } },
    });
  });
});
