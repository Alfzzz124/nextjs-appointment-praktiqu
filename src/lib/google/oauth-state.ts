// The `state` parameter carried through Google's consent screen and back.
//
// It is the only thing tying the browser that returns to the professional who
// started the flow, and it carries the redirect target the front end asked for.
// So it is signed, not merely opaque: an attacker who could edit it could attach
// somebody else's Google account to their own professional, or aim the redirect
// wherever they liked.
//
// Same shape as src/lib/public/appointment-token.ts — HMAC-SHA256, base64url,
// constant-time comparison — so there is one signing idiom in this codebase
// rather than two.

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

if (process.env.NODE_ENV === 'production' && !process.env.AUTH_SECRET) {
  throw new Error('AUTH_SECRET must be set in production');
}

const SECRET = process.env.AUTH_SECRET ?? 'dev-secret-change-me';

/**
 * How long a consent flow may take.
 *
 * Long enough for someone to read Google's screen, pick an account and think
 * about it; short enough that a state captured from a browser history or a
 * referrer log is useless later.
 */
const LIFETIME_MS = 30 * 60_000;

/** A little slack for clock skew between processes. */
const FUTURE_TOLERANCE_MS = 60_000;

export interface OAuthStatePayload {
  professionalId: number;
  returnUrl: string;
}

interface StateBody extends OAuthStatePayload {
  /** Issued-at, epoch ms. */
  iat: number;
  /** Makes two states for the same payload differ, so one cannot stand in for another. */
  nonce: string;
}

export function signOAuthState(
  payload: OAuthStatePayload,
  opts: { issuedAt?: number } = {},
): string {
  const body: StateBody = {
    ...payload,
    iat: opts.issuedAt ?? Date.now(),
    nonce: randomBytes(9).toString('base64url'),
  };
  const encoded = Buffer.from(JSON.stringify(body), 'utf8').toString('base64url');
  const sig = createHmac('sha256', SECRET).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

export function verifyOAuthState(state: string): OAuthStatePayload | null {
  if (!state) return null;
  const parts = state.split('.');
  if (parts.length !== 2) return null;
  const [encoded, sig] = parts;
  if (!encoded || !sig) return null;

  const expected = createHmac('sha256', SECRET).update(encoded).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  // Length is checked first because timingSafeEqual throws on a mismatch, and the
  // length of a signature is not a secret.
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  let body: StateBody;
  try {
    body = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    return null;
  }

  if (typeof body.iat !== 'number') return null;
  const age = Date.now() - body.iat;
  // A state from the future is not clock skew beyond a minute's tolerance — it is
  // a timestamp someone chose, which would extend the lifetime indefinitely.
  if (age < -FUTURE_TOLERANCE_MS) return null;
  if (age > LIFETIME_MS) return null;

  if (typeof body.professionalId !== 'number' || typeof body.returnUrl !== 'string') {
    return null;
  }
  return { professionalId: body.professionalId, returnUrl: body.returnUrl };
}
