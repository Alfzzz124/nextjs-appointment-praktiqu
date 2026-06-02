# Logging

**File**: `docs/architecture/logging.md`
**Status**: Canonical
**Date**: 2026-06-02

## Goal

Two things only:

1. **User activity** — who did what, when, from where. For support, audits, and operational visibility.
2. **Errors** — what broke, when, with enough context to reproduce. For debugging user reports like "I got an error."

Nothing else. No APM. No distributed tracing. No third-party log shippers. No Sentry. No OpenTelemetry. The constitution defers those; we keep it that way.

## Storage

A single `log_entries` Prisma table (one of the two PraktiQU-owned schemas on the shared MySQL instance). One table, level field, category field, JSON metadata. See `prisma/schema.prisma`.

```prisma
model LogEntry {
  id         String   @id @default(cuid())
  level      LogLevel
  category   LogCategory
  message    String
  userId     String?
  action     String?
  resource   String?
  resourceId String?
  ip         String?
  userAgent  String?
  requestId  String?
  path       String?
  method     String?
  statusCode Int?
  errorStack String?
  metadata   Json?
  occurredAt DateTime @default(now())
  ...
}
```

## Levels

| Level | Used for | Retention |
| --- | --- | --- |
| `DEBUG` | Verbose development logs (currently unused) | 7 days |
| `TRACE` | Per-request trace lines (currently unused) | 7 days |
| `INFO` | Normal activity records | 30 days |
| `WARN` | Recoverable issues (4xx with context, deprecation notices) | 30 days |
| `ERROR` | Unhandled exceptions, 5xx responses, integration failures | 30 days |
| `AUDIT` | Security-relevant events (login, password change, role change) | 90 days |
| `PERF` | (Deferred per constitution) | 7 days aggregated |

Purge is a scheduled job (depends on C8 — job runner decision).

## Categories

| Category | What goes here |
| --- | --- |
| `ACTIVITY` | User-facing actions: `user.login`, `session.book`, `client.create`, etc. |
| `ERROR` | Anything that broke: unhandled exceptions, 5xx, integration failures |
| `SYSTEM` | Background jobs, cron, scheduled tasks, server lifecycle |

## Writing entries

Use `src/lib/logging.ts`:

```ts
import { logging } from '@/lib/logging';

// User action
await logging.activity('session.book', {
  userId: session.userId,
  resource: 'session',
  resourceId: session.id,
  requestId: req.id,
  metadata: { serviceId, professionalId },
});

// Error
try {
  await someRiskyCall();
} catch (err) {
  await logging.error('Failed to book session', err, {
    userId: session.userId,
    requestId: req.id,
  });
  throw err;
}

// Background job
await logging.system('auto-completed 12 stale sessions');
```

The helper awaits the DB write and swallows DB failures (logging to `console.error` so container logs still capture them). A logging failure MUST NOT break a user request.

## Reading entries

- **For ops/debugging** (when a user reports an issue): `prisma.logEntry.findMany({ where: { userId, occurredAt: { gte: since } }, orderBy: { occurredAt: 'desc' } })`.
- **For audit** (security/compliance): filter by `level = 'AUDIT'`.
- **For API exposure** (future, SUPER_ADMIN only): `GET /api/v1/admin/logs?level=&category=&userId=&action=&since=&page=&limit=` — paginated. RFC 7807 errors. Not in MVP scope; add when first SUPER_ADMIN dashboard needs it.

## What's NOT in scope (deferred)

- Sentry / GlitchTip / third-party error trackers
- OpenTelemetry / distributed tracing
- APM / response-time dashboards
- Log shipping to S3 / Datadog / Loki
- Email alerts on `ERROR` (deferred until C7 email infrastructure is resolved)

These are all valid future enhancements but explicitly not built now. Constitution §APM defers them; this doc keeps that deferral.
