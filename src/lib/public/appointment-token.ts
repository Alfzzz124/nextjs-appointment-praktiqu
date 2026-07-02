import { createHmac, timingSafeEqual } from 'crypto';

const SECRET = process.env.AUTH_SECRET ?? 'dev-secret-change-me';

/**
 * Stateless guest token for public appointment access.
 * Format: base64url(appointmentId) + "." + base64url(HMAC-SHA256(appointmentId)).
 * No DB column required; verification is constant-time.
 */
export function signAppointmentToken(appointmentId: string): string {
  const sig = createHmac('sha256', SECRET).update(appointmentId).digest('base64url');
  const idPart = Buffer.from(appointmentId, 'utf8').toString('base64url');
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
