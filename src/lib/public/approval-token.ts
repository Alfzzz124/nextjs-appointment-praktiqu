// The token in the psychologist's "approve / reject" email link
// (spec docs/superpowers/specs/2026-10-29-approval-tautan-email-design.md §5).
//
// Same idiom as src/lib/google/oauth-state.ts and appointment-token.ts — HMAC-SHA256
// over the base64url body, constant-time comparison — so the codebase keeps one way of
// signing. The `p` field separates purposes: oauth-state signs its body exactly the same
// way with the same secret, so without it one token could be replayed as the other.
//
// No expiry in the token. Whether a link still works is decided from the booking when it
// is used: still waiting, the session not started, the same psychologist.

import { createHmac, timingSafeEqual } from 'node:crypto';

if (process.env.NODE_ENV === 'production' && !process.env.AUTH_SECRET) {
  throw new Error('AUTH_SECRET must be set in production');
}

const SECRET = process.env.AUTH_SECRET ?? 'dev-secret-change-me';
const PURPOSE = 'approval';

export interface ApprovalTokenPayload {
  appointmentId: number;
  doctorWpUserId: number;
}

interface TokenBody {
  /** Purpose. Always "approval". */
  p: string;
  /** wp_kc_appointments.id */
  a: number;
  /** The psychologist's wp_users.ID */
  d: number;
  /** Issued-at, epoch ms. Only makes each email's token different. */
  i: number;
}

const signature = (encoded: string): string => createHmac('sha256', SECRET).update(encoded).digest('base64url');
const isId = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;

export function signApprovalToken(payload: ApprovalTokenPayload, opts: { issuedAt?: number } = {}): string {
  const body: TokenBody = {
    p: PURPOSE,
    a: payload.appointmentId,
    d: payload.doctorWpUserId,
    i: opts.issuedAt ?? Date.now(),
  };
  const encoded = Buffer.from(JSON.stringify(body), 'utf8').toString('base64url');
  return `${encoded}.${signature(encoded)}`;
}

export function verifyApprovalToken(token: string): ApprovalTokenPayload | null {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encoded, sig] = parts;
  if (!encoded || !sig) return null;

  const a = Buffer.from(sig);
  const b = Buffer.from(signature(encoded));
  // Length first: timingSafeEqual throws on a mismatch, and a signature's length is no secret.
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  let body: unknown;
  try {
    body = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!body || typeof body !== 'object') return null;
  const { p, a: appointmentId, d: doctorWpUserId } = body as Partial<TokenBody>;
  if (p !== PURPOSE || !isId(appointmentId) || !isId(doctorWpUserId)) return null;
  return { appointmentId, doctorWpUserId };
}
