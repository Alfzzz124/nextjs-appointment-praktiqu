# Background Jobs — Architecture

**File**: `docs/architecture/background-jobs.md`
**Status**: Canonical
**Date**: 2026-06-02

## Decision: WordPress is the job runner

Per audit C8 resolution (user-confirmed, 2026-06-02):

PraktiQU's background jobs run on **WordPress's Action Scheduler** (the WooCommerce job library, vendored in the KiviCare plugin and used as-is by `praktiqu-endpoint`). PraktiQU does NOT run a long-lived worker process on its own (this is incompatible with the Cloudflare serverless deployment target).

## Architecture

```
┌────────────────────────┐                          ┌────────────────────────┐
│   PraktiQU (Next.js)   │                          │  WordPress + AS        │
│   on Cloudflare Pages  │                          │  (shared hosting)      │
│                        │                          │                        │
│  "schedule session X   │  POST /praktiqu/v1/jobs  │  as_schedule_single_   │
│   to auto-complete at  │ ───────────────────────▶│  action()              │
│   time T"              │  {hook, runAt, args}    │  → wp_actionscheduler_ │
│                        │ ◀── 201 {actionId} ────│    actions row         │
│                        │                          │                        │
│  (no worker process)   │                          │  WP-Cron fires hook at │
│                        │                          │  runAt (best-effort)   │
└────────────────────────┘                          └──────────┬─────────────┘
                                                           │ runs PHP handler
                                                           │ (in praktiqu-endpoint)
                                                           ▼
                                                ┌────────────────────────┐
                                                │  Handler does work:    │
                                                │   - session auto-      │
                                                │     complete → POSTs   │
                                                │     back to PraktiQU   │
                                                │   - reminder trigger → │
                                                │     POSTs back         │
                                                │   - log purge → SQL    │
                                                │     directly on shared │
                                                │     MySQL              │
                                                └────────────────────────┘
```

## Job Catalog (MVP)

| Hook | Args | Trigger | Handler behavior |
| --- | --- | --- | --- |
| `praktiqu_session_auto_complete` | `{ sessionId, webhookToken }` | When session CHECK_OUT commits, 005 schedules it for `session.endTime + 24h` | POSTs to PraktiQU `/api/v1/webhooks/wordpress-jobs` with `event: 'session.auto_complete'` → PraktiQU updates status to COMPLETED + creates bill via 011 |
| `praktiqu_session_send_reminder` | `{ sessionId, channel, webhookToken }` | 005 schedules 24h and 1h before each BOOKED session | POSTs to PraktiQU `event: 'session.reminder'` → PraktiQU's 012 enqueues the email |
| `praktiqu_log_purge` | (no args) | Plugin activation; recurring every 24h via `as_schedule_recurring_action` | WordPress plugin directly runs `DELETE FROM praktiqu_log_entries WHERE …` (no webhook; uses the shared MySQL connection) |

## PraktiQU contract

### Outbound (PraktiQU → WordPress)

```
POST /wp-json/praktiqu/v1/jobs
Headers:
  X-PraktiQU-Service-Token: <shared secret>
Body:
  { "hook": "praktiqu_session_auto_complete", "runAt": 1234567890, "args": { "sessionId": 42 } }
Response 201:
  { "actionId": 123 }
```

### Inbound (WordPress → PraktiQU)

```
POST /api/v1/webhooks/wordpress-jobs
Headers:
  X-PraktiQU-Webhook-Signature: <hex HMAC-SHA256 of body>
  X-PraktiQU-Webhook-Event: session.auto_complete
Body:
  {
    "source": "praktiqu-endpoint",
    "event": "session.auto_complete",
    "data": { "sessionId": 42 },
    "at": "2026-06-02T10:00:00Z"
  }
Response 200:
  { "ok": true }
```

Signature verification: HMAC-SHA256 of raw body, hex-encoded, constant-time compared. Secret = `WORDPRESS_WEBHOOK_SECRET` (env constant).

## Code locations

| Layer | File | Purpose |
| --- | --- | --- |
| WP plugin enqueue | `Wordpress-Plugin/praktiqu-endpoint/includes/class-praktiqu-endpoint-jobs.php` | `enqueue()`, `cancel()` |
| WP plugin handlers | same file | `handle_session_auto_complete()`, `handle_session_send_reminder()`, `handle_log_purge()` |
| WP plugin REST routes | `class-praktiqu-endpoint-rest-controller.php` | `POST /jobs`, `DELETE /jobs` |
| PraktiQU enqueue client | `src/lib/jobs/client.ts` | `jobs.enqueue()`, `jobs.cancel()` |
| PraktiQU webhook receiver | `src/lib/jobs/webhook-handler.ts` | `verifyWebhookSignature()`, `processWebhook()` |
| PraktiQU webhook route | `src/app/api/v1/webhooks/wordpress-jobs/route.ts` | POST handler |

## Failure modes

| Failure | What happens | Mitigation |
| --- | --- | --- |
| WordPress down at enqueue time | PraktiQU logs `[jobs] enqueue failed`, no job scheduled | Retried by 005 / 012 on the next user interaction; eventually self-corrects |
| WordPress down at handler time | Job stays in `pending`; AS retries per its own backoff | AS default is 5min, then 1h, then 24h |
| PraktiQU webhook down at handler time | WP plugin logs the failure; AS retries | Same as above |
| Job handler throws | AS catches and marks the action as failed | Visible in AS admin UI; re-run manually |

## Constraints

- **WP-Cron is best-effort**: jobs run when a WP page is hit. For a shared hosting site with at least one visitor every 15 minutes, fine. For a fully idle site, jobs are delayed until next visit.
- **Action Scheduler is a soft dependency**: if WooCommerce/AS is not installed, the enqueue endpoint returns 503 and PraktiQU logs the failure.
- **Cloudflare Pages + MySQL**: PraktiQU needs an HTTP-friendly MySQL proxy (e.g., Prisma Accelerate, PlanetScale, or a serverless-friendly MySQL provider) since Cloudflare Workers can't open TCP sockets.

## What's NOT in scope (deferred)

- BullMQ / Redis / dedicated worker process (not needed; WP already has the queue)
- Vercel Cron / Cloudflare Workers Cron Triggers (not needed; WP runs the jobs)
- A separate "job status" UI in PraktiQU (use the AS admin UI on WordPress for now)
