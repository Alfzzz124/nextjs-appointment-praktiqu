import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('wp-endpoint payments client', () => {
  const OLD_ENV = process.env;
  beforeEach(() => {
    process.env = { ...OLD_ENV, WORDPRESS_URL: 'http://wp.test', WORDPRESS_SERVICE_TOKEN: 'tok' };
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    process.env = OLD_ENV;
    vi.unstubAllGlobals();
  });

  it('createWcOrder posts to /payments/order with the service token header', async () => {
    (fetch as any).mockResolvedValue({ ok: true, json: async () => ({ orderId: 7, checkoutUrl: 'https://wp.test/checkout/7' }) });
    const { createWcOrder } = await import('@/lib/wp-endpoint');
    const result = await createWcOrder({
      source: 'public', customerName: 'A', customerEmail: 'a@x.com',
      items: [{ name: 'Svc', price: 100000 }], taxes: [],
      returnUrl: 'https://app/success', cancelUrl: 'https://app/cancel',
    });
    expect(result).toEqual({ orderId: 7, checkoutUrl: 'https://wp.test/checkout/7' });
    const [url, opts] = (fetch as any).mock.calls[0];
    expect(url).toBe('http://wp.test/wp-json/praktiqu/v1/payments/order');
    expect(opts.headers['X-PraktiQU-Service-Token']).toBe('tok');
  });

  it('createWcOrder throws WpEndpointError on a non-ok response', async () => {
    (fetch as any).mockResolvedValue({ ok: false, status: 503, statusText: 'Service Unavailable', text: async () => 'down' });
    const { createWcOrder, WpEndpointError } = await import('@/lib/wp-endpoint');
    await expect(createWcOrder({
      source: 'public', customerName: 'A', customerEmail: 'a@x.com',
      items: [], taxes: [], returnUrl: 'x', cancelUrl: 'y',
    })).rejects.toThrow(WpEndpointError);
  });

  it('getWcOrderStatus GETs /payments/order/{id}', async () => {
    (fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ orderId: 7, status: 'processing', isPaid: true, transactionId: 'tx-1', amount: 100000 }),
    });
    const { getWcOrderStatus } = await import('@/lib/wp-endpoint');
    const result = await getWcOrderStatus(7);
    expect(result).toEqual({ orderId: 7, status: 'processing', isPaid: true, transactionId: 'tx-1', amount: 100000 });
    expect((fetch as any).mock.calls[0][0]).toBe('http://wp.test/wp-json/praktiqu/v1/payments/order/7');
  });
});
