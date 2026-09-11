/**
 * `isSingleEmailAddress` is a conservative practical check, not RFC 5322 — it
 * exists to close a specific gap: `typeof value === 'string'` is true for
 * "a@x,b@y" just as much as for "a@x", and any caller that treats a bare
 * string `to` as one recipient is one comma away from a fan-out. These tests
 * pin both directions: the separators it must reject, and the ordinary
 * addresses (plus-tags, sub-domains) it must not reject in the process.
 */
import { describe, it, expect } from 'vitest';
import { isSingleEmailAddress } from '@/lib/email';

describe('isSingleEmailAddress', () => {
  it('accepts an ordinary address', () => {
    expect(isSingleEmailAddress('budi@example.test')).toBe(true);
  });

  it('accepts a plus-tagged address', () => {
    expect(isSingleEmailAddress('budi+laporan@example.test')).toBe(true);
  });

  it('accepts a dotted local part on a sub-domain', () => {
    expect(isSingleEmailAddress('budi.santoso@sub.example.co.id')).toBe(true);
  });

  it('rejects a comma-joined list', () => {
    expect(isSingleEmailAddress('a@example.test,b@example.test')).toBe(false);
  });

  it('rejects a semicolon-joined list', () => {
    expect(isSingleEmailAddress('a@example.test;b@example.test')).toBe(false);
  });

  it('rejects leading/trailing whitespace', () => {
    expect(isSingleEmailAddress(' budi@example.test ')).toBe(false);
  });

  it('rejects internal whitespace', () => {
    expect(isSingleEmailAddress('budi @example.test')).toBe(false);
  });

  it('rejects a value with no @', () => {
    expect(isSingleEmailAddress('not-an-address')).toBe(false);
  });

  it('rejects a value with two @', () => {
    expect(isSingleEmailAddress('a@b@example.test')).toBe(false);
  });

  it('rejects an empty local part', () => {
    expect(isSingleEmailAddress('@example.test')).toBe(false);
  });

  it('rejects a domain with no dot', () => {
    expect(isSingleEmailAddress('budi@example')).toBe(false);
  });

  it('rejects a domain with a leading dot', () => {
    expect(isSingleEmailAddress('budi@.example.test')).toBe(false);
  });

  it('rejects a domain with a trailing dot', () => {
    expect(isSingleEmailAddress('budi@example.test.')).toBe(false);
  });

  it('rejects a domain with a hyphen-only label', () => {
    expect(isSingleEmailAddress('budi@-.test')).toBe(false);
  });
});
