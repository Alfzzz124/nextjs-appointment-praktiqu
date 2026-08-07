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
  user: { findUnique: vi.fn() },
  passwordResetToken: { updateMany: vi.fn(), create: vi.fn() },
};
vi.mock('@/lib/db', () => ({ prisma: mockPrisma }));

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

const USER = { id: 'user-1', email: 'budi@example.com' };

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

  it('rejects a malformed email with 400', async () => {
    const res = await POST(makeReq('not-an-email'));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.code).toBe('validation_error');
  });
});
