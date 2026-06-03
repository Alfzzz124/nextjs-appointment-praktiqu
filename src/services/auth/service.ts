/**
 * Auth service — core business logic for login, refresh, logout, password
 * change/reset, and registration. Routes are thin wrappers around this.
 */
// @ts-nocheck

import { createHash, randomBytes } from 'node:crypto';
import { Prisma, RefreshTokenStatus, UserRole, WebhookEventName } from '@prisma/client';
import { prisma } from '@/lib/db';
import {
  issueAccessToken,
  issueRefreshToken,
  hashToken,
  JWT_CONFIG,
  verifyAccessToken,
  type AccessTokenClaims,
} from '@/lib/auth/jwt';
import { toUserUpsertData, wpAuthenticate, wpChangePassword, wpGetUser, wpLookupByEmail, wpRegisterClient, type WpAuthSuccess } from '@/lib/auth/wp-auth';
import { audit } from '@/services/audit';
import { createRateLimiter, DEFAULT_RATE_LIMIT_CONFIG, tupleKey, type RateLimiter, type RateLimitVerdict } from '@/lib/rate-limit';

// ─── Errors ──────────────────────────────────────────────────────────────

export class AuthError extends Error {
  constructor(public readonly code: string, public readonly status: number, message?: string) {
    super(message ?? code);
  }
}

export class InvalidCredentialsError extends AuthError {
  constructor() {
    super('invalid_credentials', 401, 'Email or password is incorrect');
  }
}
export class InactiveUserError extends AuthError {
  constructor() {
    super('inactive', 403, 'Account is inactive');
  }
}
export class LockedError extends AuthError {
  constructor() {
    super('locked', 403, 'Account is locked');
  }
}
export class RateLimitedError extends AuthError {
  constructor(public readonly retryAfterMs: number) {
    super('rate_limited', 429, 'Too many attempts');
  }
}
export class TokenExpiredError extends AuthError {
  constructor() {
    super('token_expired', 401, 'Token expired');
  }
}
export class TokenRevokedError extends AuthError {
  constructor() {
    super('token_revoked', 401, 'Token revoked');
  }
}
export class WeakPasswordError extends AuthError {
  constructor(detail: string) {
    super('weak_password', 400, detail);
  }
}
export class DuplicateEmailError extends AuthError {
  constructor() {
    super('duplicate_email', 409, 'Email already registered');
  }
}
export class WpUnavailableError extends AuthError {
  constructor() {
    super('service_unavailable', 503, 'Authentication service unavailable');
  }
}
export class AccountInactiveError extends AuthError {
  constructor() {
    super('account_inactive', 401, 'Account inactive — please log in again');
  }
}

// ─── Rate limiter (process-singleton) ───────────────────────────────────

let _rateLimiter: RateLimiter | null = null;
function getRateLimiter(): RateLimiter {
  if (!_rateLimiter) {
    _rateLimiter = createRateLimiter({ config: DEFAULT_RATE_LIMIT_CONFIG });
  }
  return _rateLimiter;
}

/** Reset the rate limiter — test-only hook. */
export function _resetRateLimiterForTests(): void {
  _rateLimiter = createRateLimiter({ config: DEFAULT_RATE_LIMIT_CONFIG });
}

// ─── Helpers ─────────────────────────────────────────────────────────────

const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_REGEX = /[A-Za-z]/; // at least one letter
const PASSWORD_NUMBER_REGEX = /\d/; // at least one number

/** Validate password strength. Throws `WeakPasswordError` if weak. */
export function validatePasswordStrength(pwd: string): void {
  if (typeof pwd !== 'string' || pwd.length < PASSWORD_MIN_LENGTH) {
    throw new WeakPasswordError(`Password must be at least ${PASSWORD_MIN_LENGTH} characters`);
  }
  if (!PASSWORD_REGEX.test(pwd) || !PASSWORD_NUMBER_REGEX.test(pwd)) {
    throw new WeakPasswordError('Password must include letters and numbers');
  }
}

function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

function ensureUserActive(user: { status: number }, email: string): void {
  if (user.status === 0) {
    throw new InactiveUserError();
  }
}

