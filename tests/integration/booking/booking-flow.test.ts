// tests/integration/booking/booking-flow.test.ts
import { describe, it, expect } from 'vitest';
import { SlotHoldService } from '@/services/booking/slot-hold.service';

describe('booking flow integration', () => {
  it('replacing an existing hold refreshes expiry', async () => {
    const svc = new SlotHoldService();
    const first = svc.create({ professionalId: 'p1', serviceId: 's1', date: '2026-06-04', startTime: '10:00' });
    await new Promise((r) => setTimeout(r, 5));
    const second = svc.create({ professionalId: 'p1', serviceId: 's1', date: '2026-06-04', startTime: '10:00' });
    expect(second.expiresAt).toBeGreaterThan(first.expiresAt);
  });
});