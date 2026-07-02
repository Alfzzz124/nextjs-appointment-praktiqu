/**
 * Task 6: public appointment cancel.
 * Asserts cancelPublicAppointment throws NotCancellableError when the row is
 * already cancelled (raw WP status = 1). Prisma is mocked — no DB needed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Prisma mock (service imports { prisma } from '@/lib/prisma') ─────────────
vi.mock('@/lib/prisma', () => ({
  prisma: {
    $queryRawUnsafe: vi.fn(),
  },
}));

import { prisma } from '@/lib/prisma';
import {
  cancelPublicAppointment,
  NotCancellableError,
  AppointmentNotFoundError,
} from '@/services/public/public-booking.service';

const queryRawUnsafe = prisma.$queryRawUnsafe as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('cancelPublicAppointment', () => {
  it('throws NotCancellableError when the row is already cancelled (status = 1)', async () => {
    // First (and only) query: SELECT id, status → returns an already-cancelled row.
    queryRawUnsafe.mockResolvedValueOnce([{ id: 42, status: 1 }]);

    await expect(cancelPublicAppointment('42')).rejects.toBeInstanceOf(NotCancellableError);
    // Should NOT have issued an UPDATE — only the initial SELECT ran.
    expect(queryRawUnsafe).toHaveBeenCalledTimes(1);
  });

  it('throws AppointmentNotFoundError when no row exists', async () => {
    queryRawUnsafe.mockResolvedValueOnce([]);
    await expect(cancelPublicAppointment('999')).rejects.toBeInstanceOf(AppointmentNotFoundError);
  });
});
