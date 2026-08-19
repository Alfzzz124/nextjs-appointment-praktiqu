/**
 * verifyOtp — trading a code for a session.
 *
 * The attempt counter is the only thing standing between a six-digit secret and a
 * brute-force, so most of these tests are about it holding.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockPrisma = {
  user: { findUnique: vi.fn(), update: vi.fn() },
  otpCode: { findFirst: vi.fn(), update: vi.fn() },
  refreshToken: { create: vi.fn().mockResolvedValue({}) },
};
vi.mock('@/lib/db', () => ({ prisma: mockPrisma }));

vi.mock('@/services/audit', () => ({
  audit: {
    loginSuccess: vi.fn().mockResolvedValue(undefined),
    loginFailure: vi.fn().mockResolvedValue(undefined),
    register: vi.fn().mockResolvedValue(undefined),
    passwordChange: vi.fn().mockResolvedValue(undefined),
    roleChange: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@/lib/auth/jwt', () => ({
  issueAccessToken: vi.fn().mockResolvedValue({
    token: 'mock-access-token',
    expiresAt: new Date('2026-08-18T01:00:00.000Z'),
  }),
  issueRefreshToken: vi.fn().mockReturnValue({
    token: 'mock-refresh-token',
    tokenHash: 'mock-hash',
    familyId: 'mock-family',
    expiresAt: new Date('2026-08-25T00:00:00.000Z'),
  }),
  hashToken: vi.fn((t: string) => `hash-${t}`),
  JWT_CONFIG: { accessTokenTtlMs: 3_600_000, refreshTokenTtlMs: 604_800_000 },
  verifyAccessToken: vi.fn(),
}));

const { verifyOtp } = await import('@/services/auth/otp.service');
const { hashOtpCode } = await import('@/lib/auth/otp');
const { audit } = await import('@/services/audit');

const USER = {
  id: 'user-1',
  email: 'budi@example.com',
  username: 'budi',
  firstName: 'Budi',
  lastName: 'Santoso',
  displayName: 'Budi Santoso',
  role: 'CLIENT',
  wpUserId: BigInt(924),
  status: 1,
  emailVerified: null,
};

const CODE = '418902';

function liveCode(over: Record<string, unknown> = {}) {
  return {
    id: 'otp-1',
    userId: 'user-1',
    codeHash: hashOtpCode(CODE),
    expiresAt: new Date(Date.now() + 60_000),
    usedAt: null,
    attempts: 0,
    ...over,
  };
}

const INPUT = { email: 'Budi@Example.com', code: CODE, ip: '203.0.113.9', userAgent: 'vitest' };

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.user.findUnique.mockResolvedValue(USER);
  mockPrisma.user.update.mockResolvedValue(USER);
  mockPrisma.otpCode.findFirst.mockResolvedValue(liveCode());
  mockPrisma.otpCode.update.mockResolvedValue({});
  mockPrisma.refreshToken.create.mockResolvedValue({});
});

describe('verifyOtp', () => {
  it('returns a session for the right code', async () => {
    const result = await verifyOtp(INPUT);

    expect(result.accessToken).toBe('mock-access-token');
    expect(result.refreshToken).toBe('mock-refresh-token');
    expect(result.user).toMatchObject({ id: 'user-1', email: 'budi@example.com', role: 'CLIENT' });
  });

  it('marks the code used so it cannot be replayed', async () => {
    await verifyOtp(INPUT);

    expect(mockPrisma.otpCode.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'otp-1' },
        data: expect.objectContaining({ usedAt: expect.any(Date) }),
      }),
    );
  });

  it('records the login as otp, not password', async () => {
    await verifyOtp(INPUT);

    expect(audit.loginSuccess).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1', method: 'otp' }),
      expect.anything(),
    );
  });

  it('counts a wrong code against the attempt limit', async () => {
    await expect(verifyOtp({ ...INPUT, code: '000000' })).rejects.toMatchObject({
      code: 'invalid_code',
      status: 400,
    });

    expect(mockPrisma.otpCode.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'otp-1' },
        data: { attempts: { increment: 1 } },
      }),
    );
  });

  it('reports a burned code as burned, not as a wrong guess', async () => {
    mockPrisma.otpCode.findFirst.mockResolvedValue(liveCode({ attempts: 5 }));

    // A wrong guess against a spent code must say too_many_attempts, which proves the
    // attempt check runs before the comparison.
    await expect(verifyOtp({ ...INPUT, code: '000000' })).rejects.toMatchObject({
      code: 'too_many_attempts',
    });
  });

  it('refuses the right code once the attempt limit is spent', async () => {
    mockPrisma.otpCode.findFirst.mockResolvedValue(liveCode({ attempts: 5 }));

    // Being correct must not rescue a burned code.
    await expect(verifyOtp(INPUT)).rejects.toMatchObject({ code: 'too_many_attempts' });
  });

  it('refuses an expired code', async () => {
    mockPrisma.otpCode.findFirst.mockResolvedValue(
      liveCode({ expiresAt: new Date(Date.now() - 1_000) }),
    );

    await expect(verifyOtp(INPUT)).rejects.toMatchObject({ code: 'code_expired' });
  });

  it('says invalid_code, not "no such user", for an unknown address', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);

    await expect(verifyOtp({ ...INPUT, email: 'hantu@example.com' })).rejects.toMatchObject({
      code: 'invalid_code',
    });
  });

  it('says invalid_code when the account has no live code at all', async () => {
    mockPrisma.otpCode.findFirst.mockResolvedValue(null);

    await expect(verifyOtp(INPUT)).rejects.toMatchObject({ code: 'invalid_code' });
  });

  it('rejects an inactive account after the code matched, not before', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ ...USER, status: 0 });

    await expect(verifyOtp(INPUT)).rejects.toMatchObject({
      code: 'account_inactive',
      status: 403,
    });
    // The code is spent either way — an inactive account must not be a free retry loop.
    expect(mockPrisma.otpCode.update).toHaveBeenCalled();
  });

  it('marks the address verified, since receiving the code proves it', async () => {
    await verifyOtp(INPUT);

    expect(mockPrisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'user-1' },
        data: expect.objectContaining({ emailVerified: expect.any(Date) }),
      }),
    );
  });

  it('leaves an already-verified address alone', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ ...USER, emailVerified: new Date('2026-01-01') });

    await verifyOtp(INPUT);

    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it('only considers this user\'s codes, so a shared six digits cannot cross accounts', async () => {
    await verifyOtp(INPUT);

    expect(mockPrisma.otpCode.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-1', usedAt: null } }),
    );
  });
});
