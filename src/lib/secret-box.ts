// Symmetric encryption for secrets this service must be able to read back —
// currently Google refresh tokens, which cannot be hashed because we have to
// present them to Google again.
//
// AES-256-GCM: authenticated, so a tampered or truncated ciphertext fails loudly
// instead of decrypting to rubbish. The envelope carries a version marker so the
// format can be changed later without guessing at what old rows contain.
//
// The two failure modes are deliberately separate types. A decryption failure that
// gets swallowed looks exactly like "nobody has connected Google yet" — every slot
// shows, nothing is blocked, nothing appears wrong — so the caller must be able to
// tell a broken key (our configuration, affecting everyone at once) from a broken
// row (one professional).

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/** The configured key is missing or not 32 bytes. Our problem, not a row's. */
export class SecretKeyError extends Error {
  readonly code = 'SECRET_KEY_INVALID';
}

/** This particular ciphertext cannot be read: corrupt, tampered, or from another key. */
export class SecretDecryptError extends Error {
  readonly code = 'SECRET_DECRYPT_FAILED';
}

const VERSION = 'v1';
const IV_BYTES = 12; // GCM's standard nonce length
const TAG_BYTES = 16;

function keyBuffer(base64Key: string | undefined): Buffer {
  if (!base64Key) {
    throw new SecretKeyError('No encryption key configured');
  }
  // Buffer.from never throws on bad base64 — it drops the invalid characters — so
  // the length check below is what actually catches a malformed key. A try/catch
  // here would only imply a protection that does not exist.
  const buf = Buffer.from(base64Key, 'base64');
  if (buf.length !== 32) {
    throw new SecretKeyError(`Encryption key must be 32 bytes, got ${buf.length}`);
  }
  return buf;
}

/** `v1:<base64(iv | tag | ciphertext)>` */
export function encryptSecret(plaintext: string, base64Key: string | undefined): string {
  const key = keyBuffer(base64Key);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${VERSION}:${Buffer.concat([iv, tag, body]).toString('base64')}`;
}

export function decryptSecret(token: string, base64Key: string | undefined): string {
  // Key first: an invalid key is our misconfiguration and should say so, whatever
  // the ciphertext looks like.
  const key = keyBuffer(base64Key);

  const separator = token.indexOf(':');
  const version = separator === -1 ? '' : token.slice(0, separator);
  if (version !== VERSION) {
    throw new SecretDecryptError(`Unsupported secret format ${JSON.stringify(version)}`);
  }

  const raw = Buffer.from(token.slice(separator + 1), 'base64');
  if (raw.length < IV_BYTES + TAG_BYTES) {
    throw new SecretDecryptError('Secret is too short to contain an IV and tag');
  }

  const iv = raw.subarray(0, IV_BYTES);
  const tag = raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const body = raw.subarray(IV_BYTES + TAG_BYTES);

  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
  } catch {
    // Deliberately not carrying the underlying message: it varies by Node version
    // and says nothing a caller can act on. What matters is which of the two
    // failures this is.
    throw new SecretDecryptError('Secret could not be decrypted');
  }
}