function getClientIp(headers: Headers | Record<string, string | undefined>): string {
  if (headers instanceof Headers) {
    return (
      headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
      headers.get('x-real-ip') ??
      '0.0.0.0'
    );
  }
  return headers['x-forwarded-for']?.split(',')[0]?.trim() ?? headers['x-real-ip'] ?? '0.0.0.0';
}

// ─── Login ───────────────────────────────────────────────────────────────

export interface LoginInput {
  email: string;
  password: string;
  ip: string;
  userAgent: string;
}

export interface LoginResult {
  user: {
    id: string;
    email: string;
    username: string;
    firstName: string;
    lastName: string;
    displayName: string;
    role: UserRole;
    wpUserId: bigint | null;
  };
  accessToken: string;
  accessTokenExpiresAt: Date;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
}

export async function login(input: LoginInput): Promise<LoginResult> {
  const email = normaliseEmail(input.email);
  const key = tupleKey(input.ip, email);

  // Pre-check rate limit
  const pre = getRateLimiter().check(key);
  if (pre.kind !== 'allow') {
    throw rateLimitToError(pre);
  }

  const wp = await wpAuthenticate(email, input.password);
  if (!wp.ok) {
    const post = getRateLimiter().recordFailure(key);
    await audit.loginFailure(
      {
        attemptedEmail: email,
        timestamp: new Date().toISOString(),
        ip: input.ip,
        userAgent: input.userAgent,
        reason:
          wp.error.code === 'invalid_credentials'
            ? 'invalid_credentials'
            : wp.error.code === 'blocked'
              ? 'locked'
              : 'invalid_credentials',
      },
      { ip: input.ip, userAgent: input.userAgent },
    );
    if (post.kind !== 'allow') throw rateLimitToError(post);
    switch (wp.error.code) {
      case 'inactive':
        throw new InactiveUserError();
      case 'blocked':
        throw new LockedError();
      case 'invalid_credentials':
        throw new InvalidCredentialsError();
      default:
        throw new WpUnavailableError();
    }
  }

  // Sync user into PraktiQU DB.
  const upsert = toUserUpsertData(wp.user);
  const user = await prisma.user.upsert(upsert);

  ensureUserActive(user, email);

  // Issue tokens.
  const tokens = await issueTokensForUser(user, input.ip, input.userAgent);
  getRateLimiter().recordSuccess(key);

  await audit.loginSuccess(
    {
      userId: user.id,
      timestamp: new Date().toISOString(),
      ip: input.ip,
      userAgent: input.userAgent,
      method: 'password',
    },
    { ip: input.ip, userAgent: input.userAgent },
  );

  return {
    user: {
      id: user.id,
      email: user.email,
      username: user.username,
      firstName: user.firstName,
      lastName: user.lastName,
      displayName: user.displayName,
      role: user.role,
      wpUserId: user.wpUserId,
    },
    ...tokens,
  };
}

// ─── Token issuance (shared) ────────────────────────────────────────────

export interface IssuedTokens {
  accessToken: string;
  accessTokenExpiresAt: Date;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
}

export async function issueTokensForUser(
  user: { id: string; role: UserRole; email: string; username: string },
  ip: string,
  userAgent: string,
  familyId?: string,
): Promise<IssuedTokens> {
  const access = await issueAccessToken({
    userId: user.id,
    role: user.role,
    email: user.email,
    username: user.username,
  });
  const refresh = issueRefreshToken(familyId);
  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: refresh.tokenHash,
      familyId: refresh.familyId,
      userAgent,
      ipAddress: ip,
      expiresAt: refresh.expiresAt,
      status: RefreshTokenStatus.ACTIVE,
    },
  });
  return {
    accessToken: access.token,
    accessTokenExpiresAt: access.expiresAt,
    refreshToken: refresh.token,
    refreshTokenExpiresAt: refresh.expiresAt,
  };
}

// ─── Refresh ─────────────────────────────────────────────────────────────

export interface RefreshInput {
  refreshToken: string;
  ip: string;
  userAgent: string;
}

export interface RefreshResult extends IssuedTokens {
  rotatedOldId: string;
  rotatedNewId: string;
}

