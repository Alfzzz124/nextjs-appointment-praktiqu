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

describe('wp-endpoint — international charge and WordPress error codes', () => {
  const OLD_ENV = process.env;
  beforeEach(() => {
    process.env = { ...OLD_ENV, WORDPRESS_URL: 'http://wp.test', WORDPRESS_SERVICE_TOKEN: 'tok' };
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    process.env = OLD_ENV;
    vi.unstubAllGlobals();
  });

  async function quoteCharge(fee: number | null) {
    const { buildUsdQuote, parseStoredOption, resolveSettings, toCharge } = await import('@/services/payments/intl-pricing');
    const settings = resolveSettings(
      4,
      parseStoredOption(JSON.stringify({ international: true, fx_rate: 18000, markup_percent: 10, fixed_fee_idr: fee })),
      { fxRate: null, markupPercent: null },
    );
    return toCharge(buildUsdQuote([{ name: 'Konsultasi', price: 200000 }], [], settings)!);
  }

  it('serialises charge with string amounts, the fee line and the snapshot', async () => {
    (fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ orderId: 42, checkoutUrl: 'https://paypal.com/x', chargedAmount: 13.62, chargedCurrency: 'USD', fxRate: 16363.64 }),
    });
    const { createWcOrder } = await import('@/lib/wp-endpoint');
    await createWcOrder({
      source: 'public', customerName: 'A', customerEmail: 'a@x.com',
      items: [{ name: 'Konsultasi', price: 200000 }], taxes: [],
      returnUrl: 'https://app/success', cancelUrl: 'https://app/cancel',
      method: 'paypal', charge: await quoteCharge(25000),
    });
    const body = JSON.parse((fetch as any).mock.calls[0][1].body);
    expect(body.items).toEqual([{ name: 'Konsultasi', price: 200000 }]);
    expect(body.charge).toEqual({
      currency: 'USD',
      items: [{ name: 'Konsultasi', amount: '12.23' }],
      taxes: [],
      fee: { name: 'International service fee', amount: '1.39' },
      total: '13.62',
      snapshot: {
        clinicId: 4, fxRate: '18000', markupPercent: '10', fixedFeeIdr: '25000',
        source: { fxRate: 'clinic', markupPercent: 'clinic', fixedFeeIdr: 'clinic' },
      },
    });
  });

  it('leaves fee out of the serialised charge when there is none', async () => {
    (fetch as any).mockResolvedValue({ ok: true, json: async () => ({ orderId: 42, checkoutUrl: 'u' }) });
    const { createWcOrder } = await import('@/lib/wp-endpoint');
    await createWcOrder({
      source: 'public', customerName: 'A', customerEmail: 'a@x.com',
      items: [{ name: 'Konsultasi', price: 200000 }], taxes: [],
      returnUrl: 'x', cancelUrl: 'y', method: 'paypal', charge: await quoteCharge(null),
    });
    const body = JSON.parse((fetch as any).mock.calls[0][1].body);
    expect(body.charge).not.toHaveProperty('fee');
    expect(body.charge.total).toBe('12.23');
  });

  it('sends no charge key for a plain xendit order', async () => {
    (fetch as any).mockResolvedValue({ ok: true, json: async () => ({ orderId: 7, checkoutUrl: 'u' }) });
    const { createWcOrder } = await import('@/lib/wp-endpoint');
    await createWcOrder({
      source: 'public', customerName: 'A', customerEmail: 'a@x.com',
      items: [{ name: 'Svc', price: 100000 }], taxes: [], returnUrl: 'x', cancelUrl: 'y',
    });
    expect(JSON.parse((fetch as any).mock.calls[0][1].body)).not.toHaveProperty('charge');
  });

  it('createWcOrder parses the WordPress error body into WpEndpointError.code', async () => {
    (fetch as any).mockResolvedValue({
      ok: false, status: 502, statusText: 'Bad Gateway',
      text: async () => JSON.stringify({ code: 'charge_mismatch', message: 'Order total 13.61 != 13.62', data: { status: 502 } }),
    });
    const { createWcOrder, WpEndpointError } = await import('@/lib/wp-endpoint');
    const err = await createWcOrder({
      source: 'public', customerName: 'A', customerEmail: 'a@x.com',
      items: [], taxes: [], returnUrl: 'x', cancelUrl: 'y',
    }).catch((e) => e);
    expect(err).toBeInstanceOf(WpEndpointError);
    expect(err.status).toBe(502);
    expect(err.code).toBe('charge_mismatch');
  });

  it('createWcOrder leaves code undefined when the error body is not JSON', async () => {
    (fetch as any).mockResolvedValue({ ok: false, status: 500, statusText: 'Internal Server Error', text: async () => '<html>fatal</html>' });
    const { createWcOrder } = await import('@/lib/wp-endpoint');
    const err = await createWcOrder({
      source: 'public', customerName: 'A', customerEmail: 'a@x.com',
      items: [], taxes: [], returnUrl: 'x', cancelUrl: 'y',
    }).catch((e) => e);
    expect(err.status).toBe(500);
    expect(err.code).toBeUndefined();
  });

  it('wpRequestJson parses the WordPress error body into code and keeps the message', async () => {
    (fetch as any).mockResolvedValue({
      ok: false, status: 422, statusText: 'Unprocessable Entity',
      text: async () => JSON.stringify({ code: 'fx_rate_required', message: 'A usable rate is required', data: { status: 422 } }),
    });
    const { wpRequestJson } = await import('@/lib/wp-endpoint');
    const err: any = await wpRequestJson('/clinics/4/payment-settings', { method: 'PUT', body: {} }).catch((e) => e);
    expect(err.status).toBe(422);
    expect(err.code).toBe('fx_rate_required');
    expect(err.message).toBe('/clinics/4/payment-settings failed 422: A usable rate is required');
  });

  it('putClinicPaymentSettings PUTs the snake_case body to the plugin route', async () => {
    (fetch as any).mockResolvedValue({
      ok: true, status: 200,
      text: async () => JSON.stringify({ clinicId: 4, settings: { international: true } }),
    });
    const { putClinicPaymentSettings } = await import('@/lib/wp-endpoint');
    await putClinicPaymentSettings(4, {
      international: true, fx_rate: 16500, markup_percent: 10, fixed_fee_idr: 25000, updated_by: 123,
    });
    const [url, opts] = (fetch as any).mock.calls[0];
    expect(url).toBe('http://wp.test/wp-json/praktiqu/v1/clinics/4/payment-settings');
    expect(opts.method).toBe('PUT');
    expect(opts.headers['X-PraktiQU-Service-Token']).toBe('tok');
    expect(JSON.parse(opts.body)).toEqual({
      international: true, fx_rate: 16500, markup_percent: 10, fixed_fee_idr: 25000, updated_by: 123,
    });
  });

  it('putClinicPaymentSettings surfaces the plugin code on failure', async () => {
    (fetch as any).mockResolvedValue({
      ok: false, status: 404, statusText: 'Not Found',
      text: async () => JSON.stringify({ code: 'clinic_not_found', message: 'No such clinic', data: { status: 404 } }),
    });
    const { putClinicPaymentSettings } = await import('@/lib/wp-endpoint');
    await expect(putClinicPaymentSettings(999, {
      international: false, fx_rate: null, markup_percent: null, fixed_fee_idr: null, updated_by: null,
    })).rejects.toMatchObject({ status: 404, code: 'clinic_not_found' });
  });
});
