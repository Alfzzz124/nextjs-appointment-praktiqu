/**
 * POST /api/v1/auth/reset-password — completing the forgot-password flow.
 *
 * WordPress owns the credential, so `wpChangePassword` is mocked; everything else —
 * token lookup by hash, expiry, single use, session revocation, error mapping — is the
 * code under test.
 *
 * The case worth guarding hardest: a WordPress failure must NOT consume the token.
 * Burning it on a transient error strands the user with a link that no longer works.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { createHash } from 'node:crypto';

// ─── Stubs ────────────────────────────────────────────────────────────────

const mockPrisma = {
  user: { findUnique: vi.fn() },
  passwordResetToken: {
    findUnique: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  refreshToken: { updateMany: vi.fn() },
};
vi.mock('@/lib/db', () => ({ prisma: mockPrisma }));

vi.mock('@/lib/auth/wp-auth', () => ({
  wpAuthenticate: vi.fn(),
  wpChangePassword: vi.fn(),
  wpGetUser: vi.fn(),
  wpLookupByEmail: vi.fn(),
  toUserUpsertData: vi.fn(),
}));

vi.mock('@/services/audit', () => ({
  audit: {
    passwordResetComplete: vi.fn().mockResolvedValue(undefined),
    passwordResetRequest: vi.fn().mockResolvedValue(undefined),
    passwordChange: vi.fn().mockResolvedValue(undefined),
    register: vi.fn().mockResolvedValue(undefined),
    loginSuccess: vi.fn().mockResolvedValue(undefined),
    loginFailure: vi.fn().mockResolvedValue(undefined),
    roleChange: vi.fn().mockResolvedValue(undefined),
  },
}));

const mockLimiter = {
  check: vi.fn().mockReturnValue({ kind: 'allow' }),
  recordFailure: vi.fn(),
  recordSuccess: vi.fn(),
};
vi.mock('@/lib/rate-limit', () => ({
  createRateLimiter: vi.fn(() => mockLimiter),
  DEFAULT_RATE_LIMIT_CONFIG: {},
  tupleKey: vi.fn((a: string, b: string) => `${a}:${b}`),
}));

vi.mock('@/lib/auth/jwt', () => ({
  issueAccessToken: vi.fn(),
  issueRefreshToken: vi.fn(),
  hashToken: vi.fn((t: string) => `hash-${t}`),
  JWT_CONFIG: { accessTokenTtlMs: 3_600_000, refreshTokenTtlMs: 604_800_000 },
  verifyAccessToken: vi.fn(),
}));

// ─── Imports (after mocks) ────────────────────────────────────────────────

const { POST } = await import('@/app/api/v1/auth/reset-password/route');
const { wpChangePassword } = await import('@/lib/auth/wp-auth');

// ─── Fixtures ─────────────────────────────────────────────────────────────

const RAW_TOKEN = 'nHq7Zx2VbK9pQrs1TuvWxYz3AbCdEfGhIjKlMnOpQrs';
const TOKEN_HASH = createHash('sha256').update(RAW_TOKEN).digest('hex');
const NEW_PASSWORD = 'rahasia123';

const USER = {
  id: 'user-1',
  email: 'budi@example.com',
  username: 'budi',
  role: 'CLIENT',
  wpUserId: BigInt(924),
  status: 1,
};

function tokenRow(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'tok-1',
    userId: USER.id,
    tokenHash: TOKEN_HASH,
    expiresAt: new Date(Date.now() + 20 * 60_000),
    usedAt: null,
    ...over,
  };
}

function makeReq(body: unknown) {
  return new NextRequest('http://localhost/api/v1/auth/reset-password', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.9' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockLimiter.check.mockReturnValue({ kind: 'allow' });
  mockPrisma.passwordResetToken.findUnique.mockResolvedValue(tokenRow());
  mockPrisma.passwordResetToken.update.mockResolvedValue({});
  mockPrisma.refreshToken.updateMany.mockResolvedValue({ count: 2 });
  mockPrisma.user.findUnique.mockResolvedValue(USER);
  vi.mocked(wpChangePassword).mockResolvedValue({ ok: true });
});

// ─── Tests ────────────────────────────────────────────────────────────────

describe('POST /api/v1/auth/reset-password', () => {
  it('looks the token up by its hash, never by the raw value', async () => {
    await POST(makeReq({ token: RAW_TOKEN, password: NEW_PASSWORD }));

    expect(mockPrisma.passwordResetToken.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tokenHash: TOKEN_HASH } }),
    );
  });

  it('changes the password in WordPress and answers 200', async () => {
    const res = await POST(makeReq({ token: RAW_TOKEN, password: NEW_PASSWORD }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.message).toMatch(/sign in/i);
    expect(wpChangePassword).toHaveBeenCalledWith(BigInt(924), NEW_PASSWORD);
  });

  it('issues no tokens — the user signs in again', async () => {
    const res = await POST(makeReq({ token: RAW_TOKEN, password: NEW_PASSWORD }));
    const json = await res.json();

    expect(json.accessToken).toBeUndefined();
    expect(json.refreshToken).toBeUndefined();
  });

  it('marks the token used so the link cannot be replayed', async () => {
    await POST(makeReq({ token: RAW_TOKEN, password: NEW_PASSWORD }));

    expect(mockPrisma.passwordResetToken.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'tok-1' },
        data: expect.objectContaining({ usedAt: expect.any(Date) }),
      }),
    );
  });

  it('revokes every active session, because a reset must evict an intruder', async () => {
    await POST(makeReq({ token: RAW_TOKEN, password: NEW_PASSWORD }));

    expect(mockPrisma.refreshToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: 'user-1' }),
        data: expect.objectContaining({ status: 'REVOKED' }),
      }),
    );
  });

  it('rejects an unknown token without calling WordPress', async () => {
    mockPrisma.passwordResetToken.findUnique.mockResolvedValue(null);

    const res = await POST(makeReq({ token: 'not-a-real-token', password: NEW_PASSWORD }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.code).toBe('invalid_token');
    expect(wpChangePassword).not.toHaveBeenCalled();
  });

  it('rejects an expired token', async () => {
    mockPrisma.passwordResetToken.findUnique.mockResolvedValue(
      tokenRow({ expiresAt: new Date(Date.now() - 60_000) }),
    );

    const res = await POST(makeReq({ token: RAW_TOKEN, password: NEW_PASSWORD }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.code).toBe('token_expired');
    expect(wpChangePassword).not.toHaveBeenCalled();
  });

  it('rejects a token that was already used', async () => {
    mockPrisma.passwordResetToken.findUnique.mockResolvedValue(
      tokenRow({ usedAt: new Date(Date.now() - 5 * 60_000) }),
    );

    const res = await POST(makeReq({ token: RAW_TOKEN, password: NEW_PASSWORD }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.code).toBe('token_used');
    expect(wpChangePassword).not.toHaveBeenCalled();
  });

  it('rejects a weak password without consuming the token', async () => {
    const res = await POST(makeReq({ token: RAW_TOKEN, password: 'rahasiabanget' }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.code).toBe('weak_password');
    expect(mockPrisma.passwordResetToken.update).not.toHaveBeenCalled();
  });

  it('rejects a body missing the token', async () => {
    const res = await POST(makeReq({ password: NEW_PASSWORD }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.code).toBe('validation_error');
  });

  it('leaves the token usable when WordPress fails', async () => {
    vi.mocked(wpChangePassword).mockResolvedValue({ ok: false, error: 'service_unavailable' });

    const res = await POST(makeReq({ token: RAW_TOKEN, password: NEW_PASSWORD }));
    const json = await res.json();

    expect(res.status).toBe(503);
    expect(json.code).toBe('service_unavailable');
    // The whole point: a transient WordPress failure must not strand the user with a
    // link that no longer works.
    expect(mockPrisma.passwordResetToken.update).not.toHaveBeenCalled();
    expect(mockPrisma.refreshToken.updateMany).not.toHaveBeenCalled();
  });

  it('treats a user with no WordPress account as service_unavailable', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ ...USER, wpUserId: null });

    const res = await POST(makeReq({ token: RAW_TOKEN, password: NEW_PASSWORD }));

    expect(res.status).toBe(503);
    expect(wpChangePassword).not.toHaveBeenCalled();
  });

  it('returns 429 with Retry-After when the rate limiter locks out', async () => {
    mockLimiter.check.mockReturnValue({ kind: 'lockout', retryAfterMs: 60_000 });

    const res = await POST(makeReq({ token: RAW_TOKEN, password: NEW_PASSWORD }));
    const json = await res.json();

    expect(res.status).toBe(429);
    expect(json.code).toBe('rate_limited');
    expect(res.headers.get('Retry-After')).toBe('60');
    expect(mockPrisma.passwordResetToken.findUnique).not.toHaveBeenCalled();
  });
});
