// tests/unit/booking/slot-hold.service.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  SlotHoldService,
  SLOT_HOLD_TTL_MS,
  SWEEP_EVERY_CREATES,
  MAX_HOLDS,
} from '@/services/booking/slot-hold.service';

describe('SlotHoldService', () => {
  let svc: SlotHoldService;

  beforeEach(() => {
    svc = new SlotHoldService();
  });

  it('builds stable key from inputs', () => {
    const key = svc.buildKey('p1', 's1', '2026-06-04', '10:00');
    expect(key).toBe('p1:s1:2026-06-04:10:00');
  });

  it('creates a hold with 15-minute TTL', () => {
    const before = Date.now();
    const hold = svc.create({ professionalId: 'p1', serviceId: 's1', date: '2026-06-04', startTime: '10:00' });
    const after = Date.now();
    expect(hold.expiresAt - before).toBeGreaterThanOrEqual(SLOT_HOLD_TTL_MS - 50);
    expect(hold.expiresAt - after).toBeLessThanOrEqual(SLOT_HOLD_TTL_MS + 50);
  });

  it('returns null for missing key', () => {
    expect(svc.get('nope')).toBeNull();
  });

  it('returns remaining seconds when active', () => {
    const hold = svc.create({ professionalId: 'p1', serviceId: 's1', date: '2026-06-04', startTime: '10:00' });
    const data = svc.getWithRemaining(hold.key);
    expect(data).not.toBeNull();
    expect(data!.remainingSec).toBeGreaterThan(0);
    expect(data!.remainingSec).toBeLessThanOrEqual(15 * 60);
  });

  it('consumes hold (returns true then false)', () => {
    const hold = svc.create({ professionalId: 'p1', serviceId: 's1', date: '2026-06-04', startTime: '10:00' });
    expect(svc.consume(hold.key)).toBe(true);
    expect(svc.consume(hold.key)).toBe(false);
  });

  it('returns null after expiry', () => {
    vi.useFakeTimers();
    const hold = svc.create({ professionalId: 'p1', serviceId: 's1', date: '2026-06-04', startTime: '10:00' });
    vi.advanceTimersByTime(SLOT_HOLD_TTL_MS + 1000);
    expect(svc.get(hold.key)).toBeNull();
    vi.useRealTimers();
  });

  it('sweeps expired holds', () => {
    vi.useFakeTimers();
    const a = svc.create({ professionalId: 'p1', serviceId: 's1', date: '2026-06-04', startTime: '10:00' });
    const b = svc.create({ professionalId: 'p1', serviceId: 's1', date: '2026-06-04', startTime: '11:00' });
    vi.advanceTimersByTime(SLOT_HOLD_TTL_MS + 1000);
    const removed = svc.sweep();
    expect(removed).toBeGreaterThanOrEqual(2);
    expect(svc.get(a.key)).toBeNull();
    expect(svc.get(b.key)).toBeNull();
    vi.useRealTimers();
  });

  it('isAvailable returns false when hold exists', async () => {
    const hold = svc.create({ professionalId: 'p1', serviceId: 's1', date: '2026-06-04', startTime: '10:00' });
    const result = await svc.isAvailable(hold.key, async () => false);
    expect(result).toBe(false);
  });

  it('isAvailable returns true when no hold and no booking', async () => {
    const result = await svc.isAvailable('p1:s1:2026-06-04:14:00', async () => false);
    expect(result).toBe(true);
  });
});
describe('SlotHoldService — bounded memory', () => {
  afterEach(() => vi.useRealTimers());

  const input = (n: number) => ({
    professionalId: String(n),
    serviceId: '1',
    date: '2026-06-04',
    startTime: '10:00',
  });

  it('sweeps expired holds on its own as new ones arrive', () => {
    vi.useFakeTimers();
    const svc = new SlotHoldService();
    for (let i = 0; i < 50; i++) svc.create(input(i));
    vi.advanceTimersByTime(SLOT_HOLD_TTL_MS + 1000);
    // Nobody calls sweep() — creating holds is what drives it.
    for (let i = 1000; i < 1000 + SWEEP_EVERY_CREATES; i++) svc.create(input(i));
    expect(svc.size).toBeLessThanOrEqual(SWEEP_EVERY_CREATES);
  });

  it('never holds more than MAX_HOLDS live holds, dropping the oldest', () => {
    const svc = new SlotHoldService();
    const first = svc.create(input(0));
    for (let i = 1; i <= MAX_HOLDS; i++) svc.create(input(i));
    expect(svc.size).toBeLessThanOrEqual(MAX_HOLDS);
    expect(svc.get(first.key)).toBeNull();
    expect(svc.get(svc.buildKey(String(MAX_HOLDS), '1', '2026-06-04', '10:00'))).not.toBeNull();
  });
});
