/**
 * POST /api/v1/auth/otp/request — the HTTP shell around requestOtp.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/services/auth/otp.service', () => ({
  requestOtp: vi.fn().mockResolvedValue({ retryAfterSeconds: 60 }),
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

const { POST } = await import('@/app/api/v1/auth/otp/request/route');
const { requestOtp } = await import('@/services/auth/otp.service');

function makeReq(body: unknown) {
  return new NextRequest('http://localhost/api/v1/auth/otp/request', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.9' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockLimiter.check.mockReturnValue({ kind: 'allow' });
  vi.mocked(requestOtp).mockResolvedValue({ retryAfterSeconds: 60 });
});

describe('POST /api/v1/auth/otp/request', () => {
  it('returns 200 with the countdown the front-end needs', async () => {
    const res = await POST(makeReq({ email: 'budi@example.com' }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.retryAfter).toBe(60);
    expect(typeof json.message).toBe('string');
  });

  it('answers an unknown address exactly like a known one', async () => {
    // Drive the two calls through genuinely different service outcomes: the
    // "known" address resolves as if a code was actually mailed, the
    // "unknown" one resolves with the cooldown-style value a not-found
    // address might get internally. The route must still produce
    // indistinguishable responses either way.
    vi.mocked(requestOtp).mockImplementation(async ({ email }: { email: string }) => {
      return email === 'budi@example.com'
        ? { retryAfterSeconds: 60 }
        : { retryAfterSeconds: 60, cooldown: true };
    });

    const knownRes = await POST(makeReq({ email: 'budi@example.com' }));
    const knownJson = await knownRes.json();

    const unknownRes = await POST(makeReq({ email: 'hantu@example.com' }));
    const unknownJson = await unknownRes.json();

    expect(knownRes.status).toBe(unknownRes.status);
    expect(knownJson).toEqual(unknownJson);
    expect(knownRes.headers.get('content-type')).toBe(unknownRes.headers.get('content-type'));
    expect(knownRes.headers.get('Retry-After')).toBe(unknownRes.headers.get('Retry-After'));

    expect(knownRes.status).toBe(200);
    expect(knownJson).toEqual({
      message: expect.any(String),
      retryAfter: 60,
    });
  });

  it('rejects a malformed email with 400', async () => {
    const res = await POST(makeReq({ email: 'bukan-email' }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.code).toBe('validation_error');
    expect(requestOtp).not.toHaveBeenCalled();
  });

  it('rejects a body that is not JSON with 400', async () => {
    const req = new NextRequest('http://localhost/api/v1/auth/otp/request', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'bukan json',
    });

    const res = await POST(req);

    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('invalid_body');
  });

  it('returns 429 with Retry-After once the sender is locked out', async () => {
    mockLimiter.check.mockReturnValue({ kind: 'lockout', retryAfterMs: 900_000 });

    const res = await POST(makeReq({ email: 'budi@example.com' }));

    expect(res.status).toBe(429);
    expect((await res.json()).code).toBe('rate_limited');
    expect(res.headers.get('Retry-After')).toBe('900');
    expect(requestOtp).not.toHaveBeenCalled();
  });

  it('returns 429 with Retry-After on a progressive-delay verdict, without calling requestOtp', async () => {
    mockLimiter.check.mockReturnValue({ kind: 'progressive_delay', delayMs: 30_000 });

    const res = await POST(makeReq({ email: 'budi@example.com' }));

    expect(res.status).toBe(429);
    expect((await res.json()).code).toBe('rate_limited');
    expect(res.headers.get('Retry-After')).toBe('30');
    expect(requestOtp).not.toHaveBeenCalled();
  });

  it('counts every request, registered or not, so the limiter cannot be used as an oracle', async () => {
    await POST(makeReq({ email: 'budi@example.com' }));

    expect(mockLimiter.recordFailure).toHaveBeenCalled();
    expect(mockLimiter.recordSuccess).not.toHaveBeenCalled();
  });
});
