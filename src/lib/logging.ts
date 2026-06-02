/**
 * Logging service — writes structured entries to the `log_entries` Prisma table.
 *
 * Source of truth: docs/architecture/logging.md
 * Constitution: §Logging & Monitoring (database-backed structured logging)
 *
 * Conventions:
 *   - `activity()` for user-facing actions (login, booking, edits, etc.)
 *   - `error()`   for unhandled exceptions, 5xx responses, integration failures
 *   - `system()`  for background jobs, scheduled tasks, server lifecycle
 *
 * This is a fire-and-log API. The DB write is awaited (so callers can be sure
 * the row exists before responding — important for debugging "user said they
 * got an error" reports). Errors from the DB write itself are swallowed and
 * forwarded to `console.error` so a logging failure never breaks user requests.
 */

import { Prisma, LogLevel, LogCategory } from '@prisma/client';
import { prisma } from './db';

export interface LogContext {
  userId?: string | null;
  action?: string;
  resource?: string;
  resourceId?: string;
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
  path?: string | null;
  method?: string | null;
  statusCode?: number;
  metadata?: Record<string, unknown> | null;
}

export interface ErrorLogContext extends LogContext {
  error?: Error | unknown;
}

/**
 * Log a user-facing activity event.
 *
 * @example
 *   await logging.activity('session.book', {
 *     userId: session.userId,
 *     resource: 'session',
 *     resourceId: session.id,
 *     requestId: req.id,
 *     metadata: { serviceId, professionalId },
 *   });
 */
export async function activity(action: string, context: LogContext = {}): Promise<void> {
  return write({
    level: LogLevel.INFO,
    category: LogCategory.ACTIVITY,
    message: action,
    action,
    ...context,
  });
}

/**
 * Log an error event. Pass an Error to capture its stack; otherwise pass
 * a string message. The stack is stored in `errorStack`; never logged to
 * stdout by this helper (use `console.error` separately if you need that).
 */
export async function error(
  message: string,
  err?: unknown,
  context: LogContext = {},
): Promise<void> {
  const errorStack = err instanceof Error ? err.stack : undefined;
  return write({
    level: LogLevel.ERROR,
    category: LogCategory.ERROR,
    message,
    errorStack,
    ...context,
  });
}

/**
 * Log a system event (background job, scheduled task, server lifecycle).
 */
export async function system(
  message: string,
  level: LogLevel = LogLevel.INFO,
  context: LogContext = {},
): Promise<void> {
  return write({
    level,
    category: LogCategory.SYSTEM,
    message,
    ...context,
  });
}

/**
 * Log an audit event (security-relevant action). 90-day retention.
 */
export async function audit(action: string, context: LogContext = {}): Promise<void> {
  return write({
    level: LogLevel.AUDIT,
    category: LogCategory.ACTIVITY,
    message: action,
    action,
    ...context,
  });
}

/**
 * Log a warning. For recoverable issues that should be investigated.
 */
export async function warn(message: string, context: LogContext = {}): Promise<void> {
  return write({
    level: LogLevel.WARN,
    category: LogCategory.SYSTEM,
    message,
    ...context,
  });
}

async function write(input: {
  level: LogLevel;
  category: LogCategory;
  message: string;
  action?: string;
  userId?: string | null;
  resource?: string;
  resourceId?: string;
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
  path?: string | null;
  method?: string | null;
  statusCode?: number;
  errorStack?: string;
  metadata?: Record<string, unknown> | null;
}): Promise<void> {
  try {
    await prisma.logEntry.create({
      data: {
        level: input.level,
        category: input.category,
        message: input.message,
        action: input.action ?? null,
        userId: input.userId ?? null,
        resource: input.resource ?? null,
        resourceId: input.resourceId ?? null,
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
        requestId: input.requestId ?? null,
        path: input.path ?? null,
        method: input.method ?? null,
        statusCode: input.statusCode ?? null,
        errorStack: input.errorStack ?? null,
        metadata: (input.metadata as Prisma.InputJsonValue) ?? Prisma.JsonNull,
        occurredAt: new Date(),
      },
    });
  } catch (dbError) {
    // Never let a logging failure break the user request.
    // Surface to stdout so it can still be picked up by container logs.
    // eslint-disable-next-line no-console
    console.error('[logging] failed to write log entry', {
      original: input.message,
      level: input.level,
      category: input.category,
      dbError: dbError instanceof Error ? dbError.message : String(dbError),
    });
  }
}

export const logging = { activity, error, system, audit, warn };
