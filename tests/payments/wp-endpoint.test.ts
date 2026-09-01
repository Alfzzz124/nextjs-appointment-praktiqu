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
    expect(result).toEqual({
      orderId: 7, checkoutUrl: 'https://wp.test/checkout/7',
      chargedAmount: null, chargedCurrency: 'IDR', fxRate: null,
    });
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
    expect(result).toEqual({ orderId: 7, status: 'processing', isPaid: true, transactionId: 'tx-1', amount: 100000, currency: 'IDR' });
    expect((fetch as any).mock.calls[0][0]).toBe('http://wp.test/wp-json/praktiqu/v1/payments/order/7');
  });

  it('createWcOrder throws WpEndpointError when WORDPRESS_SERVICE_TOKEN is not set', async () => {
    process.env.WORDPRESS_SERVICE_TOKEN = '';
    const { createWcOrder, WpEndpointError } = await import('@/lib/wp-endpoint');
    await expect(createWcOrder({
      source: 'public', customerName: 'A', customerEmail: 'a@x.com',
      items: [], taxes: [], returnUrl: 'x', cancelUrl: 'y',
    })).rejects.toThrow(WpEndpointError);
  });

  it('createWcOrder forwards the method in the request body', async () => {
    (fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        orderId: 42, checkoutUrl: 'https://paypal.com/checkout/abc',
        chargedAmount: 11.12, chargedCurrency: 'USD', fxRate: 18000,
      }),
    });
    const { createWcOrder } = await import('@/lib/wp-endpoint');
    await createWcOrder({
      source: 'public', customerName: 'A', customerEmail: 'a@x.com',
      items: [{ name: 'Svc', price: 200000 }], taxes: [],
      returnUrl: 'https://app/success', cancelUrl: 'https://app/cancel',
      method: 'paypal',
    });
    const body = JSON.parse((fetch as any).mock.calls[0][1].body);
    expect(body.method).toBe('paypal');
  });

  it('createWcOrder returns the charged figures the plugin reports', async () => {
    (fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        orderId: 42, checkoutUrl: 'https://paypal.com/checkout/abc',
        chargedAmount: 11.12, chargedCurrency: 'USD', fxRate: 18000,
      }),
    });
    const { createWcOrder } = await import('@/lib/wp-endpoint');
    const result = await createWcOrder({
      source: 'public', customerName: 'A', customerEmail: 'a@x.com',
      items: [{ name: 'Svc', price: 200000 }], taxes: [],
      returnUrl: 'https://app/success', cancelUrl: 'https://app/cancel',
      method: 'paypal',
    });
    expect(result).toEqual({
      orderId: 42, checkoutUrl: 'https://paypal.com/checkout/abc',
      chargedAmount: 11.12, chargedCurrency: 'USD', fxRate: 18000,
    });
  });

  it('createWcOrder falls back to IDR when the plugin omits the charged figures', async () => {
    // A plugin still on 1.4.0 returns only orderId and checkoutUrl. A .next-only
    // deploy can put a new app in front of an old plugin, and undefined must not
    // reach the database as NaN.
    (fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ orderId: 7, checkoutUrl: 'https://wp.test/checkout/7' }),
    });
    const { createWcOrder } = await import('@/lib/wp-endpoint');
    const result = await createWcOrder({
      source: 'public', customerName: 'A', customerEmail: 'a@x.com',
      items: [{ name: 'Svc', price: 200000 }], taxes: [],
      returnUrl: 'https://app/success', cancelUrl: 'https://app/cancel',
    });
    expect(result.chargedCurrency).toBe('IDR');
    expect(result.fxRate).toBeNull();
    // Null, not 0: the service substitutes the rupiah expectedAmount for null,
    // while a 0 would be stored as a genuine charge of nothing.
    expect(result.chargedAmount).toBeNull();
  });

  it('getWcOrderStatus reports USD when the plugin sends it', async () => {
    (fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        orderId: 42, status: 'processing', isPaid: true,
        transactionId: 'PP-1', amount: 11.12, currency: 'USD',
      }),
    });
    const { getWcOrderStatus } = await import('@/lib/wp-endpoint');
    const status = await getWcOrderStatus(42);
    expect(status.currency).toBe('USD');
    expect(status.amount).toBe(11.12);
  });

  it('getWcOrderStatus defaults the currency to IDR when absent', async () => {
    (fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        orderId: 43, status: 'processing', isPaid: true,
        transactionId: 'X-1', amount: 200000,
      }),
    });
    const { getWcOrderStatus } = await import('@/lib/wp-endpoint');
    const status = await getWcOrderStatus(43);
    expect(status.currency).toBe('IDR');
  });
});
