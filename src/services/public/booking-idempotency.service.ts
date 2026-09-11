// Idempotency keys for public booking.
//
// The gateway gives up at ~8 seconds while the write carries on, so a caller whose
// POST times out cannot tell "the booking landed" from "the booking was lost". The
// front end currently guesses by re-reading /slots and asking whether the slot is
// still offered — a guess that is wrong whenever a slot disappears for some reason
// other than being taken (its time passed; later, the professional blocked it in
// Google Calendar). With a key there is nothing to guess: replaying it returns the
// same appointment instead of creating a second one.

import { createHash } from 'node:crypto';
import { prisma } from '@/lib/prisma';

export type ClaimResult =
  /** The caller owns this key and should carry out the booking. */
  | { kind: 'claimed' }
  /** This key already booked something; hand back that appointment. */
  | { kind: 'replay'; appointmentId: number }
  /** Another attempt holds this key right now. */
  | { kind: 'in_progress' }
  /** This key was used for a different booking. Answering it would be a lie. */
  | { kind: 'fingerprint_mismatch' };

/**
 * Stable hash of a request body.
 *
 * Key order must not matter — JSON.stringify alone would make `{a,b}` and `{b,a}`
 * different bookings — and `undefined` is dropped so an optional field left out
 * matches one sent as undefined.
 */
export function fingerprintOf(input: unknown): string {
  return createHash('sha256').update(canonical(input)).digest('hex');
}

function canonical(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  const entries = Object.entries(v as Record<string, unknown>)
    .filter(([, val]) => val !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, val]) => `${JSON.stringify(k)}:${canonical(val)}`).join(',')}}`;
}

/**
 * Take ownership of a key, or learn why you cannot.
 *
 * The INSERT is the lock: concurrent attempts race for the primary key and exactly
 * one wins. The loser reads the row to find out whether the winner is still working
 * or already finished.
 */
export async function claimIdempotencyKey(
  key: string,
  fingerprint: string,
  // Guards the one legitimate re-read, below. Not part of the public contract.
  attempt = 0,
): Promise<ClaimResult> {
  // createMany+skipDuplicates rather than create-and-catch: losing the race is the
  // normal path here, and `create` would throw and have Prisma log a constraint
  // violation every time two attempts collide. On MySQL this is INSERT IGNORE, so
  // it stays one atomic statement.
  const { count } = await prisma.bookingIdempotencyKey.createMany({
    data: [{ key, fingerprint }],
    skipDuplicates: true,
  });
  if (count === 1) return { kind: 'claimed' };

  const existing = await prisma.bookingIdempotencyKey.findUnique({ where: { key } });
  if (!existing) {
    // The holder released it between our INSERT being ignored and this read — the key is
    // free again. Retry once; looping here would spin against a pathological caller.
    if (attempt >= 1) return { kind: 'in_progress' };
    return claimIdempotencyKey(key, fingerprint, attempt + 1);
  }

  // Checked before the in-flight test: a mismatched body is wrong to answer either
  // way, and saying "in progress" would invite the caller to retry into the same wall.
  if (existing.fingerprint !== fingerprint) return { kind: 'fingerprint_mismatch' };
  if (existing.appointmentId === null) return { kind: 'in_progress' };
  return { kind: 'replay', appointmentId: existing.appointmentId };
}

/** Record which appointment this key produced, so a replay can return it. */
export async function completeIdempotencyKey(key: string, appointmentId: number): Promise<void> {
  await prisma.bookingIdempotencyKey.update({
    where: { key },
    data: { appointmentId, completedAt: new Date() },
  });
}

/**
 * Give the key back after a failed attempt, so an honest retry can claim it.
 *
 * Failures are not recorded: the caller's reason for retrying is that nothing was
 * written, and holding the key would deny exactly that retry.
 */
export async function releaseIdempotencyKey(key: string): Promise<void> {
  await prisma.bookingIdempotencyKey.deleteMany({ where: { key, appointmentId: null } });
}
