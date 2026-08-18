/**
 * OTP primitives. Small surface, but every property here is load-bearing: a code that
 * is not always six characters breaks the client input mask, a hash that leaks the code
 * defeats the point of hashing, and a comparison that short-circuits on the first
 * differing byte leaks the code one byte at a time.
 */
import { describe, it, expect } from 'vitest';
import {
  OTP_LENGTH,
  OTP_TTL_MS,
  OTP_MAX_ATTEMPTS,
  OTP_RESEND_COOLDOWN_MS,
  generateOtpCode,
  hashOtpCode,
  codesMatch,
} from '@/lib/auth/otp';

describe('policy constants', () => {
  it('matches the agreed policy', () => {
    expect(OTP_LENGTH).toBe(6);
    expect(OTP_TTL_MS).toBe(10 * 60_000);
    expect(OTP_MAX_ATTEMPTS).toBe(5);
    expect(OTP_RESEND_COOLDOWN_MS).toBe(60_000);
  });
});

describe('generateOtpCode', () => {
  it('always returns exactly six digits', () => {
    for (let i = 0; i < 500; i++) {
      expect(generateOtpCode()).toMatch(/^\d{6}$/);
    }
  });

  it('pads a small draw rather than returning a short code', () => {
    // One draw in ten starts with a zero, so across 500 draws seeing none would mean
    // padding is broken — not bad luck.
    const codes = Array.from({ length: 500 }, generateOtpCode);
    expect(codes.some((c) => c.startsWith('0'))).toBe(true);
  });

  it('does not return the same code every time', () => {
    const codes = new Set(Array.from({ length: 50 }, generateOtpCode));
    expect(codes.size).toBeGreaterThan(1);
  });
});

describe('hashOtpCode', () => {
  it('is deterministic', () => {
    expect(hashOtpCode('418902')).toBe(hashOtpCode('418902'));
  });

  it('does not contain the code', () => {
    expect(hashOtpCode('418902')).not.toContain('418902');
  });

  it('produces a 64-character hex digest', () => {
    expect(hashOtpCode('418902')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('gives different codes different hashes', () => {
    expect(hashOtpCode('418902')).not.toBe(hashOtpCode('418903'));
  });
});

describe('codesMatch', () => {
  it('accepts the right code', () => {
    expect(codesMatch('418902', hashOtpCode('418902'))).toBe(true);
  });

  it('rejects the wrong code', () => {
    expect(codesMatch('000000', hashOtpCode('418902'))).toBe(false);
  });

  it('rejects a stored hash that is not a hex digest rather than throwing', () => {
    expect(codesMatch('418902', 'not-a-hash')).toBe(false);
  });

  it('rejects an empty stored hash', () => {
    expect(codesMatch('418902', '')).toBe(false);
  });
});
