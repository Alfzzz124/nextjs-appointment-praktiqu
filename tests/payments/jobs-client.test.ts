import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('jobs client — praktiqu_payment_auto_cancel', () => {
  const OLD_ENV = process.env;
  beforeEach(() => {
    process.env = { ...OLD_ENV, WORDPRESS_URL: 'http://wp.test', WORDPRESS_SERVICE_TOKEN: 'tok' };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
  });
  afterEach(() => {
    process.env = OLD_ENV;
    vi.unstubAllGlobals();
  });

  it('enqueue accepts the payment auto-cancel hook with matching args for later cancel()', async () => {
    const { jobs } = await import('@/lib/jobs/client');
    await jobs.enqueue({ hook: 'praktiqu_payment_auto_cancel', runAt: new Date('2026-07-14T13:00:00Z'), args: { wcOrderId: 42 } });
    await jobs.cancel({ hook: 'praktiqu_payment_auto_cancel', args: { wcOrderId: 42 } });

    const [enqueueCall, cancelCall] = (fetch as any).mock.calls;
    expect(JSON.parse(enqueueCall[1].body).args).toEqual({ wcOrderId: 42 });
    expect(JSON.parse(cancelCall[1].body).args).toEqual({ wcOrderId: 42 });
  });

  it('enqueue and cancel serialize args identically for the same hook + args', async () => {
    // The idempotency of `jobs.cancel` depends on Action Scheduler's unschedule matching
    // on the exact `args` string. If `enqueue` and `cancel` ever build that object
    // differently — e.g. one of them spreads in an extra field the other doesn't — a
    // cancel would silently stop matching the action it enqueued, producing both
    // duplicate reminders and reminders that outlive a cancellation.
    const { jobs } = await import('@/lib/jobs/client');
    const args = { sessionId: 7, channel: 'email_24h' };

    await jobs.enqueue({ hook: 'praktiqu_session_send_reminder', runAt: new Date('2026-07-14T13:00:00Z'), args });
    await jobs.cancel({ hook: 'praktiqu_session_send_reminder', args });

    const [enqueueCall, cancelCall] = (fetch as any).mock.calls;
    const enqueueArgs = JSON.parse(enqueueCall[1].body).args;
    const cancelArgs = JSON.parse(cancelCall[1].body).args;
    expect(JSON.stringify(enqueueArgs)).toBe(JSON.stringify(cancelArgs));
    expect(enqueueArgs).toEqual(args);
  });

  it('enqueue resolves rather than rejecting when fetch rejects with a network-style error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    const { jobs } = await import('@/lib/jobs/client');

    await expect(
      jobs.enqueue({ hook: 'praktiqu_payment_auto_cancel', runAt: new Date('2026-07-14T13:00:00Z'), args: { wcOrderId: 42 } })
    ).resolves.toBeUndefined();
  });

  it('enqueue resolves rather than rejecting when fetch resolves with a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' }));
    const { jobs } = await import('@/lib/jobs/client');

    await expect(
      jobs.enqueue({ hook: 'praktiqu_payment_auto_cancel', runAt: new Date('2026-07-14T13:00:00Z'), args: { wcOrderId: 42 } })
    ).resolves.toBeUndefined();
  });
});
