/**
 * Idempotency keys for public booking.
 *
 * These run against the real test database on purpose. The correctness property
 * that matters — a second claim on the same key losing to the unique index — is
 * the database's behaviour, not ours. A mocked repository would only replay the
 * assumption being tested.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { assertTestDb } from '../../billing/fixtures';
import {
  claimIdempotencyKey,
  completeIdempotencyKey,
  releaseIdempotencyKey,
  fingerprintOf,
  bookingFingerprintOf,
  IN_PROGRESS_STALE_MS,
} from '@/services/public/booking-idempotency.service';

const KEY = 'test-idem-0001';
const OTHER_KEY = 'test-idem-0002';
const BODY = { professionalId: 7, date: '2026-09-20', startTime: '09:00' };

async function wipe() {
  assertTestDb();
  await prisma.$executeRawUnsafe(
    `DELETE FROM booking_idempotency_keys WHERE \`key\` LIKE 'test-idem-%'`,
  );
}

beforeEach(wipe);
afterAll(wipe);

describe('claimIdempotencyKey', () => {
  it('claims a key nobody has used', async () => {
    const r = await claimIdempotencyKey(KEY, fingerprintOf(BODY));
    expect(r).toEqual({ kind: 'claimed' });
  });

  it('reports in_progress while the first attempt is still running', async () => {
    await claimIdempotencyKey(KEY, fingerprintOf(BODY));
    const second = await claimIdempotencyKey(KEY, fingerprintOf(BODY));
    expect(second).toEqual({ kind: 'in_progress' });
  });

  it('replays the appointment id once the first attempt completed', async () => {
    await claimIdempotencyKey(KEY, fingerprintOf(BODY));
    await completeIdempotencyKey(KEY, 4242);
    const replay = await claimIdempotencyKey(KEY, fingerprintOf(BODY));
    expect(replay).toEqual({ kind: 'replay', appointmentId: 4242 });
  });

  it('refuses a completed key replayed with a different body', async () => {
    await claimIdempotencyKey(KEY, fingerprintOf(BODY));
    await completeIdempotencyKey(KEY, 4242);
    const replay = await claimIdempotencyKey(KEY, fingerprintOf({ ...BODY, startTime: '10:00' }));
    expect(replay).toEqual({ kind: 'fingerprint_mismatch' });
  });

  it('refuses an in-progress key replayed with a different body', async () => {
    await claimIdempotencyKey(KEY, fingerprintOf(BODY));
    const second = await claimIdempotencyKey(KEY, fingerprintOf({ ...BODY, startTime: '10:00' }));
    expect(second).toEqual({ kind: 'fingerprint_mismatch' });
  });

  it('lets the key be claimed again after a failed attempt released it', async () => {
    await claimIdempotencyKey(KEY, fingerprintOf(BODY));
    await releaseIdempotencyKey(KEY);
    const retry = await claimIdempotencyKey(KEY, fingerprintOf(BODY));
    expect(retry).toEqual({ kind: 'claimed' });
  });

  it('keeps separate keys independent', async () => {
    await claimIdempotencyKey(KEY, fingerprintOf(BODY));
    await completeIdempotencyKey(KEY, 4242);
    const other = await claimIdempotencyKey(OTHER_KEY, fingerprintOf(BODY));
    expect(other).toEqual({ kind: 'claimed' });
  });
});

/** A key whose first attempt died mid-request: claimed `ageMs` ago, never completed. */
async function seedClaim(key: string, ageMs: number) {
  await prisma.bookingIdempotencyKey.create({
    data: { key, fingerprint: fingerprintOf(BODY), createdAt: new Date(Date.now() - ageMs) },
  });
}

