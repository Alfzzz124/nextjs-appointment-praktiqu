/**
 * Task 6: public appointment cancel.
 * Ground-truth WP status ordinals: CANCELLED=0, BOOKED=1, PENDING=2.
 * A row with status=0 (already cancelled) is NOT cancellable; BOOKED (1) and
 * PENDING (2) are cancellable and get set to 0. Prisma is mocked — no DB needed.
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
  it('throws NotCancellableError when the row is already cancelled (status = 0)', async () => {
    // First (and only) query: SELECT id, status → returns an already-cancelled row.
    queryRawUnsafe.mockResolvedValueOnce([{ id: 42, status: 0 }]);

    await expect(cancelPublicAppointment('42')).rejects.toBeInstanceOf(NotCancellableError);
    // Should NOT have issued an UPDATE — only the initial SELECT ran.
    expect(queryRawUnsafe).toHaveBeenCalledTimes(1);
  });

  it('throws AppointmentNotFoundError when no row exists', async () => {
    queryRawUnsafe.mockResolvedValueOnce([]);
    await expect(cancelPublicAppointment('999')).rejects.toBeInstanceOf(AppointmentNotFoundError);
  });

  it('cancels a BOOKED appointment (status = 1) — issues an UPDATE to status 0', async () => {
    queryRawUnsafe
      // 1) SELECT id, status → BOOKED row
      .mockResolvedValueOnce([{ id: 42, status: 1 }])
      // 2) UPDATE ... SET status = 0
      .mockResolvedValueOnce(undefined)
      // 3) getPublicAppointmentById re-read → now CANCELLED (0)
      .mockResolvedValueOnce([
        {
          id: 42,
          status: 0,
          date: '2026-07-10',
          start_time: '10:00:00',
          service_name: 'Consultation',
          professional_name: 'Dr. Smith',
          client_name: 'Jane Doe',
        },
      ]);

    const result = await cancelPublicAppointment('42');

    // An UPDATE must have run: SELECT + UPDATE + re-read SELECT = 3 calls.
    expect(queryRawUnsafe).toHaveBeenCalledTimes(3);
    const updateCall = queryRawUnsafe.mock.calls.find((c) =>
      /UPDATE\s+wp_kc_appointments\s+SET\s+status\s*=\s*0\b/i.test(String(c[0])),
    );
    expect(updateCall).toBeDefined();
    expect(result.status).toBe('CANCELLED');
  });

  it('cancels a PENDING appointment (status = 2) — issues an UPDATE to status 0', async () => {
    queryRawUnsafe
      .mockResolvedValueOnce([{ id: 43, status: 2 }])
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([
        {
          id: 43,
          status: 0,
          date: '2026-07-11',
          start_time: '11:30:00',
          service_name: 'Consultation',
          professional_name: 'Dr. Smith',
          client_name: 'John Roe',
        },
      ]);

    const result = await cancelPublicAppointment('43');

    expect(queryRawUnsafe).toHaveBeenCalledTimes(3);
    expect(result.status).toBe('CANCELLED');
  });
});
