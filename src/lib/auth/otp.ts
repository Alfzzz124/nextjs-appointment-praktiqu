/**
 * One-time sign-in code primitives.
 *
 * Kept apart from the service so the rules that are easy to get subtly wrong — padding,
 * hashing, constant-time comparison — can be tested without a database or a mail server.
 */

import { createHash, randomInt, timingSafeEqual } from 'node:crypto';

/** Digits in a code. Six is the agreed policy; the client input mask assumes it. */
export const OTP_LENGTH = 6;

/** How long a code stays usable. */
export const OTP_TTL_MS = 10 * 60_000;

/** Wrong guesses a single code tolerates before it is dead. */
export const OTP_MAX_ATTEMPTS = 5;

/** Minimum gap between two send requests for the same account. */
export const OTP_RESEND_COOLDOWN_MS = 60_000;

/**
 * A uniformly random code, zero-padded.
 *
 * `randomInt` is the CSPRNG; `Math.random()` would be guessable from earlier draws.
 * Padding matters: without it one draw in ten produces a five-digit string.
 */
export function generateOtpCode(): string {
  const max = 10 ** OTP_LENGTH;
  return String(randomInt(0, max)).padStart(OTP_LENGTH, '0');
}

/** SHA-256 hex digest. Plain SHA-256 rather than a slow KDF is deliberate: the code dies
 *  in ten minutes after five guesses, so the threat a KDF defends against does not apply,
 *  and verify runs on every attempt. */
export function hashOtpCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

/**
 * Constant-time comparison of a submitted code against a stored digest.
 *
 * Returns false for a malformed stored value rather than throwing — a corrupt row should
 * fail the login, not the request.
 */
export function codesMatch(rawCode: string, storedHash: string): boolean {
  const expected = Buffer.from(hashOtpCode(rawCode), 'hex');
  let actual: Buffer;
  try {
    actual = Buffer.from(storedHash, 'hex');
  } catch {
    return false;
  }
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}