describe('claimIdempotencyKey — abandoned claims', () => {
  const OLD = IN_PROGRESS_STALE_MS + 30_000;

  it('lets an old in-flight claim be taken over: its process is long gone', async () => {
    await seedClaim(KEY, OLD);
    const r = await claimIdempotencyKey(KEY, fingerprintOf(BODY));
    expect(r).toEqual({ kind: 'claimed' });
  });

  it('keeps a recent in-flight claim: the first attempt may still be writing', async () => {
    await seedClaim(KEY, IN_PROGRESS_STALE_MS - 30_000);
    const r = await claimIdempotencyKey(KEY, fingerprintOf(BODY));
    expect(r).toEqual({ kind: 'in_progress' });
  });

  it('restarts the clock on takeover, so the next retry waits instead of double-claiming', async () => {
    await seedClaim(KEY, OLD);
    expect(await claimIdempotencyKey(KEY, fingerprintOf(BODY))).toEqual({ kind: 'claimed' });
    expect(await claimIdempotencyKey(KEY, fingerprintOf(BODY))).toEqual({ kind: 'in_progress' });
  });

  it('lets exactly one of two simultaneous takeovers win', async () => {
    await seedClaim(KEY, OLD);
    const results = await Promise.all([
      claimIdempotencyKey(KEY, fingerprintOf(BODY)),
      claimIdempotencyKey(KEY, fingerprintOf(BODY)),
    ]);
    expect(results.filter((r) => r.kind === 'claimed')).toHaveLength(1);
    expect(results.filter((r) => r.kind === 'in_progress')).toHaveLength(1);
  });

  it('answers a replay, and writes nothing, when the dead attempt had already booked', async () => {
    await seedClaim(KEY, OLD);
    const findWritten = async () => 777;
    const r = await claimIdempotencyKey(KEY, fingerprintOf(BODY), findWritten);
    expect(r).toEqual({ kind: 'replay', appointmentId: 777 });
    // The key is finished with that booking, so later retries replay without the lookup.
    expect(await claimIdempotencyKey(KEY, fingerprintOf(BODY))).toEqual({
      kind: 'replay',
      appointmentId: 777,
    });
  });

  it('takes over when the lookup finds nothing written', async () => {
    await seedClaim(KEY, OLD);
    const r = await claimIdempotencyKey(KEY, fingerprintOf(BODY), async () => null);
    expect(r).toEqual({ kind: 'claimed' });
  });

  it('does not rewrite blind when the lookup itself fails', async () => {
    await seedClaim(KEY, OLD);
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const r = await claimIdempotencyKey(KEY, fingerprintOf(BODY), async () => {
        throw new Error('pool exhausted');
      });
      expect(r).toEqual({ kind: 'in_progress' });
      expect(logged).toHaveBeenCalled();
    } finally {
      logged.mockRestore();
    }
  });

  it('does not consult the lookup for a recent claim', async () => {
    await seedClaim(KEY, 1_000);
    let called = false;
    await claimIdempotencyKey(KEY, fingerprintOf(BODY), async () => {
      called = true;
      return 1;
    });
    expect(called).toBe(false);
  });
});

describe('fingerprintOf', () => {
  it('is stable across key order', () => {
    expect(fingerprintOf({ a: 1, b: 2 })).toBe(fingerprintOf({ b: 2, a: 1 }));
  });

  it('differs when a value differs', () => {
    expect(fingerprintOf({ a: 1 })).not.toBe(fingerprintOf({ a: 2 }));
  });
});

describe('bookingFingerprintOf', () => {
  const booking = { professionalId: 7, serviceId: 3, date: '2026-09-20', startTime: '09:00', clientEmail: 'a@b.c' };

  it('ignores holdKey — a retry after a timeout takes a fresh hold and must still replay', () => {
    expect(bookingFingerprintOf({ ...booking, holdKey: 'hold-1' })).toBe(
      bookingFingerprintOf({ ...booking, holdKey: 'hold-2' }),
    );
  });

  it('still tells different bookings apart', () => {
    expect(bookingFingerprintOf({ ...booking, holdKey: 'h' })).not.toBe(
      bookingFingerprintOf({ ...booking, startTime: '10:00', holdKey: 'h' }),
    );
  });
});
