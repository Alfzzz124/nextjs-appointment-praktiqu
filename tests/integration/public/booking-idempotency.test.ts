/**
 * Idempotency keys for public booking.
 *
 * These run against the real test database on purpose. The correctness property
 * that matters — a second claim on the same key losing to the unique index — is
 * the database's behaviour, not ours. A mocked repository would only replay the
 * assumption being tested.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { prisma } from '@/lib/prisma';
import { assertTestDb } from '../../billing/fixtures';
import {
  claimIdempotencyKey,
  completeIdempotencyKey,
  releaseIdempotencyKey,
  fingerprintOf,
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

describe('fingerprintOf', () => {
  it('is stable across key order', () => {
    expect(fingerprintOf({ a: 1, b: 2 })).toBe(fingerprintOf({ b: 2, a: 1 }));
  });

  it('differs when a value differs', () => {
    expect(fingerprintOf({ a: 1 })).not.toBe(fingerprintOf({ a: 2 }));
  });
});
