/**
 * JWT issuance and verification.
 *
 * Uses `jose` per T001. Two token types:
 *   - Access  (15min) — stateless, contains `sub` (userId) + `role` (per FR-018)
 *   - Refresh (7d)    — opaque random string; we store SHA-256 hash server-side
 *
 * Refresh tokens are NOT JWTs; they're a 256-bit random string the client
 * passes verbatim. Only the SHA-256 hash lives in `refresh_tokens.tokenHash`.
 *
 * Configurable TTLs via env:
 *   JWT_ACCESS_TTL  (seconds, default 900   = 15min)
 *   JWT_REFRESH_TTL (seconds, default 604800 = 7d)
 *   JWT_SECRET      (required; HS256 key)
 */

import { SignJWT, jwtVerify, type JWTPayload, errors as joseErrors } from 'jose';
import { randomBytes, createHash } from 'node:crypto';

const SECRET = process.env.JWT_SECRET ?? process.env.AUTH_SECRET ?? 'dev-secret-change-me';
const KEY = new TextEncoder().encode(SECRET);

const ACCESS_TTL = parseInt(process.env.JWT_ACCESS_TTL ?? '900', 10);
const REFRESH_TTL = parseInt(process.env.JWT_REFRESH_TTL ?? '604800', 10);

export interface AccessTokenClaims extends JWTPayload {
  sub: string;          // userId
  role: 'SUPER_ADMIN' | 'CLINIC_ADMIN' | 'PROFESSIONAL' | 'RECEPTIONIST' | 'CLIENT';
  email: string;
  username: string;
  type: 'access';
  jti: string;          // unique token id
  iat: number;
  exp: number;
}

export interface RefreshTokenMaterial {
  token: string;        // raw token (give to client, never persist)
  tokenHash: string;    // SHA-256, store in DB
  familyId: string;     // groups tokens in the same lineage
  expiresAt: Date;
}

export class JwtError extends Error {
  constructor(public readonly code: 'invalid' | 'expired' | 'tampered' | 'wrong_type', message: string) {
    super(message);
    this.name = 'JwtError';
  }
}

/** Issue an access token (signed JWT). */
export async function issueAccessToken(claims: {
  userId: string;
  role: AccessTokenClaims['role'];
  email: string;
  username: string;
}): Promise<{ token: string; expiresAt: Date; jti: string }> {
  const jti = randomBytes(16).toString('hex');
  const now = Math.floor(Date.now() / 1000);
  const exp = now + ACCESS_TTL;

  const token = await new SignJWT({
    role: claims.role,
    email: claims.email,
    username: claims.username,
    type: 'access',
    jti,
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(claims.userId)
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .sign(KEY);

  return { token, expiresAt: new Date(exp * 1000), jti };
}

/** Verify an access-token JWT. Throws JwtError on failure. */
export async function verifyAccessToken(token: string): Promise<AccessTokenClaims> {
  try {
    const { payload } = await jwtVerify(token, KEY, { clockTolerance: 5 });
    if (payload.type !== 'access') {
      throw new JwtError('wrong_type', 'Not an access token');
    }
    return payload as AccessTokenClaims;
  } catch (err) {
    if (err instanceof joseErrors.JWTExpired) {
      throw new JwtError('expired', 'Access token expired');
    }
    if (err instanceof JwtError) throw err;
    throw new JwtError('invalid', 'Invalid access token');
  }
}

/** Generate a refresh token (opaque random string + SHA-256 hash). */
export function issueRefreshToken(familyId?: string): RefreshTokenMaterial {
  const token = randomBytes(48).toString('base64url');
  const tokenHash = hashToken(token);
  const family = familyId ?? randomBytes(16).toString('hex');
  const expiresAt = new Date(Date.now() + REFRESH_TTL * 1000);
  return { token, tokenHash, familyId: family, expiresAt };
}

/** Hash a raw token with SHA-256 for storage. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export const JWT_CONFIG = {
  accessTtlSeconds: ACCESS_TTL,
  refreshTtlSeconds: REFRESH_TTL,
} as const;
