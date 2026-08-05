import { createHmac, timingSafeEqual } from 'crypto';

if (process.env.NODE_ENV === 'production' && !process.env.AUTH_SECRET) {
  throw new Error('AUTH_SECRET must be set in production');
}

const SECRET = process.env.AUTH_SECRET ?? 'dev-secret-change-me';

/**
 * Stateless guest token for public appointment access.
 * Format: base64url(appointmentId) + "." + base64url(HMAC-SHA256(appointmentId)).
 * No DB column required; verification is constant-time.
 */
export function signAppointmentToken(appointmentId: string | number): string {
  const id = String(appointmentId);
  const sig = createHmac('sha256', SECRET).update(id).digest('base64url');
  const idPart = Buffer.from(id, 'utf8').toString('base64url');
  return `${idPart}.${sig}`;
}

export function verifyAppointmentToken(token: string): string | null {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [idPart, sig] = parts;
  if (!idPart || !sig) return null;

  let appointmentId: string;
  try {
    appointmentId = Buffer.from(idPart, 'base64url').toString('utf8');
  } catch {
    return null;
  }
  if (!appointmentId) return null;

  const expected = createHmac('sha256', SECRET).update(appointmentId).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  if (!timingSafeEqual(a, b)) return null;
  return appointmentId;
}

/**
 * Same verification, decoded as a KiviCare appointment id.
 *
 * `wp_kc_appointments.id` is an auto-increment integer, so anything non-numeric is a
 * forgery or a token minted before the migration off the cuid tables — both must fail
 * closed rather than reach the database as NaN.
 */
export function verifyAppointmentIdToken(token: string): number | null {
  const raw = verifyAppointmentToken(token);
  if (raw === null) return null;
  if (!/^\d+$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}
