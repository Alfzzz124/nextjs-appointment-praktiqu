import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    kcDoctorClinicMapping: { findFirst: vi.fn() },
    kcClinic: { findFirst: vi.fn() },
  },
}));

import { prisma } from '@/lib/db';
import { resolveKcActor } from '@/services/billing/kc-actor';

describe('resolveKcActor', () => {
  beforeEach(() => vi.clearAllMocks());

  it('maps cuid actor to wpUserId', async () => {
    (prisma.user.findUnique as any).mockResolvedValue({ wpUserId: 42n });
    (prisma.kcDoctorClinicMapping.findFirst as any).mockResolvedValue({ clinicId: 7n });
    const kc = await resolveKcActor({ id: 'cuid1', role: 'PROFESSIONAL', practiceId: null });
    expect(kc.wpUserId).toBe(42n);
    expect(kc.clinicId).toBe(7n);
  });

  it('throws when user has no wpUserId', async () => {
    (prisma.user.findUnique as any).mockResolvedValue({ wpUserId: null });
    await expect(
      resolveKcActor({ id: 'cuid1', role: 'PROFESSIONAL', practiceId: null }),
    ).rejects.toThrow();
  });

  it('SUPER_ADMIN has null clinic scope', async () => {
    (prisma.user.findUnique as any).mockResolvedValue({ wpUserId: 1n });
    const kc = await resolveKcActor({ id: 'cuid-admin', role: 'SUPER_ADMIN', practiceId: null });
    expect(kc.clinicId).toBeNull();
  });
});
