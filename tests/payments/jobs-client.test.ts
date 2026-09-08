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
