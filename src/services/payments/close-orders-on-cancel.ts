import { prisma } from '@/lib/db';
import { jobs } from '@/lib/jobs/client';
import { logging } from '@/lib/logging';

/**
 * A booking was cancelled: close the WooCommerce order(s) still open for it, so the
 * client's payment link stops working instead of living out its hour. The plugin has no
 * route to cancel an order, only the Action Scheduler job that does, so the job the
 * payment start scheduled for an hour from now is scheduled again for right now.
 *
 * Best effort and never throws: the cancellation already happened and must not fail on
 * this. It also cannot close the gap on its own — WooCommerce still accepts a payment on
 * a cancelled order — which is what applyPaidSideEffectsPublic's refund flag is for.
 */
export async function closeOpenOrdersOnCancel(appointmentId: number): Promise<void> {
  try {
    const orders = await prisma.paymentOrder.findMany({
      where: { appointmentId: String(appointmentId), status: 'pending' },
      select: { wcOrderId: true },
    });
    for (const { wcOrderId } of orders) {
      const scheduled = await jobs.enqueue({
        hook: 'praktiqu_payment_auto_cancel',
        runAt: new Date(),
        args: { wcOrderId },
      });
      if (!scheduled) {
        await logging.warn('Could not schedule the close of an open order for a cancelled booking', {
          resource: 'session',
          resourceId: String(appointmentId),
          metadata: { wcOrderId },
        });
      }
    }
  } catch (err) {
    await logging.error('Could not close the open orders of a cancelled booking', err, {
      resource: 'session',
      resourceId: String(appointmentId),
    });
  }
}