export async function refresh(input: RefreshInput): Promise<RefreshResult> {
  const tokenHash = hashToken(input.refreshToken);
  const row = await prisma.refreshToken.findUnique({ where: { tokenHash } });
  if (!row) throw new TokenRevokedError();

  if (row.status === RefreshTokenStatus.REVOKED) {
    // Replay attack: revoke the whole family.
    await prisma.refreshToken.updateMany({
      where: { familyId: row.familyId, status: RefreshTokenStatus.ACTIVE },
      data: { status: RefreshTokenStatus.REVOKED, revokedAt: new Date() },
    });
    await audit.tokenRevoke({
      userId: row.userId,
      timestamp: new Date().toISOString(),
      ip: input.ip,
      refreshTokenId: row.id,
      reason: 'family_replay',
    });
    throw new TokenRevokedError();
  }

  if (row.expiresAt.getTime() <= Date.now()) {
    await prisma.refreshToken.update({
      where: { id: row.id },
      data: { status: RefreshTokenStatus.EXPIRED },
    });
    throw new TokenExpiredError();
  }

  const user = await prisma.user.findUnique({ where: { id: row.userId } });
  if (!user) throw new TokenRevokedError();
  ensureUserActive(user, user.email);

  // Rotate: mark old as revoked, issue a new one in the same family.
  const issued = await issueTokensForUser(user, input.ip, input.userAgent, row.familyId);
  // Find the new row we just created (last by family + userId + status active)
  const newRow = await prisma.refreshToken.findFirst({
    where: { userId: user.id, familyId: row.familyId, status: RefreshTokenStatus.ACTIVE },
    orderBy: { issuedAt: 'desc' },
  });
  if (newRow) {
    await prisma.refreshToken.update({
      where: { id: row.id },
      data: { status: RefreshTokenStatus.REVOKED, revokedAt: new Date(), replacedById: newRow.id },
    });
    await prisma.refreshToken.update({
      where: { id: newRow.id },
      data: { parentId: row.id },
    });

    await audit.tokenRefresh({
      userId: user.id,
      timestamp: new Date().toISOString(),
      ip: input.ip,
      oldRefreshTokenId: row.id,
      newRefreshTokenId: newRow.id,
    });

    return { ...issued, rotatedOldId: row.id, rotatedNewId: newRow.id };
  }

  return { ...issued, rotatedOldId: row.id, rotatedNewId: '' };
}

// ─── Logout ──────────────────────────────────────────────────────────────

export interface LogoutInput {
  refreshToken?: string;
  userId?: string;
  ip: string;
  userAgent: string;
}

export async function logout(input: LogoutInput): Promise<void> {
  if (input.refreshToken) {
    const tokenHash = hashToken(input.refreshToken);
    const row = await prisma.refreshToken.findUnique({ where: { tokenHash } });
    if (row && row.status === RefreshTokenStatus.ACTIVE) {
      await prisma.refreshToken.update({
        where: { id: row.id },
        data: { status: RefreshTokenStatus.REVOKED, revokedAt: new Date() },
      });
      await audit.logout(
        {
          userId: row.userId,
          timestamp: new Date().toISOString(),
          ip: input.ip,
          refreshTokenId: row.id,
        },
        { ip: input.ip, userAgent: input.userAgent },
      );
      await audit.tokenRevoke({
        userId: row.userId,
        timestamp: new Date().toISOString(),
        ip: input.ip,
        refreshTokenId: row.id,
        reason: 'logout',
      });
      return;
    }
  }
  if (input.userId) {
    await audit.logout(
      {
        userId: input.userId,
        timestamp: new Date().toISOString(),
        ip: input.ip,
        refreshTokenId: 'n/a',
      },
      { ip: input.ip, userAgent: input.userAgent },
    );
  }
}

// ─── /me ─────────────────────────────────────────────────────────────────

export async function getMeFromAccessToken(accessToken: string) {
  const claims = await verifyAccessToken(accessToken);
  const user = await prisma.user.findUnique({ where: { id: claims.sub } });
  if (!user) throw new TokenRevokedError();
  if (user.status === 0) throw new AccountInactiveError();
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    firstName: user.firstName,
    lastName: user.lastName,
    displayName: user.displayName,
    role: user.role,
    wpUserId: user.wpUserId,
    emailVerified: user.emailVerified,
  };
}

// ─── Password reset ──────────────────────────────────────────────────────

const RESET_TTL = parseInt(process.env.RESET_TOKEN_TTL ?? '1800', 10); // 30min

