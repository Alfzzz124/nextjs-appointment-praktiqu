/**
 * POST /forgot-password cannot be used to flood a registered inbox.
 *
 * It called `recordSuccess` after every send, which wiped the counter — so the address
 * worth flooding, a registered one, was never limited at all, from one IP or many. It
 * now counts every request and also caps each address regardless of IP.
 *
 * Unlike forgot-password.test.ts this uses the REAL limiter; a mocked one is exactly
 * what let the reset-on-success go unnoticed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockPrisma = {
  user: { findUnique: vi.fn(), upsert: vi.fn() },
  passwordResetToken: { updateMany: vi.fn(), create: vi.fn() },
};
vi.mock('@/lib/db', () => ({ prisma: mockPrisma }));
vi.mock('@/lib/auth/wp-auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth/wp-auth')>()),
  wpLookupByEmail: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/lib/email', () => ({
  sendEmail: vi.fn().mockResolvedValue({ ok: true }),
  buildPasswordResetEmail: vi.fn(() => ({ subject: 's', html: 'h', text: 't' })),
}));

const { POST } = await import('@/app/api/v1/auth/forgot-password/route');
const { sendEmail } = await import('@/lib/email');

function req(email: string, ip: string) {
  return new NextRequest('http://localhost/api/v1/auth/forgot-password', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify({ email }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.passwordResetToken.updateMany.mockResolvedValue({ count: 0 });
  mockPrisma.passwordResetToken.create.mockResolvedValue({});
});

describe('POST /forgot-password — flooding a registered address', () => {
  it('stops mailing one address after 5 sends from a single IP', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'u1', email: 'korban@example.com' });
    const statuses: number[] = [];
    for (let i = 0; i < 8; i++) statuses.push((await POST(req('korban@example.com', '203.0.113.9'))).status);

    expect(vi.mocked(sendEmail)).toHaveBeenCalledTimes(5);
    expect(statuses.slice(5)).toEqual([429, 429, 429]);
  });

  it('stops mailing one address after 5 sends even when every request has a new IP', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'u2', email: 'korban2@example.com' });
    for (let i = 0; i < 8; i++) await POST(req('korban2@example.com', `198.51.100.${i}`));

    expect(vi.mocked(sendEmail)).toHaveBeenCalledTimes(5);
  });
});
