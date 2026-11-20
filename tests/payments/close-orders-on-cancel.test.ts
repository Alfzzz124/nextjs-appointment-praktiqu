/**
 * Cancelling a booking closes the WooCommerce order(s) still open for it.
 *
 * Until now the cancel paths only touched the appointment, so the client's payment link
 * stayed live until the hourly auto-cancel — and a payment made in that window landed on
 * a booking that no longer existed. The close is the existing 'praktiqu_payment_auto_cancel'
 * job, run now. It is best effort: it never fails the cancellation.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ paymentOrder: { findMany: vi.fn() } }));
vi.mock('@/lib/db', () => ({ prisma: db }));

const jobsClient = vi.hoisted(() => ({ jobs: { enqueue: vi.fn(), cancel: vi.fn() } }));
vi.mock('@/lib/jobs/client', () => jobsClient);

const log = vi.hoisted(() => ({
  logging: { audit: vi.fn(), warn: vi.fn(), error: vi.fn(), activity: vi.fn(), system: vi.fn() },
}));
vi.mock('@/lib/logging', () => log);

import { closeOpenOrdersOnCancel } from '@/services/payments/close-orders-on-cancel';

beforeEach(() => {
  vi.clearAllMocks();
  jobsClient.jobs.enqueue.mockResolvedValue(true);
});

describe('closeOpenOrdersOnCancel', () => {
  it('schedules the auto-cancel job now for each pending order of the booking', async () => {
    db.paymentOrder.findMany.mockResolvedValue([{ wcOrderId: 9001 }, { wcOrderId: 9002 }]);
    const before = Date.now();

    await closeOpenOrdersOnCancel(5150);

    // Only orders that are still pending, looked up by the id carried as text.
    expect(db.paymentOrder.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { appointmentId: '5150', status: 'pending' } }),
    );
    expect(jobsClient.jobs.enqueue).toHaveBeenCalledTimes(2);
    const calls = jobsClient.jobs.enqueue.mock.calls.map((c) => c[0]);
    expect(calls.map((c) => c.args)).toEqual([{ wcOrderId: 9001 }, { wcOrderId: 9002 }]);
    for (const c of calls) {
      expect(c.hook).toBe('praktiqu_payment_auto_cancel');
      expect(c.runAt.getTime()).toBeGreaterThanOrEqual(before);
      expect(c.runAt.getTime()).toBeLessThanOrEqual(Date.now());
    }
  });

  it('schedules nothing when the booking has no pending order', async () => {
    db.paymentOrder.findMany.mockResolvedValue([]);

    await closeOpenOrdersOnCancel(5150);

    expect(jobsClient.jobs.enqueue).not.toHaveBeenCalled();
  });

  it('never throws when the lookup fails, and logs it', async () => {
    db.paymentOrder.findMany.mockRejectedValue(new Error('db down'));

    await expect(closeOpenOrdersOnCancel(5150)).resolves.toBeUndefined();

    expect(log.logging.error).toHaveBeenCalled();
  });

  it('keeps going and logs when one job is not accepted', async () => {
    db.paymentOrder.findMany.mockResolvedValue([{ wcOrderId: 9001 }, { wcOrderId: 9002 }]);
    jobsClient.jobs.enqueue.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    await expect(closeOpenOrdersOnCancel(5150)).resolves.toBeUndefined();

    expect(jobsClient.jobs.enqueue).toHaveBeenCalledTimes(2);
    expect(log.logging.warn).toHaveBeenCalledTimes(1);
  });
});
