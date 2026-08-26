/**
 * What happens when WordPress does not answer at all.
 *
 * Distinct from WordPress answering badly. `fetch` rejects with a plain `TypeError`
 * when the request never lands — connection refused, reset mid-flight, DNS failure,
 * connect timeout — and a `TypeError` is not a `WpEndpointError`, so before `wpFetch`
 * it slipped past every `instanceof` check in this codebase and surfaced as a bare 500
 * with no code and no Retry-After.
 *
 * That is exactly backwards. No answer at all is the most transient failure there is
 * and the one most worth retrying, so it must be the easiest to recognise, not the
 * hardest. Status 0 is the marker: no HTTP response ever existed, as opposed to any
 * status WordPress could actually have sent.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  WpEndpointError,
  WpConfigError,
  wpRequestJson,
  createWcOrder,
  getWcOrderStatus,
} from '@/lib/wp-endpoint';

const realFetch = globalThis.fetch;

/** What undici throws when the connection never completes. */
function connectionFailure(code: string): TypeError {
  return Object.assign(new TypeError('fetch failed'), { cause: new Error(code) });
}

beforeEach(() => {
  process.env.WORDPRESS_SERVICE_TOKEN = 'test-token';
});

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

describe('wpFetch — WordPress unreachable', () => {
  it('turns a connection failure into a WpEndpointError of status 0', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(connectionFailure('ECONNREFUSED')) as never;

    await expect(wpRequestJson('/patients/461', { method: 'PUT', body: {} }))
      .rejects.toBeInstanceOf(WpEndpointError);
    await expect(wpRequestJson('/patients/461', { method: 'PUT', body: {} }))
      .rejects.toMatchObject({ status: 0 });
  });

  it('keeps the underlying reason, which is the only clue an operator gets', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(connectionFailure('ECONNRESET')) as never;

    await expect(wpRequestJson('/appointments', { method: 'POST', body: {} }))
      .rejects.toThrow(/ECONNRESET/);
  });

  it('names the path, never the WordPress host', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(connectionFailure('EAI_AGAIN')) as never;

    // These messages reach clients through client.service.ts and friends. Which
    // internal host we talk to is not a caller's business.
    const err = await wpRequestJson('/patients/461').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WpEndpointError);
    const { message } = err as WpEndpointError;
    expect(message).toContain('/patients/461');
    expect(message).not.toContain('wp-json');
    expect(message).not.toContain('http');
  });

  it('stays distinct from a status WordPress could really send', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response('{"message":"Service Unavailable"}', { status: 503 }),
    ) as never;

    // 503 means WordPress was there and said no. 0 means it was not there at all, and
    // a caller deciding whether to offer a retry needs to tell those apart.
    await expect(wpRequestJson('/patients/461')).rejects.toMatchObject({ status: 503 });
  });

  it('does not disguise a missing service token as an unreachable host', async () => {
    delete process.env.WORDPRESS_SERVICE_TOKEN;
    globalThis.fetch = vi.fn().mockRejectedValue(connectionFailure('ECONNREFUSED')) as never;

    // The token is read while building the request, so it throws before fetch is even
    // called. A deploy that cannot work is not a bad minute, and must not collect a
    // Retry-After on the way out.
    await expect(wpRequestJson('/patients/461')).rejects.toBeInstanceOf(WpConfigError);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('covers the payment bridge too, not just the JSON client', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(connectionFailure('ECONNREFUSED')) as never;

    await expect(
      createWcOrder({
        source: 'public', customerName: 'Budi', customerEmail: 'budi@test.local',
        items: [], taxes: [], returnUrl: 'https://x/ok', cancelUrl: 'https://x/no',
      }),
    ).rejects.toMatchObject({ status: 0 });

    await expect(getWcOrderStatus(42)).rejects.toMatchObject({ status: 0 });
  });
});
