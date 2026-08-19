/**
 * POST /api/v1/auth/otp/verify — the HTTP shell around verifyOtp.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/services/auth/otp.service', () => ({ verifyOtp: vi.fn() }));

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

const { POST } = await import('@/app/api/v1/auth/otp/verify/route');
const { verifyOtp } = await import('@/services/auth/otp.service');
const { AuthError } = await import('@/services/auth/service');

const SESSION = {
  user: {
    id: 'user-1',
    email: 'budi@example.com',
    username: 'budi',
    firstName: 'Budi',
    lastName: 'Santoso',
    displayName: 'Budi Santoso',
    role: 'CLIENT',
    // BigInt on purpose: JSON.stringify throws on it, so the route must convert.
    wpUserId: BigInt(924),
  },
  accessToken: 'mock-access-token',
  accessTokenExpiresAt: new Date('2026-08-18T01:00:00.000Z'),
  refreshToken: 'mock-refresh-token',
  refreshTokenExpiresAt: new Date('2026-08-25T00:00:00.000Z'),
};

function makeReq(body: unknown) {
  return new NextRequest('http://localhost/api/v1/auth/otp/verify', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.9' },
    body: JSON.stringify(body),
  });
}

const BODY = { email: 'budi@example.com', code: '418902' };

beforeEach(() => {
  vi.clearAllMocks();
  mockLimiter.check.mockReturnValue({ kind: 'allow' });
  vi.mocked(verifyOtp).mockResolvedValue(SESSION as never);
});

describe('POST /api/v1/auth/otp/verify', () => {
  it('returns 200 with the same body shape as /auth/login', async () => {
    const res = await POST(makeReq(BODY));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toMatchObject({
      accessToken: 'mock-access-token',
      refreshToken: 'mock-refresh-token',
      user: { id: 'user-1', role: 'CLIENT', wpUserId: 924 },
    });
    expect(typeof json.accessTokenExpiresAt).toBe('string');
  });

  it('rejects a code that is not six digits before calling the service', async () => {
    const res = await POST(makeReq({ ...BODY, code: '12ab' }));

    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('validation_error');
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it('maps invalid_code to 400', async () => {
    vi.mocked(verifyOtp).mockRejectedValue(new AuthError('invalid_code', 400, 'nope'));

    const res = await POST(makeReq(BODY));

    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('invalid_code');
  });

  it('maps code_expired to 400', async () => {
    vi.mocked(verifyOtp).mockRejectedValue(new AuthError('code_expired', 400, 'expired'));

    const res = await POST(makeReq(BODY));

    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('code_expired');
  });

  it('maps too_many_attempts to 400', async () => {
    vi.mocked(verifyOtp).mockRejectedValue(new AuthError('too_many_attempts', 400, 'burned'));

    const res = await POST(makeReq(BODY));

    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('too_many_attempts');
  });

  it('maps account_inactive to 403', async () => {
    vi.mocked(verifyOtp).mockRejectedValue(new AuthError('account_inactive', 403, 'inactive'));

    const res = await POST(makeReq(BODY));

    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('account_inactive');
  });

  it('returns 429 with Retry-After when guessing is locked out', async () => {
    mockLimiter.check.mockReturnValue({ kind: 'lockout', retryAfterMs: 300_000 });

    const res = await POST(makeReq(BODY));

    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('300');
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it('counts a failed attempt and clears the count on success', async () => {
    vi.mocked(verifyOtp).mockRejectedValue(new AuthError('invalid_code', 400, 'nope'));
    await POST(makeReq(BODY));
    expect(mockLimiter.recordFailure).toHaveBeenCalled();

    vi.clearAllMocks();
    mockLimiter.check.mockReturnValue({ kind: 'allow' });
    vi.mocked(verifyOtp).mockResolvedValue(SESSION as never);
    await POST(makeReq(BODY));
    expect(mockLimiter.recordSuccess).toHaveBeenCalled();
  });

  it('returns 429 with Retry-After on a progressive_delay verdict, without calling verifyOtp', async () => {
    mockLimiter.check.mockReturnValue({ kind: 'progressive_delay', delayMs: 30_000 });

    const res = await POST(makeReq(BODY));

    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('30');
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it('answers an unexpected non-AuthError failure with a problem+json 500 that hides the error message', async () => {
    vi.mocked(verifyOtp).mockRejectedValue(new Error('column "foo" does not exist'));

    const res = await POST(makeReq(BODY));
    const text = await res.text();

    expect(res.status).toBe(500);
    expect(res.headers.get('content-type')).toBe('application/problem+json');
    expect(JSON.parse(text).code).toEqual(expect.any(String));
    expect(text).not.toContain('column "foo" does not exist');
  });
});
