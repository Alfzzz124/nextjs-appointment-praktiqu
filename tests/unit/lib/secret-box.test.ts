/**
 * Symmetric encryption for secrets we must be able to read back — currently
 * Google refresh tokens.
 *
 * The error types matter as much as the round-trip. A decryption failure that
 * gets swallowed looks exactly like "nobody has connected Google yet": every
 * slot shows, nothing is blocked, nothing appears wrong. So a broken key and a
 * broken ciphertext have to be distinguishable by the caller, not merged into
 * one vague throw.
 */
import { describe, it, expect } from 'vitest';
import {
  encryptSecret,
  decryptSecret,
  SecretKeyError,
  SecretDecryptError,
} from '@/lib/secret-box';

const KEY = Buffer.alloc(32, 7).toString('base64');
const OTHER_KEY = Buffer.alloc(32, 9).toString('base64');

/** Flip one byte inside the payload, leaving the envelope well-formed. */
function tamper(token: string): string {
  const [version, payload] = token.split(':');
  const buf = Buffer.from(payload, 'base64');
  buf[buf.length - 1] ^= 0xff;
  return `${version}:${buf.toString('base64')}`;
}

describe('encryptSecret / decryptSecret', () => {
  it('round-trips a secret', () => {
    expect(decryptSecret(encryptSecret('refresh-token-abc', KEY), KEY)).toBe('refresh-token-abc');
  });

  it('round-trips a secret containing non-ASCII', () => {
    expect(decryptSecret(encryptSecret('kunci—rahasia', KEY), KEY)).toBe('kunci—rahasia');
  });

  it('never produces the same ciphertext twice', () => {
    expect(encryptSecret('x', KEY)).not.toBe(encryptSecret('x', KEY));
  });

  it('carries a version marker, so the format can change later', () => {
    expect(encryptSecret('x', KEY).startsWith('v1:')).toBe(true);
  });

  it('refuses a tampered ciphertext rather than returning garbage', () => {
    expect(() => decryptSecret(tamper(encryptSecret('x', KEY)), KEY)).toThrow(SecretDecryptError);
  });

  it('refuses the wrong key', () => {
    expect(() => decryptSecret(encryptSecret('x', KEY), OTHER_KEY)).toThrow(SecretDecryptError);
  });

  it('refuses an unknown format version', () => {
    expect(() => decryptSecret('v9:abcd', KEY)).toThrow(SecretDecryptError);
  });
});

describe('key validation', () => {
  it('rejects a key that is not 32 bytes', () => {
    expect(() => encryptSecret('x', Buffer.alloc(16).toString('base64'))).toThrow(SecretKeyError);
  });

  it('rejects a missing key', () => {
    expect(() => encryptSecret('x', undefined)).toThrow(SecretKeyError);
  });

  it('separates a bad key from a bad ciphertext', () => {
    // The whole point: a caller has to be able to tell "our config is broken"
    // from "this row is corrupt", because the first affects every professional
    // at once and the second affects one.
    expect(() => decryptSecret('v1:abcd', 'not-base64-32-bytes')).toThrow(SecretKeyError);
    expect(() => decryptSecret('v1:abcd', KEY)).toThrow(SecretDecryptError);
  });
});
