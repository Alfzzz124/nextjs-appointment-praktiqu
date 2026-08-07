/**
 * POST /api/v1/auth/forgot-password — rate limiting.
 *
 * The endpoint had none, so anyone could hammer it: it mails a stranger's inbox on
 * demand, and because each request invalidates the previous token, repeated calls also
 * keep breaking whatever link the victim is trying to use.
 *
 * The no-enumeration guarantee must survive the limiter — the answer is `200` whether or
 * not the address is registered.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ─── Stubs ────────────────────────────────────────────────────────────────

const mockPrisma = {
  user: { findUnique: vi.fn(), upsert: vi.fn() },
  passwordResetToken: { updateMany: vi.fn(), create: vi.fn() },
};
vi.mock('@/lib/db', () => ({ prisma: mockPrisma }));

vi.mock('@/lib/auth/wp-auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth/wp-auth')>()),
  wpLookupByEmail: vi.fn(),
}));

vi.mock('@/lib/email', () => ({
  sendEmail: vi.fn().mockResolvedValue({ ok: true }),
  buildPasswordResetEmail: vi.fn(() => ({
    subject: 'Reset your PraktiQU password',
    html: '<p>link</p>',
    text: 'link',
  })),
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

// ─── Imports (after mocks) ────────────────────────────────────────────────

const { POST } = await import('@/app/api/v1/auth/forgot-password/route');
const { sendEmail } = await import('@/lib/email');
const { tupleKey } = await import('@/lib/rate-limit');
const { wpLookupByEmail } = await import('@/lib/auth/wp-auth');

const USER = { id: 'user-1', email: 'budi@example.com' };

/** What the plugin returns for someone who has a WordPress account but has never
 *  logged into the app — the state 789 of 850 staging users are in. */
const WP_ONLY = {
  wpUserId: BigInt(310),
  email: 'lama@example.com',
  username: 'lama',
  displayName: 'Pasien Lama',
  firstName: 'Pasien',
  lastName: 'Lama',
  roles: ['kiviCare_patient'],
  status: 'active' as const,
};

function makeReq(email: unknown) {
  return new NextRequest('http://localhost/api/v1/auth/forgot-password', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.9' },
    body: JSON.stringify({ email }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockLimiter.check.mockReturnValue({ kind: 'allow' });
  mockPrisma.user.findUnique.mockResolvedValue(USER);
  mockPrisma.passwordResetToken.updateMany.mockResolvedValue({ count: 0 });
  mockPrisma.passwordResetToken.create.mockResolvedValue({});
  mockPrisma.user.upsert.mockResolvedValue({ id: 'user-lama', email: WP_ONLY.email });
  vi.mocked(wpLookupByEmail).mockResolvedValue(null);
});

// ─── Tests ────────────────────────────────────────────────────────────────

describe('POST /api/v1/auth/forgot-password', () => {
  it('sends a reset email for a known address', async () => {
    const res = await POST(makeReq('budi@example.com'));

    expect(res.status).toBe(200);
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'budi@example.com' }));
  });

  it('rate-limits per IP and email pair', async () => {
    await POST(makeReq('budi@example.com'));

    expect(tupleKey).toHaveBeenCalledWith('203.0.113.9', 'budi@example.com');
    expect(mockLimiter.check).toHaveBeenCalled();
  });

  it('returns 429 with Retry-After once locked out, mailing nobody', async () => {
    mockLimiter.check.mockReturnValue({ kind: 'lockout', retryAfterMs: 60_000 });

    const res = await POST(makeReq('budi@example.com'));
    const json = await res.json();

    expect(res.status).toBe(429);
    expect(json.code).toBe('rate_limited');
    expect(res.headers.get('Retry-After')).toBe('60');
    expect(sendEmail).not.toHaveBeenCalled();
    expect(mockPrisma.passwordResetToken.create).not.toHaveBeenCalled();
  });

  it('still answers 200 for an unknown address, so emails cannot be enumerated', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);

    const res = await POST(makeReq('nobody@example.com'));

    expect(res.status).toBe(200);
    expect(sendEmail).not.toHaveBeenCalled();
    expect(mockPrisma.passwordResetToken.create).not.toHaveBeenCalled();
  });

  it('counts an unknown address as a failure, so the limiter sees probing', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);

    await POST(makeReq('nobody@example.com'));

    expect(mockLimiter.recordFailure).toHaveBeenCalled();
  });

  // A WordPress account with no app row is the normal state for anyone who has only
  // ever booked as a guest — 789 of 850 users on staging. Looking only at the app table
  // means the reset silently does nothing for them.
  it('falls back to WordPress when the app has no row for that address', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    vi.mocked(wpLookupByEmail).mockResolvedValue(WP_ONLY);

    const res = await POST(makeReq(WP_ONLY.email));

    expect(res.status).toBe(200);
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: WP_ONLY.email }));
  });

  it('creates the app row linked to the WordPress id before issuing a token', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    vi.mocked(wpLookupByEmail).mockResolvedValue(WP_ONLY);

    await POST(makeReq(WP_ONLY.email));

    expect(mockPrisma.user.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { wpUserId: BigInt(310) } }),
    );
    expect(mockPrisma.passwordResetToken.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: 'user-lama' }) }),
    );
  });

  it('sends nothing when neither the app nor WordPress knows the address', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    vi.mocked(wpLookupByEmail).mockResolvedValue(null);

    const res = await POST(makeReq('hantu@example.com'));

    expect(res.status).toBe(200);
    expect(sendEmail).not.toHaveBeenCalled();
    expect(mockPrisma.user.upsert).not.toHaveBeenCalled();
  });

  it('rejects a malformed email with 400', async () => {
    const res = await POST(makeReq('not-an-email'));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.code).toBe('validation_error');
  });
});