export async function requestPasswordReset(email: string, ip: string, userAgent: string): Promise<{ ok: true }> {
  const normalised = normaliseEmail(email);
  const user = await prisma.user.findUnique({ where: { email: normalised } });
  await audit.passwordResetRequest({
    userId: user?.id ?? null,
    email: normalised,
    timestamp: new Date().toISOString(),
    ip,
  });

  if (!user) return { ok: true }; // no enumeration

  // Invalidate outstanding tokens for the user
  await prisma.passwordResetToken.updateMany({
    where: { userId: user.id, usedAt: null, expiresAt: { gt: new Date() } },
    data: { usedAt: new Date() },
  });

  const raw = randomBytes(32).toString('base64url');
  const tokenHash = createHash('sha256').update(raw).digest('hex');
  await prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash,
      expiresAt: new Date(Date.now() + RESET_TTL * 1000),
      ipAddress: ip,
      userAgent,
    },
  });

  return { ok: true };
}

export async function performPasswordReset(input: {
  token: string;
  newPassword: string;
  ip: string;
  userAgent: string;
}): Promise<{ userId: string }> {
  validatePasswordStrength(input.newPassword);

  const tokenHash = createHash('sha256').update(input.token).digest('hex');
  const row = await prisma.passwordResetToken.findUnique({ where: { tokenHash } });
  if (!row) throw new AuthError('invalid_reset_token', 400, 'Invalid or expired token');
  if (row.usedAt) throw new AuthError('invalid_reset_token', 400, 'Token already used');
  if (row.expiresAt.getTime() <= Date.now()) throw new AuthError('invalid_reset_token', 400, 'Token expired');

  const user = await prisma.user.findUnique({ where: { id: row.userId } });
  if (!user || !user.wpUserId) throw new AuthError('invalid_reset_token', 400, 'Invalid or expired token');

  const wpChange = await wpChangePassword(user.wpUserId, input.newPassword);
  if (!wpChange.ok) throw new WpUnavailableError();

  await prisma.$transaction([
    prisma.passwordResetToken.update({ where: { id: row.id }, data: { usedAt: new Date() } }),
    prisma.refreshToken.updateMany({
      where: { userId: user.id, status: RefreshTokenStatus.ACTIVE },
      data: { status: RefreshTokenStatus.REVOKED, revokedAt: new Date() },
    }),
  ]);

  await audit.passwordResetComplete({
    userId: user.id,
    timestamp: new Date().toISOString(),
    ip: input.ip,
  });
  return { userId: user.id };
}

// ─── Change password (authenticated) ────────────────────────────────────

export interface ChangePasswordInput {
  userId: string;
  currentPassword: string;
  newPassword: string;
  ip: string;
  userAgent: string;
}

export async function changePassword(input: ChangePasswordInput): Promise<IssuedTokens> {
  validatePasswordStrength(input.newPassword);
  const user = await prisma.user.findUnique({ where: { id: input.userId } });
  if (!user) throw new InvalidCredentialsError();
  if (!user.wpUserId) throw new WpUnavailableError();

  // Verify current password against WP
  const verify = await wpAuthenticate(user.email, input.currentPassword);
  if (!verify.ok || verify.user.wpUserId !== user.wpUserId) {
    throw new InvalidCredentialsError();
  }

  const wpChange = await wpChangePassword(user.wpUserId, input.newPassword);
  if (!wpChange.ok) throw new WpUnavailableError();

  // Invalidate all refresh tokens for the user (FR-006).
  await prisma.refreshToken.updateMany({
    where: { userId: user.id, status: RefreshTokenStatus.ACTIVE },
    data: { status: RefreshTokenStatus.REVOKED, revokedAt: new Date() },
  });
  await audit.passwordChange({
    userId: user.id,
    timestamp: new Date().toISOString(),
    ip: input.ip,
    initiatedBy: 'self',
  });
  return issueTokensForUser(user, input.ip, input.userAgent);
}

// ─── Register (self-service, FR-022) ────────────────────────────────────

export interface RegisterInput {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  ip: string;
  userAgent: string;
}

