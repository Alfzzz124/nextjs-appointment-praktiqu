/**
 * createRateLimiter: thresholds, and that its memory stays bounded.
 *
 * The key is usually the client IP, which without a vouched forwarder is the first
 * X-Forwarded-For entry and so whatever the caller sends. Every key the map keeps is
 * memory an anonymous caller can spend, so `check` must not create entries, spent entries
 * must be dropped, and a flood of live ones must stop at a cap.
 */
import { describe, it, expect } from 'vitest';
import { createRateLimiter } from '@/lib/rate-limit';

function clock(start = 1_000_000) {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

describe('createRateLimiter thresholds', () => {
  it('delays after 5 failures, locks after 10, and lifts the lock after lockoutMs', () => {
    const c = clock();
    const rl = createRateLimiter({ now: c.now });

    for (let i = 0; i < 4; i++) expect(rl.recordFailure('k')).toEqual({ kind: 'allow' });
    expect(rl.recordFailure('k')).toEqual({ kind: 'progressive_delay', delayMs: 30_000 });
    for (let i = 0; i < 4; i++) rl.recordFailure('k');
    expect(rl.recordFailure('k')).toEqual({ kind: 'lockout', retryAfterMs: 5 * 60_000 });

    c.advance(60_000);
    expect(rl.check('k')).toEqual({ kind: 'lockout', retryAfterMs: 4 * 60_000 });

    // Lock over, but the ten failures are still inside the 15-minute window: locks again.
    c.advance(4 * 60_000);
    expect(rl.check('k')).toEqual({ kind: 'lockout', retryAfterMs: 5 * 60_000 });

    // Once the lock and the window have both passed, the key is clean.
    c.advance(15 * 60_000);
    expect(rl.check('k')).toEqual({ kind: 'allow' });
  });

  it('forgets failures that slid out of the window', () => {
    const c = clock();
    const rl = createRateLimiter({ now: c.now });
    for (let i = 0; i < 4; i++) rl.recordFailure('k');
    c.advance(15 * 60_000 + 1);
    expect(rl.recordFailure('k')).toEqual({ kind: 'allow' });
  });

  it('recordSuccess and reset clear the key', () => {
    const rl = createRateLimiter({ config: { lockoutAfter: 2 } });
    rl.recordFailure('a');
    rl.recordFailure('b');
    rl.recordSuccess('a');
    rl.reset('b');
    expect(rl._size()).toBe(0);
    expect(rl.check('a')).toEqual({ kind: 'allow' });
  });
});

describe('createRateLimiter memory', () => {
  it('check on an unknown key answers allow and stores nothing', () => {
    const rl = createRateLimiter();
    rl.recordFailure('known');
    for (let i = 0; i < 50; i++) expect(rl.check(`unknown-${i}`)).toEqual({ kind: 'allow' });
    expect(rl._size()).toBe(1);
  });

  it('sweeps entries whose failures left the window and whose lock has passed', () => {
    const c = clock();
    const rl = createRateLimiter({
      now: c.now,
      sweepEvery: 5,
      config: { windowMs: 1_000, progressiveAfter: 100, lockoutAfter: 2, lockoutMs: 5_000 },
    });

    rl.recordFailure('spent-1');
    rl.recordFailure('spent-2');
    rl.recordFailure('locked');
    rl.recordFailure('locked'); // second failure locks it for 5 s
    expect(rl._size()).toBe(3);

    c.advance(2_000);
    rl.recordFailure('fresh'); // fifth operation: the sweep runs first
    expect(rl._size()).toBe(2);
    // The lock outlives its failures' window, so the entry must survive the sweep.
    expect(rl.check('locked')).toEqual({ kind: 'lockout', retryAfterMs: 3_000 });

    c.advance(4_000);
    for (let i = 0; i < 4; i++) rl.check('anything'); // the fourth is the tenth operation
    expect(rl._size()).toBe(0);
  });

  it('holds the cap under a flood of distinct live keys, dropping the oldest first', () => {
    const rl = createRateLimiter({ maxKeys: 100, config: { progressiveAfter: 1, lockoutAfter: 3 } });

    for (let i = 0; i < 1_000; i++) {
      rl.recordFailure(`flood-${i}`);
      expect(rl._size()).toBeLessThanOrEqual(100);
    }

    expect(rl.check('flood-0')).toEqual({ kind: 'allow' }); // evicted
    expect(rl.check('flood-999')).toEqual({ kind: 'progressive_delay', delayMs: 30_000 });
  });

  it('evicts spent entries before live ones when the cap is reached', () => {
    const c = clock();
    const rl = createRateLimiter({
      now: c.now,
      maxKeys: 10,
      sweepEvery: 1_000_000,
      config: { windowMs: 1_000, progressiveAfter: 1, lockoutAfter: 100 },
    });

    for (let i = 0; i < 9; i++) rl.recordFailure(`old-${i}`);
    c.advance(2_000);
    rl.recordFailure('live');
    rl.recordFailure('new');

    expect(rl._size()).toBe(2);
    expect(rl.check('live')).toEqual({ kind: 'progressive_delay', delayMs: 30_000 });
  });

  it('a key with recent activity outlives older idle keys', () => {
    const rl = createRateLimiter({ maxKeys: 10, config: { progressiveAfter: 1, lockoutAfter: 100 } });
    for (let i = 0; i < 10; i++) rl.recordFailure(`k-${i}`);
    rl.check('k-0');
    rl.recordFailure('k-10');

    expect(rl.check('k-0')).toEqual({ kind: 'progressive_delay', delayMs: 30_000 });
    expect(rl.check('k-1')).toEqual({ kind: 'allow' });
  });

  it('_clear empties the map', () => {
    const rl = createRateLimiter();
    rl.recordFailure('a');
    rl._clear();
    expect(rl._size()).toBe(0);
  });
});
