/**
 * Two gaps in what `login()` records, both found while diagnosing a staging
 * login report on 2026-09-12:
 *
 *  1. Every non-`blocked` failure was audited as `invalid_credentials`, so a
 *     WordPress outage looked identical to a mistyped password — exactly the
 *     distinction the audit log exists to make.
 *  2. The rate-limit pre-check threw before `audit.loginFailure()` ran, so a
 *     locked-out attempt left no trace at all.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.mock is hoisted above module scope, so the doubles have to be too.
const { mockPrisma, wpAuthenticate, loginFailure } = vi.hoisted(() => ({
  mockPrisma: {
    user: { findUnique: vi.fn(), upsert: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    refreshToken: { updateMany: vi.fn(), create: vi.fn() },
  },
  wpAuthenticate: vi.fn(),
  loginFailure: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ prisma: mockPrisma }));

vi.mock('@/lib/auth/wp-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/wp-auth')>();
  return { ...actual, wpAuthenticate };
});

vi.mock('@/services/audit', () => ({
  audit: {
    loginFailure,
    loginSuccess: vi.fn(),
    logout: vi.fn(),
  },
  AuditEventType: { LOGIN_FAILURE: 'LOGIN_FAILURE', LOGIN_SUCCESS: 'LOGIN_SUCCESS' },
}));

import { login, _resetRateLimiterForTests } from '@/services/auth/service';

const attempt = (email = 'staff@example.com') => ({
  email,
  password: 'whatever',
  ip: '203.0.113.7',
  userAgent: 'vitest',
});

describe('login() failure auditing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loginFailure.mockResolvedValue(undefined);
    mockPrisma.refreshToken.create.mockResolvedValue({});
    _resetRateLimiterForTests();
  });

  it('records a WordPress outage as service_unavailable, not a bad password', async () => {
    wpAuthenticate.mockResolvedValue({ ok: false, error: { code: 'service_unavailable' } });

    await expect(login(attempt())).rejects.toThrow();

    expect(loginFailure).toHaveBeenCalledTimes(1);
    expect(loginFailure.mock.calls[0][0]).toMatchObject({ reason: 'service_unavailable' });
  });

  it('records an unreachable WordPress as network_error, not a bad password', async () => {
    wpAuthenticate.mockResolvedValue({ ok: false, error: { code: 'network_error' } });

    await expect(login(attempt())).rejects.toThrow();

    expect(loginFailure.mock.calls[0][0]).toMatchObject({ reason: 'network_error' });
  });

  it('still records a genuinely wrong password as invalid_credentials', async () => {
    wpAuthenticate.mockResolvedValue({ ok: false, error: { code: 'invalid_credentials' } });

    await expect(login(attempt())).rejects.toThrow();

    expect(loginFailure.mock.calls[0][0]).toMatchObject({ reason: 'invalid_credentials' });
  });

  it('records the attempt that the rate limiter turns away', async () => {
    wpAuthenticate.mockResolvedValue({ ok: false, error: { code: 'invalid_credentials' } });

    // Drive the (ip, email) tuple into hard lockout: 10 failures in the window.
    for (let i = 0; i < 10; i++) {
      await expect(login(attempt())).rejects.toThrow();
    }
    const beforeBlocked = loginFailure.mock.calls.length;

    // This one never reaches WordPress — the pre-check turns it away.
    await expect(login(attempt())).rejects.toThrow();

    expect(loginFailure.mock.calls.length).toBe(beforeBlocked + 1);
    expect(loginFailure.mock.calls.at(-1)![0]).toMatchObject({ reason: 'rate_limited' });
  });
});
