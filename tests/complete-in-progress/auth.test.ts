/**
 * Integration tests for auth admin routes:
 *   POST /api/v1/auth/register
 *   POST /api/v1/auth/change-password
 *   POST /api/v1/auth/reset-password
 *   DELETE /api/v1/auth/delete-account
 *
 * Uses vi.mock to stub prisma and WP auth so no real DB or WP is required.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SignJWT } from 'jose';
import { NextRequest } from 'next/server';

// ─── Stubs ────────────────────────────────────────────────────────────────

const mockPrisma = {
  user: {
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  refreshToken: {
    updateMany: vi.fn(),
    create: vi.fn().mockResolvedValue({}),
  },
};

vi.mock('@/lib/db', () => ({ prisma: mockPrisma }));

// Stub WP auth so changePassword doesn't need a real WP endpoint
vi.mock('@/lib/auth/wp-auth', () => ({
  wpAuthenticate: vi.fn(),
  wpChangePassword: vi.fn(),
  wpGetUser: vi.fn(),
  wpLookupByEmail: vi.fn(),
  wpRegisterClient: vi.fn(),
  toUserUpsertData: vi.fn(),
}));

// Stub audit so it doesn't hit the DB
vi.mock('@/services/audit', () => ({
  audit: {
    register: vi.fn().mockResolvedValue(undefined),
    passwordChange: vi.fn().mockResolvedValue(undefined),
    login: vi.fn().mockResolvedValue(undefined),
    logout: vi.fn().mockResolvedValue(undefined),
    roleChange: vi.fn().mockResolvedValue(undefined),
  },
}));

// Stub rate limiter
vi.mock('@/lib/rate-limit', () => ({
  createRateLimiter: vi.fn(() => ({
    check: vi.fn().mockReturnValue({ kind: 'allow' }),
    recordFailure: vi.fn(),
    recordSuccess: vi.fn(),
  })),
  DEFAULT_RATE_LIMIT_CONFIG: {},
  tupleKey: vi.fn((a: string, b: string) => `${a}:${b}`),
}));

// Stub JWT issue helpers used by changePassword / issueTokensForUser
vi.mock('@/lib/auth/jwt', () => ({
  issueAccessToken: vi.fn().mockResolvedValue({
    token: 'mock-access-token',
    expiresAt: new Date(Date.now() + 3600000),
  }),
  issueRefreshToken: vi.fn().mockReturnValue({
    token: 'mock-refresh-token',
    tokenHash: 'mock-hash',
    familyId: 'mock-family',
    expiresAt: new Date(Date.now() + 86400000),
  }),
  hashToken: vi.fn((t: string) => `hash-${t}`),
  JWT_CONFIG: { accessTokenTtlMs: 3600000, refreshTokenTtlMs: 86400000 },
  verifyAccessToken: vi.fn(),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────

const JWT_SECRET = new TextEncoder().encode(
  process.env.AUTH_SECRET ?? 'dev-secret-change-me',
);

async function makeToken(role: string, sub: string) {
  return new SignJWT({ role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setExpirationTime('1h')
    .sign(JWT_SECRET);
}

function makeReq(url: string, jwt: string, body?: unknown, method = 'POST') {
  return new NextRequest(`http://localhost${url}`, {
    method,
    headers: {
      authorization: `Bearer ${jwt}`,
      'content-type': 'application/json',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

// ─── Imports (after mocks are set up) ─────────────────────────────────────

const { POST: registerPost } = await import('@/app/api/v1/auth/register/route');
const { POST: changePasswordPost } = await import('@/app/api/v1/auth/change-password/route');
const { POST: resetPasswordPost } = await import('@/app/api/v1/auth/reset-password/route');
const { DELETE: deleteAccountDelete } = await import('@/app/api/v1/auth/delete-account/route');
const { wpAuthenticate, wpChangePassword } = await import('@/lib/auth/wp-auth');

// ─── Tests ────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.refreshToken.updateMany.mockResolvedValue({ count: 0 });
});

// ── POST /auth/register ───────────────────────────────────────────────────

describe('POST /api/v1/auth/register', () => {
  it('returns 201 with user data when SUPER_ADMIN registers a new user', async () => {
    const jwt = await makeToken('SUPER_ADMIN', 'admin-id');
    mockPrisma.user.findUnique.mockResolvedValue(null); // no duplicate
    mockPrisma.user.create.mockResolvedValue({
      id: 'new-user-id',
      email: 'newdoc@example.com',
      role: 'PROFESSIONAL',
    });

    const res = await registerPost(
      makeReq('/api/v1/auth/register', jwt, {
        email: 'newdoc@example.com',
        firstName: 'Jane',
        lastName: 'Doe',
        role: 'PROFESSIONAL',
      }),
      { params: Promise.resolve({}) },
    );

    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.data).toHaveProperty('id', 'new-user-id');
    expect(json.data).toHaveProperty('email', 'newdoc@example.com');
  });

  it('returns 403 when a non-admin tries to register a user', async () => {
    const jwt = await makeToken('RECEPTIONIST', 'recep-id');

    const res = await registerPost(
      makeReq('/api/v1/auth/register', jwt, {
        email: 'hack@example.com',
        firstName: 'Hack',
        lastName: 'Er',
        role: 'CLIENT',
      }),
      { params: Promise.resolve({}) },
    );

    expect(res.status).toBe(403);
  });

  it('returns 409 when email already registered', async () => {
    const jwt = await makeToken('SUPER_ADMIN', 'admin-id');
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'existing', email: 'taken@example.com' });

    const res = await registerPost(
      makeReq('/api/v1/auth/register', jwt, {
        email: 'taken@example.com',
        firstName: 'Al',
        lastName: 'Ready',
        role: 'CLIENT',
      }),
      { params: Promise.resolve({}) },
    );

    expect(res.status).toBe(409);
  });

  it('returns 400 for invalid body (missing required fields)', async () => {
    const jwt = await makeToken('SUPER_ADMIN', 'admin-id');

    const res = await registerPost(
      makeReq('/api/v1/auth/register', jwt, { email: 'not-an-email' }),
      { params: Promise.resolve({}) },
    );

    expect(res.status).toBe(400);
  });
});

// ── POST /auth/change-password ────────────────────────────────────────────

describe('POST /api/v1/auth/change-password', () => {
  it('returns 200 with tokens when currentPassword is correct', async () => {
    const jwt = await makeToken('PROFESSIONAL', 'user-abc');
    const mockUser = {
      id: 'user-abc',
      email: 'prof@example.com',
      wpUserId: BigInt(42),
      status: 1,
      role: 'PROFESSIONAL',
      username: 'prof',
      firstName: 'P',
      lastName: 'R',
      displayName: 'PR',
    };
    mockPrisma.user.findUnique.mockResolvedValue(mockUser);
    (wpAuthenticate as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      user: { wpUserId: BigInt(42) },
    });
    (wpChangePassword as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });

    const res = await changePasswordPost(
      makeReq('/api/v1/auth/change-password', jwt, {
        currentPassword: 'OldPass1',
        newPassword: 'NewPass12345',
      }),
      { params: Promise.resolve({}) },
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toHaveProperty('data');
  });

  it('returns 400 when currentPassword is wrong', async () => {
    const jwt = await makeToken('PROFESSIONAL', 'user-abc');
    const mockUser = {
      id: 'user-abc',
      email: 'prof@example.com',
      wpUserId: BigInt(42),
      status: 1,
    };
    mockPrisma.user.findUnique.mockResolvedValue(mockUser);
    // WP auth fails (wrong password)
    (wpAuthenticate as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
    });

    const res = await changePasswordPost(
      makeReq('/api/v1/auth/change-password', jwt, {
        currentPassword: 'WrongPass1',
        newPassword: 'NewPass12345',
      }),
      { params: Promise.resolve({}) },
    );

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.code).toBe('invalid_credentials');
  });
});

// ── POST /auth/reset-password ─────────────────────────────────────────────

describe('POST /api/v1/auth/reset-password', () => {
  it('returns 501 Not Implemented', async () => {
    const res = await resetPasswordPost();
    expect(res.status).toBe(501);
    const json = await res.json();
    expect(json.code).toBe('NOT_IMPLEMENTED');
  });
});

// ── DELETE /auth/delete-account ───────────────────────────────────────────

describe('DELETE /api/v1/auth/delete-account', () => {
  it('returns 200 when user deletes themselves', async () => {
    const jwt = await makeToken('CLIENT', 'self-user-id');
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'self-user-id', status: 1 });
    mockPrisma.user.update.mockResolvedValue({ id: 'self-user-id', status: 0 });

    const res = await deleteAccountDelete(
      new NextRequest('http://localhost/api/v1/auth/delete-account', {
        method: 'DELETE',
        headers: { authorization: `Bearer ${jwt}` },
      }),
      { params: Promise.resolve({}) },
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.deleted).toBe(true);
    expect(json.data.userId).toBe('self-user-id');
  });

  it('returns 200 when SUPER_ADMIN deletes another user', async () => {
    const jwt = await makeToken('SUPER_ADMIN', 'admin-id');
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'target-user-id', status: 1 });
    mockPrisma.user.update.mockResolvedValue({ id: 'target-user-id', status: 0 });

    const res = await deleteAccountDelete(
      new NextRequest('http://localhost/api/v1/auth/delete-account', {
        method: 'DELETE',
        headers: {
          authorization: `Bearer ${jwt}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ userId: 'target-user-id' }),
      }),
      { params: Promise.resolve({}) },
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.userId).toBe('target-user-id');
  });

  it('returns 404 when target user does not exist', async () => {
    const jwt = await makeToken('SUPER_ADMIN', 'admin-id');
    mockPrisma.user.findUnique.mockResolvedValue(null);

    const res = await deleteAccountDelete(
      new NextRequest('http://localhost/api/v1/auth/delete-account', {
        method: 'DELETE',
        headers: {
          authorization: `Bearer ${jwt}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ userId: 'ghost-id' }),
      }),
      { params: Promise.resolve({}) },
    );

    expect(res.status).toBe(404);
  });
});
