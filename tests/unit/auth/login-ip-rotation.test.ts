/**
 * Rotating the IP must not buy unlimited password guesses against one account.
 *
 * The login limiter is keyed on `(ip, email)`, and without a vouched IP the IP half is
 * the first X-Forwarded-For entry — which a direct caller writes themselves. A fresh
 * value per attempt meant a fresh tuple per attempt, so the 10-failure lockout never
 * triggered (2026-09-25 FE audit follow-up). The address-only layer closes that.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockPrisma, wpAuthenticate } = vi.hoisted(() => ({
  mockPrisma: {
    user: { findUnique: vi.fn(), upsert: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    refreshToken: { updateMany: vi.fn(), create: vi.fn() },
  },
  wpAuthenticate: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ prisma: mockPrisma }));
vi.mock('@/lib/auth/wp-auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth/wp-auth')>()),
  wpAuthenticate,
}));
vi.mock('@/services/audit', () => ({
  audit: { loginFailure: vi.fn(), loginSuccess: vi.fn(), logout: vi.fn() },
  AuditEventType: { LOGIN_FAILURE: 'LOGIN_FAILURE', LOGIN_SUCCESS: 'LOGIN_SUCCESS' },
}));

import { login, _resetRateLimiterForTests } from '@/services/auth/service';
import { SUBJECT_RATE_LIMIT_CONFIG } from '@/lib/rate-limit';

const attempt = (ip: string, email = 'victim@example.com') => ({
  email,
  password: 'guess',
  ip,
  userAgent: 'vitest',
});

async function codeOf(p: Promise<unknown>): Promise<string> {
  return p.then(
    () => 'ok',
    (e: { code?: string }) => e.code ?? 'unknown',
  );
}

describe('login() — IP rotation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetRateLimiterForTests();
    wpAuthenticate.mockResolvedValue({ ok: false, error: { code: 'invalid_credentials' } });
  });

  it('locks the account once the address-only limit is reached, whatever the IP', async () => {
    const limit = SUBJECT_RATE_LIMIT_CONFIG.lockoutAfter;
    for (let i = 0; i < limit - 1; i++) {
      expect(await codeOf(login(attempt(`198.51.100.${i}`)))).toBe('invalid_credentials');
    }
    // The limit-th failure is the one that trips the lock…
    expect(await codeOf(login(attempt('198.51.100.250')))).toBe('rate_limited');
    // …and a brand-new IP is turned away before WordPress is even asked.
    wpAuthenticate.mockClear();
    expect(await codeOf(login(attempt('203.0.113.99')))).toBe('rate_limited');
    expect(wpAuthenticate).not.toHaveBeenCalled();
  });

  it('does not let one account’s lock spill onto another', async () => {
    for (let i = 0; i < SUBJECT_RATE_LIMIT_CONFIG.lockoutAfter; i++) {
      await codeOf(login(attempt(`198.51.100.${i}`)));
    }
    expect(await codeOf(login(attempt('198.51.100.1', 'someone-else@example.com')))).toBe('invalid_credentials');
  });

  it('keeps the tighter per-(ip, email) lock for a single IP', async () => {
    const codes: string[] = [];
    for (let i = 0; i < 11; i++) codes.push(await codeOf(login(attempt('198.51.100.1'))));
    expect(codes).toContain('rate_limited');
    expect(codes.indexOf('rate_limited')).toBeLessThan(SUBJECT_RATE_LIMIT_CONFIG.lockoutAfter);
  });
});
