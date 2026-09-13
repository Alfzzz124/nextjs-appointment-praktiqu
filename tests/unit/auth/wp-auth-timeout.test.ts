/**
 * `withTimeout` in src/lib/auth/wp-auth.ts builds an AbortController and calls
 * `ctrl.abort()` on a timer, but never hands `ctrl.signal` to `fetch`. The abort
 * therefore does nothing and a hung WordPress keeps the request alive well past
 * the 5s budget. Measured on staging 2026-09-12: login round-trips of 3-10s.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('wpAuthenticate timeout', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.WORDPRESS_SERVICE_TOKEN = 'test-token';
    process.env.WORDPRESS_URL = 'http://wp.test';
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('gives up on a WordPress call that never responds', async () => {
    vi.useFakeTimers();

    // A WordPress that hangs forever, and only settles if the caller aborts it.
    const fetchMock = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
          );
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { wpAuthenticate } = await import('@/lib/auth/wp-auth');
    const pending = wpAuthenticate('someone@example.com', 'secret');

    await vi.advanceTimersByTimeAsync(5_000);

    await expect(pending).resolves.toEqual({
      ok: false,
      error: { code: 'network_error' },
    });
  }, 10_000);
});
