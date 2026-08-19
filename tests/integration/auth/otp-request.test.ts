/**
 * requestOtp — mailing a sign-in code.
 *
 * The rule that shapes most of this: the caller must not be able to tell whether an
 * address is registered. Every branch returns the same thing; only the side effects differ.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockPrisma = {
  user: { findUnique: vi.fn(), upsert: vi.fn() },
  otpCode: { findFirst: vi.fn(), updateMany: vi.fn(), create: vi.fn() },
};
vi.mock('@/lib/db', () => ({ prisma: mockPrisma }));

vi.mock('@/lib/auth/wp-auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth/wp-auth')>()),
  wpLookupByEmail: vi.fn(),
}));

vi.mock('@/lib/email', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/email')>()),
  sendEmail: vi.fn().mockResolvedValue({ ok: true }),
}));

vi.mock('@/services/audit', () => ({
  audit: {
    loginSuccess: vi.fn().mockResolvedValue(undefined),
    loginFailure: vi.fn().mockResolvedValue(undefined),
    register: vi.fn().mockResolvedValue(undefined),
    passwordChange: vi.fn().mockResolvedValue(undefined),
    roleChange: vi.fn().mockResolvedValue(undefined),
  },
}));

const { requestOtp } = await import('@/services/auth/otp.service');
const { sendEmail } = await import('@/lib/email');
const { wpLookupByEmail } = await import('@/lib/auth/wp-auth');
const { hashOtpCode } = await import('@/lib/auth/otp');

const USER = { id: 'user-1', email: 'budi@example.com', status: 1 };
const INPUT = { email: 'Budi@Example.com', ip: '203.0.113.9', userAgent: 'vitest' };

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.user.findUnique.mockResolvedValue(USER);
  mockPrisma.otpCode.findFirst.mockResolvedValue(null);
  mockPrisma.otpCode.updateMany.mockResolvedValue({ count: 0 });
  mockPrisma.otpCode.create.mockResolvedValue({});
  vi.mocked(wpLookupByEmail).mockResolvedValue(null);
});

describe('requestOtp', () => {
  it('mails a code to a known address', async () => {
    await requestOtp(INPUT);

    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'budi@example.com' }),
    );
  });

  it('stores the hash of the code, never the code itself', async () => {
    await requestOtp(INPUT);

    const mailed = vi.mocked(sendEmail).mock.calls[0]![0]!.text!;
    const code = mailed.match(/\b(\d{6})\b/)![1]!;
    const stored = mockPrisma.otpCode.create.mock.calls[0]![0].data;

    expect(stored.codeHash).toBe(hashOtpCode(code));
    expect(stored.codeHash).not.toContain(code);
  });

  it('kills any earlier live code so only the newest works', async () => {
    await requestOtp(INPUT);

    expect(mockPrisma.otpCode.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-1', usedAt: null } }),
    );
  });

  it('sends nothing for an address neither the app nor WordPress knows', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    vi.mocked(wpLookupByEmail).mockResolvedValue(null);

    const result = await requestOtp({ ...INPUT, email: 'hantu@example.com' });

    expect(sendEmail).not.toHaveBeenCalled();
    expect(mockPrisma.otpCode.create).not.toHaveBeenCalled();
    // Same shape as the success path — the caller cannot tell the difference.
    expect(result.retryAfterSeconds).toBe(60);
  });

  it('reaches WordPress for someone who has never logged into the app', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    vi.mocked(wpLookupByEmail).mockResolvedValue({
      wpUserId: BigInt(310),
      email: 'lama@example.com',
      username: 'lama',
      displayName: 'Pasien Lama',
      firstName: 'Pasien',
      lastName: 'Lama',
      roles: ['kiviCare_patient'],
      status: 'active' as const,
    });
    mockPrisma.user.upsert.mockResolvedValue({ id: 'user-lama', email: 'lama@example.com', status: 1 });

    await requestOtp({ ...INPUT, email: 'lama@example.com' });

    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'lama@example.com' }));
  });

  it('sends nothing when WordPress reports the account inactive, and answers exactly like the active case', async () => {
    // A row already exists for this address (status 1, stale), but WordPress now says the
    // account is inactive. requestOtp must refresh from WordPress and refuse to mail a code
    // — and the caller must not be able to tell this apart from a normal, active send.
    vi.mocked(wpLookupByEmail).mockResolvedValue({
      wpUserId: BigInt(924),
      email: 'budi@example.com',
      username: 'budi',
      displayName: 'Budi Santoso',
      firstName: 'Budi',
      lastName: 'Santoso',
      roles: ['kiviCare_patient'],
      status: 'inactive' as const,
    });
    mockPrisma.user.upsert.mockResolvedValue({ id: 'user-1', email: 'budi@example.com', status: 0 });

    const result = await requestOtp(INPUT);

    expect(sendEmail).not.toHaveBeenCalled();
    expect(mockPrisma.otpCode.create).not.toHaveBeenCalled();
    // Same shape as the registered-and-active path — no distinguishable signal.
    expect(result.retryAfterSeconds).toBe(60);
  });

  it('still sends the code when WordPress cannot be reached, rather than locking the user out', async () => {
    // wpLookupByEmail returns null both for "no such user" and "could not reach WordPress" —
    // requestOtp can't tell those apart, so on null it must proceed with the existing row.
    vi.mocked(wpLookupByEmail).mockResolvedValue(null);

    await requestOtp(INPUT);

    expect(mockPrisma.user.upsert).not.toHaveBeenCalled();
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'budi@example.com' }));
  });

  it('stays silent inside the 60 second cooldown, and answers the same flat 60 as every other branch', async () => {
    mockPrisma.otpCode.findFirst.mockResolvedValue({
      id: 'otp-1',
      createdAt: new Date(Date.now() - 20_000),
    });

    const result = await requestOtp(INPUT);

    expect(sendEmail).not.toHaveBeenCalled();
    expect(mockPrisma.otpCode.create).not.toHaveBeenCalled();
    // Not "whatever time is left" — a registered address called twice inside the cooldown
    // must not answer with the shrinking remainder (59, 58, ...), or two calls a second
    // apart would reveal that the address exists.
    expect(result.retryAfterSeconds).toBe(60);
  });

  it('sends again once the cooldown has passed', async () => {
    mockPrisma.otpCode.findFirst.mockResolvedValue({
      id: 'otp-1',
      createdAt: new Date(Date.now() - 61_000),
    });

    await requestOtp(INPUT);

    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it('records the requester so a flood can be traced', async () => {
    await requestOtp(INPUT);

    expect(mockPrisma.otpCode.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ ipAddress: '203.0.113.9', userAgent: 'vitest' }),
      }),
    );
  });
});
