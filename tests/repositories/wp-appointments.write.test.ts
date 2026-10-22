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

import { WpEndpointError } from '@/lib/wp-endpoint';
import {
  cancelAppointment,
  isStatusConflict,
  rescheduleAppointment,
  setAppointmentStatus,
} from '@/repositories/wp/appointments.write';

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

  it('sends expect_status only when asked, for a compare-and-set (plugin 1.8.4)', async () => {
    await setAppointmentStatus(APPOINTMENT, 1, { gateway: 'xendit', wcOrderId: 49863, transactionId: 'xnd-tx-1' }, { expectStatus: 2 });
    await setAppointmentStatus(APPOINTMENT, 1, undefined, { expectStatus: 2 });

    expect(wp.wpRequestJson.mock.calls[0][1].body).toEqual({
      status: 1,
      payment: { gateway: 'xendit', wc_order_id: 49863, transaction_id: 'xnd-tx-1' },
      expect_status: 2,
    });
    expect(wp.wpRequestJson.mock.calls[1][1].body).toEqual({ status: 1, expect_status: 2 });
  });

  it('cancels with 0 and no payment', async () => {
    await cancelAppointment(APPOINTMENT);

    expect(wp.wpRequestJson.mock.calls[0][1].body).toEqual({ status: 0 });
  });
});

describe('isStatusConflict', () => {
  it("recognises the plugin's 409 for a row that no longer has the expected status", () => {
    expect(isStatusConflict(new WpEndpointError('x', 409, 'praktiqu_status_conflict'))).toBe(true);
    expect(isStatusConflict(new WpEndpointError('x', 500, 'praktiqu_status_update_failed'))).toBe(false);
    expect(isStatusConflict(new WpEndpointError('x', 409))).toBe(false);
    expect(isStatusConflict(new Error('praktiqu_status_conflict'))).toBe(false);
  });
});

describe('rescheduleAppointment', () => {
  const EXPECTED = {
    doctorId: 34,
    clinicId: 3,
    status: 1,
    startDate: '2026-10-21',
    startTime: '09:00:00',
    endDate: '2026-10-21',
    endTime: '10:00:00',
  };

  it("sends the new slot and the row as it was read, in the plugin's snake_case (1.8.6)", async () => {
    wp.wpRequestJson.mockResolvedValue({
      id: APPOINTMENT,
      start_date: '2026-10-22',
      start_time: '10:00:00',
      end_date: '2026-10-22',
      end_time: '11:00:00',
      previous: { start_date: '2026-10-21', start_time: '09:00:00', end_time: '10:00:00' },
      sync: { outbox_id: 5, ok: true, meeting_url: null },
    });

    const moved = await rescheduleAppointment(APPOINTMENT, {
      startDate: '2026-10-22',
      startTime: '10:00:00',
      expected: EXPECTED,
      actor: 'wpu_24',
      requestId: 'req-1',
    });

    const [path, init] = wp.wpRequestJson.mock.calls[0];
    expect(path).toBe(`/appointments/${APPOINTMENT}/reschedule`);
    expect(init.method).toBe('POST');
    expect(init.body).toEqual({
      start_date: '2026-10-22',
      start_time: '10:00:00',
      expected: {
        doctor_id: 34,
        clinic_id: 3,
        status: 1,
        start_date: '2026-10-21',
        start_time: '09:00:00',
        end_date: '2026-10-21',
        end_time: '10:00:00',
      },
      actor: 'wpu_24',
      request_id: 'req-1',
    });
    expect(moved).toEqual({
      id: APPOINTMENT,
      startDate: '2026-10-22',
      startTime: '10:00:00',
      endTime: '11:00:00',
      syncOk: true,
      meetingUrl: null,
    });
  });

  it('reports a failed calendar step and the current meeting link', async () => {
    wp.wpRequestJson.mockResolvedValue({
      id: APPOINTMENT,
      start_date: '2026-10-22',
      start_time: '10:00:00',
      end_date: '2026-10-22',
      end_time: '11:00:00',
      sync: { outbox_id: 5, ok: false, error: 'meet_update_failed', meeting_url: 'https://meet.google.com/abc' },
    });

    const moved = await rescheduleAppointment(APPOINTMENT, {
      startDate: '2026-10-22',
      startTime: '10:00:00',
      expected: EXPECTED,
      actor: 'wpu_24',
      requestId: 'req-1',
    });

    expect(moved.syncOk).toBe(false);
    expect(moved.meetingUrl).toBe('https://meet.google.com/abc');
  });
});