export async function register(input: RegisterInput): Promise<{ userId: string }> {
  const email = normaliseEmail(input.email);
  validatePasswordStrength(input.password);

  const key = tupleKey(input.ip, email);
  const pre = getRateLimiter().check(key);
  if (pre.kind !== 'allow') throw rateLimitToError(pre);

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    await getRateLimiter().recordFailure(key);
    throw new DuplicateEmailError();
  }

  const wp = await wpRegisterClient({
    email,
    password: input.password,
    firstName: input.firstName,
    lastName: input.lastName,
  });
  if (!wp.ok) {
    if (wp.error === 'duplicate') throw new DuplicateEmailError();
    throw new WpUnavailableError();
  }

  const upsert = toUserUpsertData(wp.wpUser, UserRole.CLIENT);
  const user = await prisma.user.upsert({
    where: { wpUserId: wp.wpUser.wpUserId },
    update: { ...upsert.update, role: UserRole.CLIENT },
    create: { ...upsert.create, role: UserRole.CLIENT, email, firstName: input.firstName, lastName: input.lastName, displayName: `${input.firstName} ${input.lastName}`.trim() || email },
  });

  await audit.register({
    userId: user.id,
    email,
    ip: input.ip,
    timestamp: new Date().toISOString(),
  });
  getRateLimiter().recordSuccess(key);
  return { userId: user.id };
}

// ─── Role change (admin) ────────────────────────────────────────────────

export interface ChangeRoleInput {
  actorId: string;
  actorRole: UserRole;
  targetUserId: string;
  newRole: UserRole;
  ip: string;
}

export async function changeRole(input: ChangeRoleInput): Promise<{ previousRole: UserRole }> {
  if (input.actorRole !== UserRole.SUPER_ADMIN) {
    throw new AuthError('forbidden', 403, 'Only SUPER_ADMIN can change roles');
  }
  const target = await prisma.user.findUnique({ where: { id: input.targetUserId } });
  if (!target) throw new AuthError('not_found', 404, 'User not found');
  const previousRole = target.role;

  await prisma.user.update({ where: { id: target.id }, data: { role: input.newRole } });

  await audit.roleChange({
    actorId: input.actorId,
    targetUserId: target.id,
    previousRole,
    newRole: input.newRole,
    timestamp: new Date().toISOString(),
    ip: input.ip,
  });

  return { previousRole };
}

// ─── WP sync helpers (used by webhooks) ─────────────────────────────────

export async function syncUserFromWp(wpUserId: bigint): Promise<{ userId: string } | null> {
  const wp = await wpGetUser(wpUserId);
  if (!wp) return null;
  const upsert = toUserUpsertData(wp);
  const user = await prisma.user.upsert({
    where: { wpUserId: wp.wpUserId },
    update: upsert.update,
    create: upsert.create,
  });
  return { userId: user.id };
}

export async function findUserByEmail(email: string) {
  return prisma.user.findUnique({ where: { email: normaliseEmail(email) } });
}

export async function revokeAllRefreshTokens(userId: string, reason: 'password_change' | 'webhook' | 'admin' = 'admin'): Promise<number> {
  const result = await prisma.refreshToken.updateMany({
    where: { userId, status: RefreshTokenStatus.ACTIVE },
    data: { status: RefreshTokenStatus.REVOKED, revokedAt: new Date() },
  });
  if (result.count > 0) {
    await audit.tokenRevoke({
      userId,
      timestamp: new Date().toISOString(),
      ip: '0.0.0.0',
      refreshTokenId: 'all',
      reason,
    });
  }
  return result.count;
}

export async function markUserInactive(userId: string): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { status: 0 } });
}

export async function markUserDeleted(userId: string): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { status: 0 } });
  await revokeAllRefreshTokens(userId, 'webhook');
}

// ─── Map rate-limit verdict → AuthError ──────────────────────────────────

function rateLimitToError(v: RateLimitVerdict): AuthError {
  if (v.kind === 'lockout') return new RateLimitedError(v.retryAfterMs);
  if (v.kind === 'progressive_delay') return new RateLimitedError(v.delayMs);
  return new RateLimitedError(0);
}

// ─── Re-exports for convenience ──────────────────────────────────────────

export { getClientIp, normaliseEmail, JWT_CONFIG, AccessTokenClaims, Prisma, WebhookEventName, WpAuthSuccess };
