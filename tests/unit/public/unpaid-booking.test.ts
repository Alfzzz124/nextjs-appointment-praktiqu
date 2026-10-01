/**
 * Releasing a guest booking nobody paid for.
 *
 * A PENDING booking blocks its slot, and the payment auto-cancel only exists once a
 * payment starts, so a guest who closed the tab before checkout held the slot forever.
 * The release job fixes that, and its guards are what keep it from touching anything
 * else: a payment in progress, a paid booking, a confirmed or cancelled one.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Stands in for payment_orders. `findFirst` applies the handler's real `where` to these
// rows, so the test pins which statuses count as "being paid", not just that the
// handler obeys whatever a stub returns.
const db = vi.hoisted(() => {
  const orders: { appointmentId: string; status: string; wcOrderId: number }[] = [];
  const findFirst = vi.fn(async (q: { where: { appointmentId: string; status: { in: string[] } } }) => {
    return (
      orders.find(
        (o) => o.appointmentId === q.where.appointmentId && q.where.status.in.includes(o.status),
      ) ?? null
    );
  });
  return { orders, prisma: { paymentOrder: { findFirst } } };
});
vi.mock('@/lib/db', () => ({ prisma: db.prisma }));

const repo = vi.hoisted(() => ({ findSessionById: vi.fn() }));
vi.mock('@/repositories/wp/sessions.repo', async (orig) => ({
  ...(await orig<typeof import('@/repositories/wp/sessions.repo')>()),
  findSessionById: (...a: unknown[]) => repo.findSessionById(...a),
}));

const write = vi.hoisted(() => ({
  cancelAppointment: vi.fn().mockResolvedValue({ id: 0, status: 0, cancelled: true }),
  setAppointmentStatus: vi.fn(),
  createAppointment: vi.fn(),
}));
vi.mock('@/repositories/wp/appointments.write', () => write);

const jobsClient = vi.hoisted(() => ({ jobs: { enqueue: vi.fn(), cancel: vi.fn() } }));
vi.mock('@/lib/jobs/client', () => jobsClient);

const log = vi.hoisted(() => ({
  logging: { audit: vi.fn(), warn: vi.fn(), error: vi.fn(), activity: vi.fn(), system: vi.fn() },
}));
vi.mock('@/lib/logging', () => log);

import { SESSION_STATUS, type SessionStatus } from '@/repositories/wp/sessions.repo';
import {
  handleUnpaidBookingCancel,
  scheduleUnpaidBookingCancel,
  unpaidBookingTtlMinutes,
  UNPAID_CANCEL_HOOK,
} from '@/services/public/unpaid-booking';

const APPT = 8_750_001;

function row(status: SessionStatus) {
  return { id: APPT, status };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.orders.length = 0;
  repo.findSessionById.mockResolvedValue(row(SESSION_STATUS.PENDING));
  delete process.env.PUBLIC_BOOKING_UNPAID_TTL_MINUTES;
});

afterEach(() => {
  delete process.env.PUBLIC_BOOKING_UNPAID_TTL_MINUTES;
});

describe('handleUnpaidBookingCancel', () => {
  it('cancels a booking that is still PENDING and has no payment order', async () => {
    await handleUnpaidBookingCancel({ appointmentId: APPT });

    expect(repo.findSessionById).toHaveBeenCalledWith(APPT);
    expect(write.cancelAppointment).toHaveBeenCalledWith(APPT);
  });

  it('cancels when every payment order is over (failed / expired / cancelled)', async () => {
    db.orders.push(
      { appointmentId: String(APPT), status: 'failed', wcOrderId: 1 },
      { appointmentId: String(APPT), status: 'expired', wcOrderId: 2 },
      { appointmentId: String(APPT), status: 'cancelled', wcOrderId: 3 },
    );

    await handleUnpaidBookingCancel({ appointmentId: APPT });

    expect(write.cancelAppointment).toHaveBeenCalledWith(APPT);
  });

  it('accepts the id as a numeric string, as it may arrive from WordPress', async () => {
    await handleUnpaidBookingCancel({ appointmentId: String(APPT) });

    expect(repo.findSessionById).toHaveBeenCalledWith(APPT);
    expect(write.cancelAppointment).toHaveBeenCalledWith(APPT);
  });

  it('leaves a PENDING booking alone while a payment is in progress', async () => {
    db.orders.push({ appointmentId: String(APPT), status: 'pending', wcOrderId: 41 });

    await handleUnpaidBookingCancel({ appointmentId: APPT });

    expect(write.cancelAppointment).not.toHaveBeenCalled();
  });

  it('never touches a PENDING booking that has a paid order, even behind a newer failed one', async () => {
    db.orders.push(
      { appointmentId: String(APPT), status: 'failed', wcOrderId: 43 },
      { appointmentId: String(APPT), status: 'paid', wcOrderId: 42 },
    );

    await handleUnpaidBookingCancel({ appointmentId: APPT });

    expect(write.cancelAppointment).not.toHaveBeenCalled();
  });

  it('ignores another appointment’s payment orders', async () => {
    db.orders.push({ appointmentId: String(APPT + 1), status: 'paid', wcOrderId: 44 });

    await handleUnpaidBookingCancel({ appointmentId: APPT });

    expect(write.cancelAppointment).toHaveBeenCalledWith(APPT);
  });

  it.each([
    SESSION_STATUS.BOOKED,
    SESSION_STATUS.CANCELLED,
    SESSION_STATUS.CHECK_IN,
    SESSION_STATUS.CHECK_OUT,
  ])('leaves a %s booking alone', async (status) => {
    repo.findSessionById.mockResolvedValue(row(status));

    await handleUnpaidBookingCancel({ appointmentId: APPT });

    expect(write.cancelAppointment).not.toHaveBeenCalled();
    expect(db.prisma.paymentOrder.findFirst).not.toHaveBeenCalled();
  });

  it('does nothing when the appointment no longer exists', async () => {
    repo.findSessionById.mockResolvedValue(null);

    await handleUnpaidBookingCancel({ appointmentId: APPT });

    expect(write.cancelAppointment).not.toHaveBeenCalled();
    expect(log.logging.warn).toHaveBeenCalled();
  });

  it.each([undefined, null, 'abc', 0, -5, 1.5])('refuses appointmentId %j without a lookup', async (bad) => {
    await handleUnpaidBookingCancel({ appointmentId: bad });

    expect(repo.findSessionById).not.toHaveBeenCalled();
    expect(write.cancelAppointment).not.toHaveBeenCalled();
  });
});

describe('scheduleUnpaidBookingCancel', () => {
  const NOW = new Date('2026-09-30T03:00:00.000Z');

  it('enqueues the release an hour out by default, with OBJECT args', async () => {
    await scheduleUnpaidBookingCancel(APPT, NOW);

    expect(jobsClient.jobs.enqueue).toHaveBeenCalledTimes(1);
    const call = jobsClient.jobs.enqueue.mock.calls[0][0];
    expect(call.hook).toBe(UNPAID_CANCEL_HOOK);
    expect(call.hook).toBe('praktiqu_booking_unpaid_cancel');
    expect(call.runAt.toISOString()).toBe('2026-09-30T04:00:00.000Z');
    // An array here is what once got every enqueue rejected by the plugin's schema.
    expect(Array.isArray(call.args)).toBe(false);
    expect(call.args).toEqual({ appointmentId: APPT });
  });

  it('honours PUBLIC_BOOKING_UNPAID_TTL_MINUTES', async () => {
    process.env.PUBLIC_BOOKING_UNPAID_TTL_MINUTES = '15';

    await scheduleUnpaidBookingCancel(APPT, NOW);

    expect(jobsClient.jobs.enqueue.mock.calls[0][0].runAt.toISOString()).toBe(
      '2026-09-30T03:15:00.000Z',
    );
  });

  it('schedules nothing when the TTL is 0', async () => {
    process.env.PUBLIC_BOOKING_UNPAID_TTL_MINUTES = '0';

    await scheduleUnpaidBookingCancel(APPT, NOW);

    expect(jobsClient.jobs.enqueue).not.toHaveBeenCalled();
  });

  it('never throws, even when enqueue does', async () => {
    jobsClient.jobs.enqueue.mockRejectedValueOnce(new Error('WordPress down'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(scheduleUnpaidBookingCancel(APPT, NOW)).resolves.toBeUndefined();

    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('unpaidBookingTtlMinutes', () => {
  it.each([
    [undefined, 60],
    ['', 60],
    ['90', 90],
    ['0', 0],
  ])('reads %j as %d', (raw, expected) => {
    if (raw === undefined) delete process.env.PUBLIC_BOOKING_UNPAID_TTL_MINUTES;
    else process.env.PUBLIC_BOOKING_UNPAID_TTL_MINUTES = raw;

    expect(unpaidBookingTtlMinutes()).toBe(expected);
  });

  it.each(['abc', '-10', 'Infinity'])(
    'falls back to the default for %j rather than silently switching the release off',
    (raw) => {
      process.env.PUBLIC_BOOKING_UNPAID_TTL_MINUTES = raw;
      const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      expect(unpaidBookingTtlMinutes()).toBe(60);

      spy.mockRestore();
    },
  );
});
