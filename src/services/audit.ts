/**
 * Audit service — typed event schemas per FR-010/011/012/022.
 *
 * Writes go to the `audit_logs` table. The `log_entries` table also captures
 * these via the `audit()` helper in `@/lib/logging`; this service provides
 * the canonical typed entry point and the API for the admin list endpoint.
 */

import { AuditEventType, type AuditLog, Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';

export interface AuditWriteInput {
  eventType: AuditEventType;
  actorId?: string | null;
  targetId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown> | null;
  /** If true, returns the persisted row (used by tests for SC-008). */
  returnRow?: boolean;
}

export interface AuditRecord extends AuditLog {}

/** Persist an audit event. Returns the row if `returnRow` is true. */
export async function recordAudit(input: AuditWriteInput): Promise<AuditRecord | null> {
  const row = await prisma.auditLog.create({
    data: {
      eventType: input.eventType,
      actorId: input.actorId ?? null,
      targetId: input.targetId ?? null,
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
      metadata: (input.metadata as Prisma.InputJsonValue) ?? Prisma.JsonNull,
    },
  });
  return input.returnRow ? row : null;
}

// ─── Typed event helpers per FR-010 ──────────────────────────────────────
// Each helper validates metadata at the TypeScript level so callers can't
// accidentally log the wrong shape.

export interface LoginSuccessMeta {
  userId: string;
  timestamp: string;
  ip: string;
  userAgent: string;
  method: 'password' | 'google';
}
export interface LoginFailureMeta {
  attemptedEmail: string;
  timestamp: string;
  ip: string;
  userAgent: string;
  reason: 'invalid_credentials' | 'inactive' | 'locked' | 'wp_reported';
}
export interface LogoutMeta {
  userId: string;
  timestamp: string;
  ip: string;
  refreshTokenId: string;
}
export interface TokenRefreshMeta {
  userId: string;
  timestamp: string;
  ip: string;
  oldRefreshTokenId: string;
  newRefreshTokenId: string;
}
export interface TokenRevokeMeta {
  userId: string;
  timestamp: string;
  ip: string;
  refreshTokenId: string;
  reason: 'logout' | 'password_change' | 'family_replay' | 'webhook' | 'admin';
}
export interface PasswordChangeMeta {
  userId: string;
  timestamp: string;
  ip: string;
  initiatedBy: 'self' | 'reset';
}
export interface PasswordResetRequestMeta {
  userId: string | null; // null when email unknown (no enumeration)
  email: string;
  timestamp: string;
  ip: string;
}
export interface PasswordResetCompleteMeta {
  userId: string;
  timestamp: string;
  ip: string;
}
export interface RoleChangeMeta {
  actorId: string;
  targetUserId: string;
  previousRole: string;
  newRole: string;
  timestamp: string;
  ip: string;
}
export interface RegisterMeta {
  userId: string;
  email: string;
  ip: string;
  timestamp: string;
}
export interface WebhookReceivedMeta {
  event: string;
  wpUserId: string | number | null;
  ip: string;
  timestamp: string;
}
export interface EmailDeliveryFailedMeta {
  to: string;
  template: string;
  error: string;
  timestamp: string;
}
export interface OAuthLinkMeta {
  userId: string;
  provider: 'google';
  email: string;
  timestamp: string;
  linked: boolean;
}

export const audit = {
  loginSuccess(meta: LoginSuccessMeta, opts?: { ip?: string | null; userAgent?: string | null }) {
    return recordAudit({
      eventType: AuditEventType.LOGIN_SUCCESS,
      actorId: meta.userId,
      targetId: meta.userId,
      ip: opts?.ip ?? meta.ip,
      userAgent: opts?.userAgent ?? meta.userAgent,
      metadata: meta as unknown as Record<string, unknown>,
    });
  },
  loginFailure(meta: LoginFailureMeta, opts?: { ip?: string | null; userAgent?: string | null }) {
    return recordAudit({
      eventType: AuditEventType.LOGIN_FAILURE,
      ip: opts?.ip ?? meta.ip,
      userAgent: opts?.userAgent ?? meta.userAgent,
      metadata: meta as unknown as Record<string, unknown>,
    });
  },
  logout(meta: LogoutMeta, opts?: { ip?: string | null; userAgent?: string | null }) {
    return recordAudit({
      eventType: AuditEventType.LOGOUT,
      actorId: meta.userId,
      targetId: meta.userId,
      ip: opts?.ip ?? meta.ip,
      userAgent: opts?.userAgent,
      metadata: meta as unknown as Record<string, unknown>,
    });
  },
  tokenRefresh(meta: TokenRefreshMeta, opts?: { ip?: string | null }) {
    return recordAudit({
      eventType: AuditEventType.TOKEN_REFRESH,
      actorId: meta.userId,
      targetId: meta.userId,
      ip: opts?.ip ?? meta.ip,
      metadata: meta as unknown as Record<string, unknown>,
    });
  },
  tokenRevoke(meta: TokenRevokeMeta) {
    return recordAudit({
      eventType: AuditEventType.TOKEN_REVOKE,
      actorId: meta.userId,
      targetId: meta.userId,
      ip: meta.ip,
      metadata: meta as unknown as Record<string, unknown>,
    });
  },
  passwordChange(meta: PasswordChangeMeta) {
    return recordAudit({
      eventType: AuditEventType.PASSWORD_CHANGE,
      actorId: meta.userId,
      targetId: meta.userId,
      ip: meta.ip,
      metadata: meta as unknown as Record<string, unknown>,
    });
  },
  passwordResetRequest(meta: PasswordResetRequestMeta) {
    return recordAudit({
      eventType: AuditEventType.PASSWORD_RESET_REQUEST,
      actorId: meta.userId,
      targetId: meta.userId,
      ip: meta.ip,
      metadata: meta as unknown as Record<string, unknown>,
    });
  },
  passwordResetComplete(meta: PasswordResetCompleteMeta) {
    return recordAudit({
      eventType: AuditEventType.PASSWORD_RESET_COMPLETE,
      actorId: meta.userId,
      targetId: meta.userId,
      ip: meta.ip,
      metadata: meta as unknown as Record<string, unknown>,
    });
  },
  roleChange(meta: RoleChangeMeta) {
    return recordAudit({
      eventType: AuditEventType.ROLE_CHANGE,
      actorId: meta.actorId,
      targetId: meta.targetUserId,
      ip: meta.ip,
      metadata: meta as unknown as Record<string, unknown>,
    });
  },
  register(meta: RegisterMeta) {
    return recordAudit({
      eventType: AuditEventType.REGISTER,
      actorId: meta.userId,
      targetId: meta.userId,
      ip: meta.ip,
      metadata: meta as unknown as Record<string, unknown>,
    });
  },
  webhookReceived(meta: WebhookReceivedMeta) {
    return recordAudit({
      eventType: AuditEventType.WEBHOOK_RECEIVED,
      ip: meta.ip,
      metadata: meta as unknown as Record<string, unknown>,
    });
  },
  emailDeliveryFailed(meta: EmailDeliveryFailedMeta) {
    return recordAudit({
      eventType: AuditEventType.EMAIL_DELIVERY_FAILED,
      metadata: meta as unknown as Record<string, unknown>,
    });
  },
  oauthLink(meta: OAuthLinkMeta) {
    return recordAudit({
      eventType: AuditEventType.OAUTH_LINK,
      actorId: meta.userId,
      targetId: meta.userId,
      metadata: meta as unknown as Record<string, unknown>,
    });
  },
} as const;

// ─── Admin listing (FR-021) ─────────────────────────────────────────────

export interface ListAuditParams {
  page: number;
  limit: number;
  userId?: string;
  eventType?: AuditEventType;
}

export interface ListAuditResult {
  rows: AuditLog[];
  total: number;
  page: number;
  limit: number;
}

export async function listAudit(params: ListAuditParams): Promise<ListAuditResult> {
  const where: Prisma.AuditLogWhereInput = {};
  if (params.userId) {
    where.OR = [{ actorId: params.userId }, { targetId: params.userId }];
  }
  if (params.eventType) where.eventType = params.eventType;

  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { occurredAt: 'desc' },
      skip: (params.page - 1) * params.limit,
      take: params.limit,
    }),
    prisma.auditLog.count({ where }),
  ]);

  return { rows, total, page: params.page, limit: params.limit };
}
