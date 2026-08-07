/**
 * POST /api/v1/public/auth/register — patient self-registration.
 *
 * The WordPress write goes through the `praktiqu-endpoint` plugin, which a unit test
 * cannot reach, so `createPatient` is mocked. Everything else — password rules, the
 * duplicate check, token issuance, error mapping — is the code under test.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ─── Stubs ────────────────────────────────────────────────────────────────

const mockPrisma = {
  user: {
    findUnique: vi.fn(),
    upsert: vi.fn(),
  },
  refreshToken: {
    create: vi.fn().mockResolvedValue({}),
  },
};
vi.mock('@/lib/db', () => ({ prisma: mockPrisma }));

vi.mock('@/repositories/wp/patients.write', () => ({
  createPatient: vi.fn(),
  updatePatient: vi.fn(),
}));

vi.mock('@/services/audit', () => ({
  audit: {
    register: vi.fn().mockResolvedValue(undefined),
    loginSuccess: vi.fn().mockResolvedValue(undefined),
    loginFailure: vi.fn().mockResolvedValue(undefined),
    passwordChange: vi.fn().mockResolvedValue(undefined),
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
  issueAccessToken: vi.fn().mockResolvedValue({
    token: 'mock-access-token',
    expiresAt: new Date('2026-08-06T01:00:00.000Z'),
  }),
  issueRefreshToken: vi.fn().mockReturnValue({
    token: 'mock-refresh-token',
    tokenHash: 'mock-hash',
    familyId: 'mock-family',
    expiresAt: new Date('2026-08-13T00:00:00.000Z'),
  }),
  hashToken: vi.fn((t: string) => `hash-${t}`),
  JWT_CONFIG: { accessTokenTtlMs: 3_600_000, refreshTokenTtlMs: 604_800_000 },
  verifyAccessToken: vi.fn(),
}));

// ─── Imports (after mocks) ────────────────────────────────────────────────

const { POST } = await import('@/app/api/v1/public/auth/register/route');
const { createPatient } = await import('@/repositories/wp/patients.write');
const { WpEndpointError } = await import('@/lib/wp-endpoint');

// ─── Helpers ──────────────────────────────────────────────────────────────

const BODY = {
  email: 'Budi@Example.com',
  password: 'rahasia123',
  firstName: 'Budi',
  lastName: 'Santoso',
  contactNumber: '081234567890',
};

const WP_PATIENT = {
  id: 501,
  email: 'budi@example.com',
  username: 'budi',
  firstName: 'Budi',
  lastName: 'Santoso',
  contactNumber: '081234567890',
  patientUniqueId: 'PAT-501',
};

const PRISMA_USER = {
  id: 'user-1',
  email: 'budi@example.com',
  username: 'budi',
  firstName: 'Budi',
  lastName: 'Santoso',
  displayName: 'Budi Santoso',
  role: 'CLIENT',
  // BigInt on purpose: JSON.stringify throws on it, so the route must convert.
  wpUserId: BigInt(501),
  status: 1,
};

function makeReq(body: unknown) {
  return new NextRequest('http://localhost/api/v1/public/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.9' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockLimiter.check.mockReturnValue({ kind: 'allow' });
  mockPrisma.user.findUnique.mockResolvedValue(null);
  mockPrisma.user.upsert.mockResolvedValue(PRISMA_USER);
  mockPrisma.refreshToken.create.mockResolvedValue({});
  vi.mocked(createPatient).mockResolvedValue(WP_PATIENT);
});

// ─── Tests ────────────────────────────────────────────────────────────────

describe('POST /api/v1/public/auth/register', () => {
  it('creates the WordPress patient with the submitted password and phone number', async () => {
    await POST(makeReq(BODY));

    expect(createPatient).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'budi@example.com',
        password: 'rahasia123',
        firstName: 'Budi',
        lastName: 'Santoso',
        contactNumber: '081234567890',
      }),
    );
  });

  it('links the PraktiQU user row to the wp_users id the plugin returned', async () => {
    await POST(makeReq(BODY));

    expect(mockPrisma.user.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { wpUserId: BigInt(501) } }),
    );
  });

  it('returns 201 with a usable session', async () => {
    const res = await POST(makeReq(BODY));
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json).toMatchObject({
      userId: 'user-1',
      accessToken: 'mock-access-token',
      refreshToken: 'mock-refresh-token',
      user: { id: 'user-1', email: 'budi@example.com', role: 'CLIENT', wpUserId: 501 },
    });
  });

  it('registers without a phone number', async () => {
    const { contactNumber: _omitted, ...noPhone } = BODY;
    const res = await POST(makeReq(noPhone));

    expect(res.status).toBe(201);
    expect(createPatient).toHaveBeenCalledWith(
      expect.not.objectContaining({ contactNumber: expect.anything() }),
    );
  });

  it('rejects a password with no digits as 400 weak_password', async () => {
    const res = await POST(makeReq({ ...BODY, password: 'rahasiabanget' }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.code).toBe('weak_password');
    expect(createPatient).not.toHaveBeenCalled();
  });

  it('rejects a malformed email as 400 validation_error', async () => {
    const res = await POST(makeReq({ ...BODY, email: 'not-an-email' }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.code).toBe('validation_error');
    expect(createPatient).not.toHaveBeenCalled();
  });

  it('returns 409 when the email already has a PraktiQU account', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'existing' });

    const res = await POST(makeReq(BODY));
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.code).toBe('duplicate_email');
    expect(createPatient).not.toHaveBeenCalled();
  });

  it('returns 409 when WordPress reports the email taken', async () => {
    vi.mocked(createPatient).mockRejectedValue(
      new WpEndpointError('That email is already registered.', 409),
    );

    const res = await POST(makeReq(BODY));
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.code).toBe('duplicate_email');
    // Whose account it is — patient, doctor, admin — is not a stranger's business.
    expect(JSON.stringify(json)).not.toMatch(/doctor|admin/i);
  });

  it('returns 503 when WordPress is unreachable', async () => {
    vi.mocked(createPatient).mockRejectedValue(new WpEndpointError('boom', 500));

    const res = await POST(makeReq(BODY));
    const json = await res.json();

    expect(res.status).toBe(503);
    expect(json.code).toBe('service_unavailable');
    expect(mockPrisma.user.upsert).not.toHaveBeenCalled();
  });

  it('returns 429 with Retry-After when the rate limiter locks out', async () => {
    mockLimiter.check.mockReturnValue({ kind: 'lockout', retryAfterMs: 60_000 });

    const res = await POST(makeReq(BODY));
    const json = await res.json();

    expect(res.status).toBe(429);
    expect(json.code).toBe('rate_limited');
    expect(res.headers.get('Retry-After')).toBe('60');
    expect(createPatient).not.toHaveBeenCalled();
  });
});
