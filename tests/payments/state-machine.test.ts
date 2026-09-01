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
        gateway: 'xendit', chargedAmount: 100000, chargedCurrency: 'IDR', fxRate: null,
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

describe('markPaid — currency-aware amount check', () => {
  it('accepts a USD payment that matches the stored charge', async () => {
    mockPrisma.paymentOrder.findUnique.mockResolvedValue({
      wcOrderId: 42,
      status: 'pending',
      expectedAmount: 200000,
      chargedAmount: 11.12,
      chargedCurrency: 'USD',
      source: 'public',
    } as any);
    mockPrisma.paymentOrder.updateMany.mockResolvedValue({ count: 1 } as any);

    await expect(
      markPaid({ wcOrderId: 42, amountPaid: 11.12, currency: 'USD', transactionId: 'PP-1', webhookPayload: {} }),
    ).resolves.not.toThrow();
  });

  it('rejects a USD payment short by more than a cent', async () => {
    mockPrisma.paymentOrder.findUnique.mockResolvedValue({
      wcOrderId: 42,
      status: 'pending',
      expectedAmount: 200000,
      chargedAmount: 11.12,
      chargedCurrency: 'USD',
      source: 'public',
    } as any);

    await expect(
      markPaid({ wcOrderId: 42, amountPaid: 10.0, currency: 'USD', transactionId: 'PP-1', webhookPayload: {} }),
    ).rejects.toThrow(AmountMismatchError);
  });

  it('does not compare a USD payment against the rupiah expectedAmount', async () => {
    // The bug this guards: for this same USD row, a webhook that reports the
    // rupiah `expectedAmount` (200000) as the paid amount must be REJECTED —
    // if the comparand ever regressed to `expectedAmount` instead of the
    // stored `chargedAmount` (11.12), this would wrongly be accepted.
    mockPrisma.paymentOrder.findUnique.mockResolvedValue({
      wcOrderId: 42,
      status: 'pending',
      expectedAmount: 200000,
      chargedAmount: 11.12,
      chargedCurrency: 'USD',
      source: 'public',
    } as any);

    await expect(
      markPaid({ wcOrderId: 42, amountPaid: 200000, currency: 'USD', transactionId: 'PP-1', webhookPayload: {} }),
    ).rejects.toThrow(AmountMismatchError);
  });

  it('keeps the rupiah tolerance for an IDR order', async () => {
    mockPrisma.paymentOrder.findUnique.mockResolvedValue({
      wcOrderId: 43,
      status: 'pending',
      expectedAmount: 200000,
      chargedAmount: 200000,
      chargedCurrency: 'IDR',
      source: 'public',
    } as any);
    mockPrisma.paymentOrder.updateMany.mockResolvedValue({ count: 1 } as any);

    // Within ±2 rupiah: accepted, exactly as before this change.
    await expect(
      markPaid({ wcOrderId: 43, amountPaid: 199999, transactionId: 'X-1', webhookPayload: {} }),
    ).resolves.not.toThrow();
  });

  it('treats a missing currency as IDR, so a pre-1.5.0 plugin still works', async () => {
    mockPrisma.paymentOrder.findUnique.mockResolvedValue({
      wcOrderId: 43,
      status: 'pending',
      expectedAmount: 200000,
      chargedAmount: null,
      chargedCurrency: 'IDR',
      source: 'public',
    } as any);
    mockPrisma.paymentOrder.updateMany.mockResolvedValue({ count: 1 } as any);

    await expect(
      markPaid({ wcOrderId: 43, amountPaid: 200000, transactionId: 'X-1', webhookPayload: {} }),
    ).resolves.not.toThrow();
  });

  it('uses the stored currency, not the webhook-reported one, when the row has no recorded charge', async () => {
    // Anomalous state: chargedAmount is null (predates the column, so
    // chargedView falls back to the rupiah expectedAmount) but the webhook
    // claims USD. The comparand can only ever be the rupiah expectedAmount
    // here, so the stored IDR currency must govern the comparison. amountPaid
    // is 1 rupiah off expectedAmount — inside the ±2 rupiah tolerance but
    // well outside the ±0.01 dollar tolerance, so this only passes if the
    // IDR tolerance is actually the one applied. If `currency` regressed to
    // `input.currency ?? chargedCurrency`, this would compare against the
    // ±0.01 dollar tolerance and produce a false AmountMismatchError,
    // wrongly leaving a genuinely-paid order pending.
    mockPrisma.paymentOrder.findUnique.mockResolvedValue({
      wcOrderId: 44,
      status: 'pending',
      expectedAmount: 200000,
      chargedAmount: null,
      chargedCurrency: 'IDR',
      source: 'public',
    } as any);
    mockPrisma.paymentOrder.updateMany.mockResolvedValue({ count: 1 } as any);

    await expect(
      markPaid({ wcOrderId: 44, amountPaid: 199999, currency: 'USD', transactionId: 'PP-2', webhookPayload: {} }),
    ).resolves.not.toThrow();
  });
});
