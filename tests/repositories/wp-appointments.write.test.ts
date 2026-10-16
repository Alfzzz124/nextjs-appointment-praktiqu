/**
 * The status write's wire contract with the plugin.
 *
 * A paid public booking is created PENDING, which skips `kc_after_create_appointment`
 * and with it KiviCare's booking emails. The plugin sends them on PENDING → BOOKED only
 * when the request carries `payment` — so dropping or renaming that field silently
 * brings back paid sessions that nobody is told about.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const wp = vi.hoisted(() => ({ wpRequestJson: vi.fn() }));
vi.mock('@/lib/wp-endpoint', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/wp-endpoint')>()),
  ...wp,
}));

import { cancelAppointment, setAppointmentStatus } from '@/repositories/wp/appointments.write';

const APPOINTMENT = 3358;

beforeEach(() => {
  vi.clearAllMocks();
  wp.wpRequestJson.mockResolvedValue({ id: APPOINTMENT, status: 1, cancelled: false });
});

describe('setAppointmentStatus', () => {
  it('sends the payment in the snake_case shape the plugin reads', async () => {
    await setAppointmentStatus(APPOINTMENT, 1, { gateway: 'xendit', wcOrderId: 49863, transactionId: 'xnd-tx-1' });

    const [path, init] = wp.wpRequestJson.mock.calls[0];
    expect(path).toBe(`/appointments/${APPOINTMENT}/status`);
    expect(init.method).toBe('POST');
    expect(init.body).toEqual({
      status: 1,
      payment: { gateway: 'xendit', wc_order_id: 49863, transaction_id: 'xnd-tx-1' },
    });
  });

  it('sends an empty transaction id when the order has none yet', async () => {
    await setAppointmentStatus(APPOINTMENT, 1, { gateway: 'paypal', wcOrderId: 7, transactionId: null });

    expect(wp.wpRequestJson.mock.calls[0][1].body.payment.transaction_id).toBe('');
  });

  it('sends no payment for a plain status change, so a staff approval mails nobody', async () => {
    await setAppointmentStatus(APPOINTMENT, 1);

    expect(wp.wpRequestJson.mock.calls[0][1].body).toEqual({ status: 1 });
  });

  it('cancels with 0 and no payment', async () => {
    await cancelAppointment(APPOINTMENT);

    expect(wp.wpRequestJson.mock.calls[0][1].body).toEqual({ status: 0 });
  });
});
