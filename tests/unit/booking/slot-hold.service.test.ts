// tests/unit/booking/slot-hold.service.test.ts
//
// Holds are signed tokens, not entries in one process's memory. The API runs several
// Node workers; a hold kept in a Map was missing on the worker that received the
// booking, and the guest got 410 hold_expired for a free slot (audit M-6). Two holds on
// the same slot also shared one key, so one booking's consume() erased the other's.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { SlotHoldService, SLOT_HOLD_TTL_MS } from '@/services/booking/slot-hold.service';
import { signAppointmentToken } from '@/lib/public/appointment-token';

const SLOT = { professionalId: '34', serviceId: '12', date: '2026-11-20', startTime: '19:00' };

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('SlotHoldService', () => {
  it('creates a hold with a 15-minute TTL that it can read back', () => {
    const svc = new SlotHoldService();
    const before = Date.now();
    const hold = svc.create(SLOT);
    expect(hold.expiresAt - before).toBeGreaterThanOrEqual(SLOT_HOLD_TTL_MS - 50);
    expect(hold.expiresAt - Date.now()).toBeLessThanOrEqual(SLOT_HOLD_TTL_MS + 50);
    expect(svc.get(hold.key)).toMatchObject({ ...SLOT, key: hold.key, expiresAt: hold.expiresAt });
  });

  it('accepts a hold taken on another worker process', () => {
    const tokenFromWorkerA = new SlotHoldService().create(SLOT).key;
    const workerB = new SlotHoldService();
    expect(workerB.get(tokenFromWorkerA)).toMatchObject(SLOT);
  });

  it('keeps two holds on the same slot independent', () => {
    const svc = new SlotHoldService();
    const first = svc.create(SLOT);
    const second = svc.create(SLOT);
    svc.consume(first.key);
    expect(svc.get(second.key)).not.toBeNull();
  });

  it('returns null once the hold has expired', () => {
    vi.useFakeTimers();
    const svc = new SlotHoldService();
    const hold = svc.create(SLOT);
    vi.advanceTimersByTime(SLOT_HOLD_TTL_MS - 1000);
    expect(svc.get(hold.key)).not.toBeNull();
    vi.advanceTimersByTime(2000);
    expect(svc.get(hold.key)).toBeNull();
  });

  it('returns the remaining seconds while active', () => {
    const svc = new SlotHoldService();
    const data = svc.getWithRemaining(svc.create(SLOT).key);
    expect(data!.remainingSec).toBeGreaterThan(0);
    expect(data!.remainingSec).toBeLessThanOrEqual(15 * 60);
  });

  it('rejects a token whose slot or expiry was edited', () => {
    const svc = new SlotHoldService();
    const [version, payload, sig] = svc.create(SLOT).key.split('.');
    const body = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    for (const edit of [{ ...body, p: '35' }, { ...body, e: body.e + 3_600_000 }]) {
      const forged = Buffer.from(JSON.stringify(edit), 'utf8').toString('base64url');
      expect(svc.get(`${version}.${forged}.${sig}`)).toBeNull();
    }
  });

  it('rejects a token signed with another secret', () => {
    vi.stubEnv('AUTH_SECRET', 'secret-of-another-deployment-123');
    const foreign = new SlotHoldService().create(SLOT).key;
    vi.stubEnv('AUTH_SECRET', 'secret-of-this-deployment-456789');
    expect(new SlotHoldService().get(foreign)).toBeNull();
  });

  it.each([
    ['an empty string', ''],
    ['the old memory key format', '34:12:2026-11-20:19:00'],
    ['random text', 'not-a-hold'],
    ['too few parts', 'h1.abc'],
    ['a public appointment token', signAppointmentToken(42)],
  ])('rejects %s', (_label, key) => {
    expect(new SlotHoldService().get(key)).toBeNull();
  });
});
