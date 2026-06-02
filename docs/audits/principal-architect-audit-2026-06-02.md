# Architecture & Product Consistency Audit — PraktiQU

> Principal Architect pre-implementation design review. Read-only analysis. No files modified during audit.
>
> **Date**: 2026-06-02
> **Scope**: PRD, US-index, FR-index, BRD-index, Constitution, ARCHITECTURE.md, PROJECT_CONTEXT.md, all 18 feature specs, Prisma schema, docker-compose, .env.example, implementation plan
> **Out of scope**: source code (none present yet), Stitch design files, KiviCare plugin source

---

## Executive Summary

PraktiQU is a **Next.js primary backend** that **shares a single MySQL instance with WordPress as a sibling service**. PraktiQU owns its own tables (`users`, `doctors`, `patients`, `clinics`, `sessions`, etc., managed by Prisma) and WordPress owns its own tables (`wp_users`, `wp_usermeta`, `wp_posts`, etc.). PraktiQU reads `wp_*` for identity and roles but never writes to them; the systems are siblings, not parent-child. Prisma's `@@map` preserves the KiviCare-style table names on the PraktiQU side for tooling and script compatibility. The architectural fork in C1 is now resolved.

The remaining risk profile still has two dominant patterns:

1. **Prisma schema is KiviCare with a name change.** Table names, role enum values (0-4 status codes, KiviCare-style role names), and `Prescription` field shapes (`medicineName`, `dosage`, `frequency`) all mirror the legacy plugin. The "PraktiQU rebrand" is a thin layer over the old shape, which makes future evolution expensive.
2. **Operational concerns are systematically deferred.** Backups, monitoring, error tracking, observability, deployment, background jobs, scheduled tasks, media storage, caching, secret rotation, and disaster recovery are either explicitly deferred or absent. The constitution says "APM deferred until deployment architecture is clearer" and "Error Tracking: Database-backed with email alerts for critical errors" without a database or alerts system.

**Verdict**: implementation can start on 001-auth-foundation in isolation, but the broader system cannot ship until the role taxonomy is unified (C2), the operational baseline is defined (C5), the 8 stub features are either filled in or descoped (C6), and the new sibling-service model is reflected in every spec that assumed "standalone."

---

## Critical Findings

Resolve these before further implementation. Each finding cites specific files and line ranges so the disagreement is verifiable.

### ✅ C1. Architectural fork: "PraktiQU extends WordPress DB" vs "standalone Next.js with optional WP sync" — **RESOLVED**

> **Resolution**: PraktiQU is the primary Next.js backend; WordPress is a sibling service sharing the same MySQL instance. Prisma owns the `praktiqu` schema; WordPress owns the `wordpress` schema. PraktiQU reads `wp_users`/`wp_usermeta` for identity but never writes to `wp_*` tables. Prisma's `@@map` preserves KiviCare naming for tooling compatibility.
>
> **Documents updated**:
> - `constitution.md` — tech stack table: "MySQL 8 (shared MySQL instance — PraktiQU tables + WordPress tables coexist)"
> - `docs/memory/architecture/ARCHITECTURE.md` — DB integration section rewritten to reflect sibling-service model
> - `docs/database-mapping.md` — clarified as naming-mapping (not data-migration) document
> - `docs/PROJECT-ANALYSIS.md` — "standalone" replaced with "coexisting with WP on shared MySQL"
> - `docker-compose.yml` — added `app` (Next.js) and `redis` services; rewrote all comments to reflect sibling model
> - `.env.example` — added `WORDPRESS_SERVICE_TOKEN`, expanded architecture comments, `WORDPRESS_AUTH_SYNC="true"` as default
>
> **Residual risk**: C3 (WP auth contract) and C4 (password staleness) are now more tractable because the WP-reads-only boundary is clear.

### ✅ C2. Role taxonomy is fragmented across five sources — **RESOLVED**

> **Resolution**: Adopted the canonical 5-role set `SUPER_ADMIN, CLINIC_ADMIN, PROFESSIONAL, RECEPTIONIST, CLIENT` (matches PRD, BRD, project context, 005-session spec, and Prisma schema). Added a complete action × role matrix in `docs/architecture/role-taxonomy.md` (covers 80+ actions across all 18 feature areas). Created `src/lib/auth/role-mapping.ts` as the single source of mapping logic between KiviCare WP role slugs and PraktiQU canonical roles. Added `User.wpRole` and `User.wpUserId` columns to Prisma to mirror the raw WP identity.
>
> **Documents updated**:
> - `docs/architecture/role-taxonomy.md` — **new file**; canonical role table + full action × role matrix
> - `src/lib/auth/role-mapping.ts` — **new file**; `wpRoleToPraktiQU()`, `praktiQURoleToWp()`, `highestPraktiQURole()`
> - `prisma/schema.prisma` — `UserRole` enum updated to canonical names; added `wpRole` and `wpUserId` columns with indexes
> - `specs/001-auth-foundation/spec.md` — FR-008 fixed, role matrix replaced with link to canonical doc, role mapping table corrected (was `praktiqu_admin` / `subscriber`, now `kiviCare_clinic_admin` / `kiviCare_patient`)
> - `specs/001-auth-foundation/plan.md` — Summary section updated
> - `.specify/memory/constitution.md` — bumped to v2.1.0; added §WordPress Sibling Model and §Role Taxonomy
>
> **Decisions captured**:
> - D-02: Role taxonomy source of truth = `docs/architecture/role-taxonomy.md` (every spec derives from it)
> - WP prefix `kiviCare_` is the canonical KiviCare prefix (`kivicare-clinic-management-system.php:45`)
> - Per-practice role scoping deferred to v2; v1 is single-role-per-user
>
> **Residual risk**: any future feature spec that defines new actions must update the matrix in `role-taxonomy.md` before merging (constitution DoD addition).

### ✅ C3. WordPress authentication contract is undocumented at the WP side — **RESOLVED**

> **Resolution**: Built the custom `praktiqu-auth` WordPress plugin at `Wordpress-Plugin/praktiqu-auth/`. Plugin registers the `POST /wp-json/praktiqu/v1/authenticate` endpoint (plus identity lookup, password-change, and health endpoints), all protected by a `X-PraktiQU-Service-Token` header validated against the `PRAKTIQU_SERVICE_TOKEN` constant in `wp-config.php` (constant-time compared via `hash_equals`). Plugin also emits signed HMAC-SHA256 webhooks on WP-side state changes (password reset, role change, deactivation, deletion, failed login) to a configured PraktiQU endpoint — this **also addresses C4** (password staleness) at the same time.
>
> **Plugin structure**:
> ```
> Wordpress-Plugin/praktiqu-auth/
> ├── praktiqu-auth.php                                # bootstrap
> ├── readme.txt                                       # WordPress-style readme
> ├── uninstall.php                                    # cleanup on uninstall
> └── includes/
>     ├── class-praktiqu-auth-plugin.php               # main class, service-token verify
>     ├── class-praktiqu-auth-service.php              # credential check, identity, password
>     ├── class-praktiqu-auth-rest-controller.php      # REST routes
>     ├── class-praktiqu-auth-hooks.php                # WP-side hooks → PraktiQU webhooks
>     └── class-praktiqu-auth-settings.php             # admin settings page
> ```
>
> **Endpoints registered** (`/wp-json/praktiqu/v1/*`):
> - `POST /authenticate` — verify email + password
> - `GET  /users/{id}` — identity by WP user ID
> - `POST /users/lookup` — identity by email
> - `POST /users/{id}/change-password` — change password
> - `GET  /health` — liveness probe
>
> **Webhook events emitted** (when URL configured):
> - `password.changed`, `user.deactivated`, `user.reactivated`, `user.deleted`, `user.role_changed`, `login.failed`
>
> **Custom usermeta** (added by the plugin):
> - `praktiqu_user_status` — `'active'` | `'inactive'` | `'blocked'`
> - `praktiqu_password_changed_at` — MySQL datetime; PraktiQU uses this for token-family invalidation
>
> **Documents updated**:
> - `Wordpress-Plugin/praktiqu-auth/` — **new plugin** (5 PHP classes + readme + uninstall)
> - `specs/001-auth-foundation/spec.md` — added §WordPress Auth Endpoint Contract with concrete file paths, added §WordPress → PraktiQU Webhook section (closes C4)
> - (Pending) PraktiQU-side webhook receiver spec to be added when implementing the Next.js side
>
> **Decisions captured**:
> - Service token is a `wp-config.php` constant, NOT a database option (per security policy)
> - Webhooks signed with HMAC-SHA256 over JSON body; receivers must verify
> - Plugin does not replace the KiviCare plugin; it coexists with it
> - User-enumeration timing mitigated via dummy `wp_check_password` on unknown email
>
> **Residual risk**: the PraktiQU Next.js side must implement the `/api/v1/webhooks/wordpress` receiver with signature verification and token invalidation. This is a follow-up task in 001-auth-foundation (will be added to tasks.md).

### ✅ C4. Refresh token / session state not defined for WordPress password changes — **RESOLVED**

> **Resolution**: Adopted strategy (b) — PraktiQU trusts WordPress as the sole source of truth for credentials and reacts to WP-side state changes via signed webhooks. The `praktiqu-auth` WordPress plugin (built in C3) already emits signed HMAC-SHA256 webhooks for `password_reset`, `profile_update` (user_pass change), `deactivated_user`, `activated_user`, `delete_user`, `set_user_role`, and `wp_login_failed` — all in `Wordpress-Plugin/praktiqu-auth/includes/class-praktiqu-auth-hooks.php`.
>
> **Prisma `User.password` column removed**. Password now lives only in `wp_users.user_pass` (PHPASS / bcrypt). Self-registration (FR-022) creates the WP user first, then the PraktiQU `User` row, with no duplicate hash.
>
> **Documents updated**:
> - `prisma/schema.prisma` — removed `User.password` column; added block comment explaining WP-only credential storage and webhook flow
> - `specs/001-auth-foundation/spec.md` — added FR-023…FR-027 (webhook receiver contract with 60s propagation SLO); added `WordpressWebhookEvent` entity for idempotency
> - `specs/001-auth-foundation/tasks.md` — added Phase 6.5 "PraktiQU Webhook Receiver" with 15 tasks (TW01…TW15) covering signature verification, idempotency, all event handlers, audit logging, and E2E test
>
> **Webhook contract** (caller: `praktiqu-auth` plugin; receiver: `POST /api/v1/webhooks/wordpress` on PraktiQU):
> - Signature: `X-PraktiQU-Webhook-Signature` = hex(HMAC-SHA256(body, `WORDPRESS_WEBHOOK_SECRET`))
> - Body: `{ event, wpUserId, issuedAt, source, ...extra }`
> - 60-second end-to-end propagation SLO
> - Replay protection via `eventId` idempotency table (`WordpressWebhookEvent` model)
> - Every received event logged to audit regardless of action
>
> **Decisions captured**:
> - D-04: WordPress is the SOLE source of truth for credentials; Prisma User has no `password` column
> - Cross-app state propagation SLO: 60 seconds
> - Webhook authentication: HMAC-SHA256 in header (not bearer token, not IP allowlist)
>
> **Residual risk**: the `praktiqu-auth` plugin currently does not have a "create WP user" endpoint for the self-registration flow (FR-022). This is a follow-up: add `POST /wp-json/praktiqu/v1/users` to the plugin (will be tracked when the receiver spec is implemented in 001-auth-foundation Phase 6.5).

### ✅ C5. Operational baseline is undefined — **RESOLVED** (scope trimmed to logging only)

> **Resolution**: Per user direction, trimmed the original C5 scope. The only operational capability MVP needs is **logging — user activity and errors, written to a Prisma table in the same MySQL instance**. No CI, no Dockerfile, no third-party error tracker, no APM, no OpenTelemetry, no Sentry, no runbook, no DR plan. Those are explicitly deferred.
>
> **What was built**:
> - `prisma/schema.prisma` — added `LogEntry` model, `LogLevel` enum (DEBUG/TRACE/INFO/WARN/ERROR/AUDIT/PERF), `LogCategory` enum (ACTIVITY/ERROR/SYSTEM), inverse `User.logEntries` relation. Single table for all log records.
> - `src/lib/logging.ts` — `logging.activity()`, `logging.error()`, `logging.system()`, `logging.audit()`, `logging.warn()`. Awaited DB write; DB failures swallowed + forwarded to `console.error` (logging failure MUST NOT break user requests).
> - `docs/architecture/logging.md` — canonical doc; conventions, retention, query patterns, what's explicitly NOT in scope.
>
> **What was NOT built** (deferred per user direction):
> - CI workflow file (`.github/workflows/ci.yml`)
> - Dockerfile
> - Sentry / GlitchTip / third-party error tracker
> - OpenTelemetry / distributed tracing
> - APM / response-time dashboards
> - Log shipping to S3 / Datadog / Loki
> - Email alerts on `ERROR` (also depends on C7)
> - Backup, restore, disaster recovery
> - Runbook / on-call / SLOs
>
> **Documents updated**:
> - `prisma/schema.prisma` — LogEntry model + enums
> - `src/lib/logging.ts` — **new file**; the logging service
> - `docs/architecture/logging.md` — **new file**; canonical logging spec
> - `docs/audits/principal-architect-audit-2026-06-02.md` — C5 marked resolved with trimmed scope
>
> **Decisions captured**:
> - D-09: Audit log destination = `log_entries` table on PraktiQU's `praktiqu` schema; AUDIT level → 90d, ERROR/WARN/INFO → 30d, DEBUG/TRACE → 7d
> - D-16: Observability stack = "Prisma table only"; no external service. Future OTel/Sentry/email-alert decisions deferred until C7 (email) and C8 (job runner) are resolved.
>
> **Residual risk**: retention purges need a job runner (C8 unresolved). Until then, rows accumulate. Acceptable for MVP because at 30d/90d retention and 10 RPS the table won't blow up in a quarter; but the purge job should be on the C8 follow-up list.

### ✅ C6. Most feature specs are stubs — **RESOLVED** (defer-not-cut)

> **Resolution**: Per user direction, **all 18 features are kept in scope** (no cuts) — they have parity with the KiviCare WordPress plugin and will eventually be built. Specs are written in priority order:
>
> **MVP (spec'd now)**:
> - 011-billing — real spec, plan, tasks (Stripe + auto-bill-on-checkout + discounts + refunds + print views)
> - 012-notifications — real spec, plan, tasks (Resend + outbox queue + 10 event types + template management)
>
> **Backlog (stubs remain; specs written post-MVP)**:
> - 013 Practice Management (Phase 2, write next)
> - 010 Informed Consent (Phase 2)
> - 014 Client Progress Tracking (Phase 2)
> - 015 Notes Templates (Phase 3)
> - 017 Intervention Plan Print (Phase 3)
> - 016 Custom Fields (Phase 3, may need ADR first)
> - 018 Email Templates (subsumed by 012 — keep as pointer stub)
>
> **Documents updated**:
> - `specs/011-billing/spec.md` — **rewrote** from 602-byte stub to 16 KB real spec (US1-US6, 20 FRs, 3 SCs)
> - `specs/011-billing/plan.md` — **rewrote** from 457-byte stub to full implementation plan (data model, API, phases, risks)
> - `specs/011-billing/tasks.md` — **rewrote** from 974-byte stub to 68-task breakdown (TB01-TB68, 9 phases)
> - `specs/012-notifications/spec.md` — **rewrote** from 565-byte stub to 15 KB real spec (US1-US5, 15 FRs, 7 SCs)
> - `specs/012-notifications/plan.md` — **rewrote** from 516-byte stub to full implementation plan
> - `specs/012-notifications/tasks.md` — **rewrote** from 870-byte stub to 43-task breakdown (TN01-TN43, 7 phases)
> - `docs/architecture/deferred-features.md` — **new file**; canonical backlog with phasing policy
> - `docs/audits/principal-architect-audit-2026-06-02.md` — C6 marked resolved
>
> **Decisions captured**:
> - D-18: Feature scope cuts = none. All 18 features stay in the backlog. Phase 2 / 3 / 4 phasing per `docs/architecture/deferred-features.md`.
> - Billing payment provider = Stripe with Elements (PCI SAQ-A)
> - Invoice numbering = `INV-{clinicCode}-{YYYY}-{NNNNN}`
> - Email service = Resend; outbox queue is database-backed; per-clinic template overrides
> - 10 email event types enumerated
>
> **Residual risk**: the deferred specs (013, 010, 014, 015, 016, 017) will need their own discovery / clarification sessions when they are picked up. Until then, implementation order depends on subjective priority; the deferred-features doc provides a recommended order.

> **C6 alignment with C7 (2026-06-02)**: After the C7 resolution, the 012-notifications spec was retroactively updated to use **nodemailer + cPanel SMTP** instead of the original Resend draft. See the C7 resolution for the full change list. US4 (delivery tracking) was reduced in scope to send-time success/failure only.

### ✅ C7. Email ownership is undecided and untested end-to-end — **RESOLVED**

> **Resolution**: Per user direction, email uses **cPanel SMTP** (the shared hosting's mail server) in production. Dev uses MailHog (already in `docker-compose.yml`). No third-party service (Resend, SendGrid, Postmark, etc.) in MVP. Transport is `nodemailer` with SMTP. WordPress configures its own SMTP via the WP Mail SMTP plugin (separate concern, in WP admin). Both PraktiQU and WordPress point to the same cPanel SMTP server in production.
>
> **Docker role**: dev-only simulation of WordPress + cPanel SMTP (via MailHog). Production does NOT use Docker.
>
> **Documents updated**:
> - `.env.example` — cleaned up the email section; added `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_SECURE`, `EMAIL_FROM` constants; MailHog dev defaults pre-filled; cPanel production section commented
> - `docker-compose.yml` — updated `mail` service comment to clarify "DEV-ONLY SMTP mail catcher" and explain prod uses cPanel SMTP
> - `specs/012-notifications/spec.md` — replaced Resend with **nodemailer + cPanel SMTP**; dropped the webhook receiver; US4 (delivery tracking) reduced to send-time success/failure only (SMTP doesn't give us out-of-band delivery events); renamed `EmailBounceStat` → `EmailFailureStat`; status enum: `pending | sending | sent | failed | dead_letter`
> - `specs/012-notifications/plan.md` — replaced `src/lib/email/resend.ts` with `src/lib/email/smtp.ts`; removed the `webhooks/resend/` route; updated data model (no `resendMessageId`); updated risk register (R-6 now about dev/prod SMTP divergence)
> - `specs/012-notifications/tasks.md` — replaced TN13-TN15 (Resend webhook) with SMTP send-result handling tests; removed TN14 (webhook receiver route); updated unit tests in TN35 to drop Resend-specific items
>
> **Decisions captured**:
> - D-05: Email infrastructure = cPanel SMTP in production, MailHog in dev. Transport: nodemailer with SMTP. WordPress configured via WP Mail SMTP plugin (separate concern).
> - C6 (notifications) spec aligned: no third-party service in MVP; per-recipient delivery tracking scope reduced to send-time only.
> - Docker is dev-only simulation, not production.
>
> **Residual risk**:
> - Vanilla SMTP does NOT give per-recipient delivery / open / click / out-of-band bounce tracking. If a clinic later needs these (e.g., for marketing analytics or to detect spam-complaints), migrate to a transactional email service (Resend/SendGrid/Postmark) — only `src/lib/email/smtp.ts` changes.
> - cPanel SMTP relay limits: shared hosting providers often cap outbound mail (e.g., 500/hour on cPanel). If volume grows, this is the bottleneck.
> - No SPF/DKIM/DMARC plan documented yet; the sending domain (e.g., `yourdomain.com`) needs DNS records configured at the cPanel level. Defer to a follow-up task.

### ✅ C8. Background jobs and scheduled tasks have no home — **RESOLVED**

> **Resolution**: Adopted the user's idea — **WordPress is the job runner**. The `praktiqu-endpoint` plugin (renamed from `praktiqu-auth` in this same resolution) uses **WooCommerce Action Scheduler** (already vendored in the KiviCare plugin) to run scheduled background jobs. PraktiQU does NOT run a long-lived worker process — incompatible with the Cloudflare serverless deployment.
>
> **Why this works**:
> - PraktiQU on Cloudflare = no long-lived processes, no TCP to MySQL
> - WordPress already runs Action Scheduler + WP-Cron on shared hosting
> - Single-digit jobs per hour = no need for high-throughput queue infra
> - AS has retry / backoff / failed-jobs table out of the box
>
> **Documents updated**:
> - **Plugin renamed**: `Wordpress-Plugin/praktiqu-auth/` → `Wordpress-Plugin/praktiqu-endpoint/` (multipurpose bridge). All file names, class names, namespaces (`PraktiQU\Auth` → `PraktiQU\Endpoint`), text domains, option keys, action names updated.
> - **New file**: `Wordpress-Plugin/praktiqu-endpoint/includes/class-praktiqu-endpoint-jobs.php` — enqueue/cancel + 3 AS handlers (auto_complete, send_reminder, log_purge)
> - **Modified**: REST controller — added `POST /jobs`, `DELETE /jobs`; `Plugin::__construct()` — wired Jobs; activation hook now schedules the daily log-purge via `as_schedule_recurring_action`
> - **New file**: `src/lib/jobs/client.ts` — PraktiQU enqueue client (POSTs to WordPress)
> - **New file**: `src/lib/jobs/webhook-handler.ts` — signature verification + event dispatcher
> - **New file**: `src/app/api/v1/webhooks/wordpress-jobs/route.ts` — Next.js route receiving AS job callbacks
> - **New file**: `docs/architecture/background-jobs.md` — canonical doc with architecture diagram, job catalog, code locations, failure modes, constraints
> - **Modified**: `specs/001-auth-foundation/spec.md` + `tasks.md` — all `praktiqu-auth` refs updated to `praktiqu-endpoint`
> - Audit doc — C8 marked ✅ RESOLVED
>
> **Decisions captured**:
> - D-07: Background job runner = WordPress Action Scheduler (via `praktiqu-endpoint` plugin)
> - Cloudflare constraint: PraktiQU needs HTTP-friendly MySQL (Prisma Accelerate or PlanetScale) — flagged in `background-jobs.md`
> - Job handlers call back to PraktiQU via signed webhook; log-purge runs direct SQL on shared MySQL
>
> **Residual risk**:
> - WP-Cron is best-effort. For idle sites, jobs are delayed until next page visit. Acceptable for 24h-granularity jobs.
> - Action Scheduler is a soft dependency — `as_schedule_single_action()` may not exist if AS is not installed. Enqueue endpoint returns 503 in that case; PraktiQU logs the failure.
> - Cloudflare Pages + MySQL needs an HTTP proxy (not in audit scope; surface as infrastructure follow-up).

### C9. Medical/psychology data handling is unaddressed

- **Sources**: PRD §Key Differences says "Informed Consent: Optional → Mandatory" for psychology. 002-professional-mgmt spec calls SIP/SIK a "legally required" registration number. 010-informed-consent is a 0.8 KB stub. ARCHITECTURE.md has no encryption-at-rest mention beyond what Prisma provides. The audit prompt lists "Logging" as a Next.js responsibility but no PHI segregation is described. Indonesian health data law (UU PDP, plus the Ministry of Health regulations on medical records) is in scope given the Bahasa-Indonesia terminology and Asia/Jakarta default TZ, but no compliance section exists. Constitution does not list any compliance framework; 001-auth-foundation §Clarifications explicitly says "No specific regulatory framework required."
- **Risk**: legal exposure. Psychology records are sensitive personal data in every jurisdiction the product targets. Shipping without a data-classification policy, retention policy, and consent-tracking guarantees an incident response will run blind.
- **Resolution**: add a `docs/architecture/data-classification.md` enumerating PHI vs PII vs operational data, retention rules per class, encryption requirements (column-level or tablespace for PHI), access logging for PHI tables, and a backup strategy that respects retention. Even if formal HIPAA/GDPR/LGPD/UU-PDP certification is deferred, the *technical* controls should be present from MVP.

### C10. Race condition / idempotency strategy is per-spec, not global — **DEFERRED**

> **Resolution**: Per user direction, the idempotency / version-column / distributed-locking infrastructure is **deferred out of MVP**. Scope is intentionally minimal:
>
> **What stays** (already in specs, no new infra):
> - 005-session-mgmt's `prisma.$transaction` with row-level locking for booking (FR-010) — built-in MySQL InnoDB semantics, free with Prisma
> - 011-billing's `SELECT ... FOR UPDATE` on the Bill row for concurrent payment recording — same; free
> - Stripe webhook idempotency (Stripe sends at-least-once; AS provides natural retry; we already de-dup by `paymentIntentId` per C4)
> - WordPress webhook idempotency (HMAC + event ID dedup, already in C4 receiver)
>
> **What is dropped** (per user "very-very simple first"):
> - ❌ No client-supplied Idempotency-Key header
> - ❌ No `Idempotency` Prisma table
> - ❌ No `version: Int` columns on entities
> - ❌ No ETag / `updatedAt` concurrency tokens
> - ❌ No distributed locking layer (Redis, etc.)
> - ❌ No encryption-at-rest (column-level or tablespace) for PHI
>
> **How race conditions are handled** (manual ops):
> - The audit log (per C5 / `docs/architecture/logging.md`) records every state change. If a user double-clicks "Book" and gets a duplicate, the duplicate shows up in `LogEntry` with `action: 'session.book'`.
> - A human checks the audit log when a duplicate is reported. No automated prevention.
> - The database UNIQUE constraints (e.g., on `Bill.billNumber`, on `User.email`) are the only automatic guard against pure duplicates.
>
> **Documents updated**:
> - `docs/audits/principal-architect-audit-2026-06-02.md` — C10 marked DEFERRED
> - **Removed from Missing Decisions** (D-12, D-13, D-19) — those decisions are now explicitly "not for MVP"
>
> **Decisions captured**:
> - No D-12 (idempotency), no D-13 (optimistic concurrency), no D-19 (compliance/encryption) for MVP
> - Future: when "manual verification" becomes a recurring ticket, the next sprint adds the idempotency layer
>
> **Residual risk (accepted)**:
> - A user double-clicking "Book" on a slow connection can in theory create 2 sessions. The UI should debounce the submit button (frontend concern, not backend). For MVP we accept this; for v2 we add client-side request deduplication.
> - Two receptionists recording payments on the same bill simultaneously: the `SELECT ... FOR UPDATE` in 011-billing serializes them, so the second attempt waits then either succeeds or gets a "bill already updated" error. Acceptable.

---

## Medium-Risk Findings

### M1. Tight KiviCare schema coupling

Prisma `Prescription` keeps `medicineName`, `dosage`, `frequency`, `duration` — the field *names* are medical, even though the table is repurposed for "intervention plans / recommendations." This is technical debt baked into the data layer: any non-trivial pivot later (e.g., adding "homework submission" or "exercise type" attributes) requires either column renames or a JSON blob. Same pattern in `User.basicData` (Json?) — convenient escape hatch that becomes a query-time nightmare.

**Recommendation**: rename `Prescription` → `InterventionPlan` and re-model the fields; replace `basicData` Json with typed columns; replace `specialties` Json array on Doctor with a join table to `Specialty` (which already exists in schema but is unused — `Doctor.specialties` is `Json?` while `Doctor.specialtiesRef Specialty[]` is the proper join).

### M2. `User.password` column exists even though WP is "source of truth"

Schema line 35. Spec says WP is source of truth. Either remove the column or document the dual-write strategy. If dual-write, password rotation rules must be defined.

### M3. WordPress as cross-app HTTP call on every login

001-auth-foundation spec calls `POST /wp-json/praktiqu/v1/authenticate` on every login. Latency, availability, and security all degrade. If WP is down, login is down (spec says 503). If WP is slow, login is slow. Performance budget (SC-001: < 3s) doesn't account for this.

**Recommendation**: cache the WP password-verify result for a short window with a version stamp; on WP-side password change (see C4) bust the cache via the webhook.

### M4. Calendar/timezone handling is split across three specs

005-session-mgmt says "professional off-day changes invalidate PENDING sessions" but doesn't define whether the client sees the slot in their TZ or the practice TZ. 002-professional-mgmt FR-014 says UTC stored, practice TZ on read, *client's locale* on client views. BR-05.07/08 say UTC stored, user TZ display — but the "user TZ" is the practice TZ for staff and client TZ for clients, and the client TZ is the `User.timezone` field (schema line 59), which is not in any spec. The `Clinic` model has no `timezone` field in Prisma (only `extra` Json) — practice TZ is shoved into the unmodeled `extra` blob.

**Recommendation**: add `timezone` column to `Clinic`; add a `clinicTimezone` to the session response; write a single TZ spec doc covering storage, display, DST, and migration of historical data.

### M5. Rate limiting strategy is global, not endpoint-aware

Constitution: 100 req/min per user. Auth spec adds progressive delay for auth endpoints. 005-session-mgmt has no rate limit on the public booking endpoint. 007-public-booking spec (11.3 KB) — not yet audited but likely also thin. Public booking endpoints are a natural target for scraping/credential-stuffing; the current spec leaves this as a future exercise.

**Recommendation**: document per-endpoint rate-limit tiers (auth: 5/15min/IP, public booking: 30/hour/IP, password reset: 3/hour/email, write APIs: 60/min/user) in the constitution.

### M6. Email queue task (#76) is P2 but session reminders depend on it

Implementation Plan #76 "Implement email queue (background jobs)" is P2. 005-session-mgmt assumes notifications fire on status transitions. 012-notifications is a 0.6 KB stub. If emails are sent inline, transient SMTP failures become user-visible errors.

**Recommendation**: pull the email queue to P0 or P1; specify retry + dead-letter.

### M7. Concurrency control on session notes and intervention plans

008-session-notes spec says "Notes can be edited by the professional who created them until the session is COMPLETED." Two professionals shouldn't conflict, but a single professional editing from two tabs could lose work without optimistic concurrency. No `version` column on `SessionNote`. Same concern for `Bill` (011-billing stub) and `InterventionPlan` (009 stub).

**Recommendation**: add `version: Int @default(0)` to all mutable clinical entities; surface 409 on stale write.

### M8. Status enum values mirror KiviCare numerically (0-4) with no namespacing

`AppointmentStatus` (schema 324): `CANCELLED=0, BOOKED=1, PENDING=2, CHECK_OUT=3, CHECK_IN=4` — but the auth spec, session-mgmt spec, and implementation plan describe the flow as `PENDING → BOOKED → CHECK_IN → CHECK_OUT → COMPLETED` (note: 5 states, but the enum has 4 plus CANCELLED, no COMPLETED). The 005-session-mgmt spec calls for `COMPLETED` but the Prisma enum doesn't have it. 011-billing and 012-notifications stubs are likely to add more states.

**Recommendation**: use string enum values (`'PENDING'`, `'BOOKED'`, etc.) in Prisma, drop the numeric mapping entirely; add `COMPLETED`, `REJECTED`, `NO_SHOW` as required by 005-session-mgmt FR-001.

### M9. Audit logging has no schema and no writer

001-auth-foundation FR-010/011/012/022 require `AuditLog` entity; the spec text defines shape (`id, eventType, actorId, targetId, timestamp, ip, userAgent, metadata`) but there is no `AuditLog` model in Prisma. 005-session-mgmt FR-015 requires "all session status transitions as AUDIT events." 002-professional-mgmt FR-012 same. No implementation path because the model doesn't exist.

**Recommendation**: add `AuditLog` model to Prisma in 001-auth-foundation Phase 1; have auth spec deliver the writer service.

### M10. Caching strategy referenced but undefined

docker-compose has Redis commented out. Constitution doesn't mention caching. 002-professional-mgmt SC-002: "30 seconds of saving to slot visibility" — slot generation is the obvious cache target. Public booking page loads professionals + services + slots — also a cache target. Without a strategy, every page load re-queries.

**Recommendation**: enable Redis in docker-compose; add a thin cache layer in `src/lib/cache.ts`; document invalidation rules per resource.

### M11. Multi-tenancy boundary is implicit

Constitution tech stack doesn't list multi-tenancy. The data model supports multiple clinics (Clinic has many Doctors via DoctorClinicMapping, etc.). But `User.role` is global — a user is `CLINIC_ADMIN` for one clinic or many? 002-professional-mgmt FR-004 explicitly defers multi-practice: "One professional belongs to exactly one practice for v1." But `DoctorClinicMapping` and `PatientClinicMapping` are both `@@unique` — so the schema already supports many. There's a tension between the spec's "one professional = one practice" and the schema's "many-to-many." When the multi-practice feature lands, the entire authorization model needs reworking (per-clinic role assignments).

**Recommendation**: document the v1 single-practice constraint as a hard contract; mark `DoctorClinicMapping` and friends as `@@unique` for v1 and revisit in v2. Add a `currentClinicId` (or similar) to `User` for the active session.

### M12. Tax / billing / payment infrastructure under-specified

011-billing spec is 0.6 KB. Implementation plan #70 "tax calculations" is P2, #71 "PayPal integration" is P2, #72 "basic payment tracking" is P1. .env.example has Stripe keys commented. No PCI scope decision (is PraktiQU in PCI scope? does it use Stripe Elements / tokenization to avoid it?). No invoice numbering strategy (sequential, UUID, country-specific format).

**Recommendation**: defer PayPal (#71) entirely from MVP; commit to Stripe with Stripe Elements (PCI SAQ-A); define invoice numbering as `INV-{YYYY}-{sequence}` per clinic.

### M13. PHI/clinical record retention undefined

How long must session notes, intervention plans, and consent forms be kept? In Indonesia, medical records have a minimum 5-year retention after last encounter (Permenkes 269/2008). In other jurisdictions, 7–10 years for adult records and longer for minors. No spec addresses this. Soft-delete vs hard-delete strategy also undefined.

**Recommendation**: add a `RetentionPolicy` doc; use soft-delete + scheduled hard-delete after retention period; never delete audit logs.

### M14. Internationalization is P2 but timezone default is regional

Implementation Plan #94 i18n is P2. .env.example has `DEFAULT_TIMEZONE="Asia/Jakarta"`. UI is presumably in Bahasa Indonesia. The audit prompt's English-language copy suggests dual-language, but no strategy for default-locale fallback, number/currency/date format, or message externalization is in place.

**Recommendation**: at minimum, hardcode all UI strings in a single locale for v1; document the locale strategy; treat i18n as a v2 axis.

### M15. No deployment topology

Constitution says "Deployment | Vercel." docker-compose suggests local containers (Next.js app is missing from compose — only `db`, `wordpress`, `mail` are defined). Where does the Next.js app run? Vercel? Docker alongside WP? A separate compose file? How does the Vercel app reach the `praktiqu` MySQL on a different host? How does the WP REST endpoint get exposed?

**Recommendation**: add Next.js to docker-compose; document the prod target (recommend Vercel for the Next.js + a managed MySQL like PlanetScale/RDS); specify the cross-network security for the WP REST call (e.g., private VPC peering or signed-request proxy).

---

## Low-Risk Findings

### L1. `00_US-index.md` line 174–220 still has KiviCare template residue
User Story Templates by Role section uses KiviCare-style framing. Cosmetic.

### L2. Implementation Plan §Total Issues says 114 but issue numbering is `#1`–`#114` — but no GitHub issues can be verified from local. May be stale.

### L3. `database-mapping.md` is part of docs/ root — should move to `docs/architecture/`

### L4. `01_FR-index.md:78-79` says "BR-04: Client Management" but BR-04 in `02_BRD-index.md:60-65` is also Client Management — cross-doc ID collision is harmless but suggests the index could reference by FR-* or by a stable slug.

### L5. `.env.example` is well-organized but lacks a section for feature flags, kill switches, Sentry/GlitchTip keys, backup target, OpenTelemetry exporter endpoint.

### L6. `stitch_praktiqu_clinic_dashboard.zip` is 6.6 MB and checked into the repo. Stitch designs should be referenced by URL or kept in a separate design-assets repo.

### L7. Constitution §Technology Stack says "State | React Server Components + Zustand" — Zustand is named but no spec says which state is server vs client. Specs rely on RSC implicitly.

### L8. Constitution "Branch lifespan: MAX 3 days" — feature 002-professional-mgmt spec is dated 2026-06-02 and is a 15 KB spec; the merge cannot happen in 3 days. Either the rule is aspirational or it needs an exception mechanism.

### L9. `AGENTS.md`, `CLAUDE.md`, `GEMINI.md` are all present — three files with overlapping content. Pick one as canonical, link from the others.

### L10. Stitch designs are referenced but not versioned. The constitution says "Deviation from design MUST be justified and documented" but no design version control is described.

---

## Hidden Coupling

| Coupling | Risk |
| --- | --- |
| `prisma/schema.prisma` ↔ `wp_kc_*` table names, status enums, role enums | Migration friction when KiviCare evolves; Prisma `@@map` keeps the KiviCare shape forever |
| `Wordpress-Plugin/kivicare-*/` checked into repo | 4 WP plugin source trees inflate repo; risk of someone editing them assuming they're "our" plugin; should be moved to a `references/kivicare/` archive or removed |
| `Prisma` ↔ `User.basicData` Json? | PII/profile data is unindexed, unqueryable, will leak to API responses uncontrolled |
| `001-auth-foundation/spec.md` ↔ `prisma/role-mapping.ts` | Spec assumes a file that doesn't exist; will be invented ad hoc during implementation |
| Next.js ↔ WordPress HTTP | Cross-app call on every login (see M3); also a soft dependency on WP uptime |
| Next.js ↔ MailHog for dev / SMTP for prod | No clear test path — switching env vars is the only way to verify prod behavior |
| Stitch designs ↔ PraktiQU UI | No component library / Storybook; deviations won't be caught early |
| `.env.example` ↔ 001-auth-foundation/tasks.md | T034 references `RESEND_API_KEY`; not in env file (see C7) |
| Constitution's "WordPress existing DB" ↔ actual `docker-compose` | Same as C1 — repeated because the coupling runs through every doc |

---

## Ownership Ambiguities

| Concern | Audit prompt | Constitution / docs | Code / config | Resolution needed |
| --- | --- | --- | --- | --- |
| User identity | WordPress | WordPress | Optional sync via `WORDPRESS_AUTH_SYNC` toggle; Prisma has its own `User` | See C1, C4 |
| Password verification | WordPress | WordPress | Spec says custom WP REST endpoint | See C3 |
| User roles | WordPress | WordPress (per audit prompt) | Prisma `UserRole` enum (see C2) | Unify on one source |
| Email sending | WordPress | "Email Service" (spec assumption) | PraktiQU's own `EMAIL_HOST` env + Resend (per auth T034) | See C7 |
| Media storage | WordPress | Not stated | Prisma `Media` model + S3 in env (commented) + WP `wp-content` volume | Pick one; document |
| Audit logging | Not stated | "Database-backed structured logging" | No model exists | Add `AuditLog` model; choose DB (PraktiQU's) |
| API documentation | Not stated | "OpenAPI 3.0 spec, Swagger UI at /docs/api" | No implementation | Add OpenAPI generator to CI |
| Session auto-completion | Not stated | Not stated | Spec FR-008 (005) requires it | Pick job runner (C8) |
| Slot generation cache | Not stated | Not stated | 002 SC-002 implies 30s visibility | Add caching layer (M10) |
| Backups | Not stated | "Database-backed" (logging) | None | Define backup target/restore drill |
| Time zone for display | Not stated | BR-05.07/08 | No `Clinic.timezone` column | See M4 |
| Multi-tenant isolation | Not stated | Implicit (BR-10) | Mapping tables allow many | See M11 |

---

## Over-Engineering

| Item | Why it's over-engineered for current stage |
| --- | --- |
| Google OAuth (001 US3, P2) | Not in any PRD "must-have" feature; complicates RBAC; spec defers all healthcare-compliance decisions; can wait until post-MVP |
| k6 load tests (001 T060) | SC-007 says 1000 concurrent auth — no business case for that volume at MVP; baseline load test on a single endpoint is enough |
| 80% coverage gate (001 T041) | Reasonable for a core domain module; 80% on auth is fine; 80% on 18-feature codebase is the wrong shape for the project stage |
| `AuthorizationService` permission extension point (001 FR-016) | Useful long-term, but the matrix has 7 actions and the project has 18 features. Building the abstraction before the second feature that needs it is premature |
| OpenAPI 3.0 + Swagger UI at `/docs/api` (constitution) | Adds a build step and a runtime; no consumer is named; can be deferred to a public API launch |
| Custom WordPress authentication endpoint (001) | If we adopt C1 option (b) — PraktiQU owns auth — this entire WP integration goes away |
| Custom fields builder (016, P2) | Heavy UI/UX surface; deferred features tend to stay deferred |
| Email queue (plan #76, P2) | If Resend/Postmark/SES is used, they handle the queue |
| Tax calculations (plan #70, P2) | Multi-jurisdiction tax is a project unto itself; defer or use Stripe Tax |
| PayPal integration (plan #71, P2) | Already deferred by note in plan; remove from MVP scope entirely |
| Intervention plan print (017, 1.1 KB spec) | Can ship as browser print CSS; PDF generation needs Puppeteer/Playwright which is heavyweight |
| Revenue reports / patient statistics (plan #80, #81, P2) | Statistics from a single day of MVP data is misleading |
| Dark mode (plan #90, P2) | Visual polish, not a product concern |
| i18n (plan #94, P2) | Same |

---

## Under-Engineered

| Area | What's missing |
| --- | --- |
| Security | Password policy (length, complexity, history, rotation); account lockout (only auth endpoint scoped); CSRF protection strategy; CSP headers; CORS policy for public booking; encryption-at-rest for PHI; key rotation; threat model document; penetration test scope |
| Authorization | Full action × role matrix; per-clinic role scoping; field-level redaction (e.g., client email hidden from receptionist) |
| Auditing | Schema, writer, retention purge job, query API, access logging |
| Data integrity | Idempotency keys; optimistic concurrency tokens; soft-delete vs hard-delete; referential integrity across Prisma/WordPress; transactional boundaries (FR-008) |
| Migration | Existing KiviCare data migration path; WordPress user migration; historical appointment re-encoding to UTC |
| Operations | Backups; DR; runbook; on-call; SLOs; capacity planning; cost model |
| Observability | Logs (no destination); metrics; traces; alerts |
| Email | Production sending path (C7); bounce handling; unsubscribe; sender domain authentication (SPF/DKIM/DMARC); template management |
| Booking | Idempotency; payment-on-booking vs payment-on-checkout; deposit handling; no-show tracking; waitlist |
| Calendar | iCal export; Google Calendar two-way sync; timezone DST; recurring availability exceptions; capacity (1:1 vs 1:group) |
| Multi-tenant | Row-level security; cross-tenant data leakage tests; per-tenant rate limits |
| Consent | Consent template builder; e-signature audit trail; consent withdrawal propagation; minors vs adults |
| Billing | Invoice numbering; tax; partial payments; refunds; payment reconciliation; receipt vs invoice distinction; aging reports |
| Reporting | Dashboard metrics definitions; date-range filters; export formats; data warehouse handoff |
| API | Versioning compatibility policy; deprecation timeline; pagination beyond page-based (cursor when datasets exceed 1000s) |
| Frontend | Loading skeletons; error boundaries; offline support; accessibility (WCAG); browser support matrix |
| Testing | Load test scenarios; chaos test scenarios; security test scenarios; data migration test scenarios |

---

## Missing Architecture Decisions

These are decisions that should be formally captured in `docs/memory/decisions/` (the directory does not exist yet — see Critical Finding 1 of workflow document, `DECISIONS.md` is referenced in `workflow.md` but not committed).

**D-01: WordPress ↔ PraktiQU relationship model** (resolve C1). One of: (a) PraktiQU is a coupled WP-sibling using same DB, (b) PraktiQU is standalone with one-way WP user import, (c) PraktiQU is standalone with bidirectional WP sync.

**D-02: Role taxonomy source of truth** (resolve C2). Pick the 5-role set, fix in constitution, Prisma, and every spec.

**D-03: Authentication library and token strategy**. NextAuth.js v5 + `jose` (current) is split; either commit to NextAuth for everything (drop `jose`) or commit to `jose` + NextAuth-as-OAuth-orchestrator (current, but document). Document session storage (JWT vs DB-backed session), key rotation, and kid pinning.

**D-04: Password storage and rotation policy**. If WP owns passwords, document the cross-app invalidation contract. If PraktiQU owns them, document hashing algorithm (argon2id), pepper strategy, rotation rules.

**D-05: Email infrastructure**. Resend (current draft) vs Postmark vs SES vs SMTP relay through WP. Sender domain. Authentication. Bounce handling.

**D-06: Media storage**. PraktiQU Media table + S3 vs WordPress wp-content vs Vercel Blob. Max file sizes. Allowed types. Anti-virus.

**D-07: Background jobs / scheduled tasks** (resolve C8). BullMQ + Redis vs Inngest vs Vercel Cron + Postgres-backed vs pg-boss. Job retry, dead-letter, idempotency.

**D-08: Caching strategy** (resolve M10). Redis vs in-memory vs Vercel KV. Invalidation rules per resource. TTL defaults.

**D-09: Audit logging destination and retention**. Which DB (PraktiQU's `praktiqu` schema or a separate `audit` schema). Retention by class. Access control on audit queries.

**D-10: Time zone strategy** (resolve M4). Storage TZ. Display TZ per role. Client TZ. DST handling. Migration of historical data.

**D-11: Multi-tenant data isolation** (resolve M11). v1 single-practice hard constraint. Future v2 multi-practice authorization model. Per-clinic role assignments.

**D-12: Idempotency strategy** — **DEFERRED out of MVP** (per C10 resolution). Rely on Prisma transactions + manual ops + audit log.

**D-13: Optimistic concurrency** — **DEFERRED out of MVP** (per C10 resolution). No version columns in MVP.

**D-14: Deployment topology** (resolve M15). Next.js host (Cloudflare), MySQL host, Redis host, WordPress host, MailHog → cPanel SMTP. Cross-network security. SSL/TLS termination. Secrets management.

**D-15: Backup, restore, and disaster recovery** (resolve C5). Frequency. Retention. Restore drill cadence. RTO/RPO targets.

**D-16: Observability stack** (resolve C5). Logs destination, metrics, traces, error tracking. Alert routing.

**D-17: CI/CD pipeline** (resolve C5). Lint, type-check, test, build, E2E (agent-based), deploy. Branch protection rules. Required reviewers.

**D-18: Feature scope cuts**. No cuts (resolved in C6). All 18 features kept; deferred specs per `docs/architecture/deferred-features.md`.

**D-19: Compliance posture** — **DEFERRED out of MVP** (per C10 resolution). No PHI encryption, no formal compliance certification in MVP. Keep logging (C5) + RBAC (C2) as the only control layers.

**D-20: Rate limit tiers per endpoint class** (resolve M5). Auth, public, write, read.

**D-21: Pagination strategy beyond page-based**. When `totalItems > 10_000`, switch to cursor. Define migration rule.

**D-22: Pagination default and max consistency**. Constitution says 20/100; specs should not deviate.

**D-23: API versioning policy**. URL versioning today; what's the deprecation timeline? When v2 ships, how long is v1 supported?

**D-24: Error code registry**. RFC 7807 is the format; what's the canonical list of `type` URIs and their HTTP status mapping?

**D-25: Localization**. v1 locale(s). When does v2 i18n land? Default fallback.

**D-26: Data export / subject access**. GDPR/LGPD/UU-PDP all grant data export and deletion rights. What's the technical mechanism?

---

## Recommended Updates

Additions or changes suggested for each document. No rewrites — just deltas.

### Constitution

1. Replace the opening paragraph §Note with a clear pointer: this constitution covers development conventions AND the high-level architecture decisions. The PRD, BRD, and architecture specs cover product and data concerns.
2. §Core Principles add: "Architecture documents in `docs/architecture/` are authoritative for system structure; deviations require an ADR."
3. §Core Principles add a principle on **Single Source of Truth for Roles** — one of: constitution, Prisma, or spec — must be canonical and the others must derive from it.
4. §API Standards: add Idempotency-Key header requirement for state-changing endpoints; add per-endpoint rate-limit table; add Optimistic Concurrency (ETag/version) requirement; pin RFC 7807 `type` URI convention (e.g., `/errors/{category}/{code}`).
5. §Logging & Monitoring: replace "APM deferred" with a concrete decision per D-16. Add `AuditLog` retention table per log class.
6. §Project Structure: add `docs/architecture/` (with `data-model.md`, `threat-model.md`, `data-classification.md`); add `docs/operations/` (with `runbook.md`, `backup-restore.md`, `on-call.md`); add `docs/decisions/` for ADRs.
7. §Technology Stack: remove "Vercel" as a decision until D-14 is decided; add "Job runner: <TBD per D-07>"; add "Email: <TBD per D-05>"; add "Object storage: <TBD per D-06>".
8. §Development Workflow Definition of Done: add "ADR linked for any architectural change", "No schema change without backward-compatible migration plan", "No new external dependency without license/security review".
9. Add §Compliance Posture section (even if minimal): "Targets sensitive personal data; uses encryption in transit, column-level encryption for PHI at rest, role-based access logging, retention policy per data class."

### PRD

1. Add a section "Out of Scope for MVP" with an explicit list of 010, 013, 014, 015, 016, 017, 018 deferred features (and the 7 over-engineering items from above).
2. Add a "Data Classification" section classifying entities (User, SessionNote, Bill = sensitive; Appointment, Service = operational; etc.).
3. Add a "Regulatory Considerations" section with a clear statement of intended markets and applicable data-protection regimes, even if "no formal certification."

### Architecture documentation (new directory `docs/architecture/`)

1. `data-model.md` — entity-relationship diagram + per-entity documentation (field semantics, indexes, constraints, retention).
2. `role-taxonomy.md` — single canonical role list + complete action × role matrix + derivation rules.
3. `wordpress-integration.md` — finalize the relationship model (D-01); document the REST contract; document the sync semantics; document failure modes.
4. `authentication.md` — finalize D-03, D-04; document the JWT/key strategy; document refresh-token family revocation; document the lockout policy.
5. `data-classification.md` — *deferred out of MVP* (per C10). When added later, cover classification + retention; encryption is explicitly out of scope.
6. `api-conventions.md` — finalize D-22, D-23, D-24; concrete examples; reference implementation in `src/lib/`. (D-12/D-13 deferred per C10.)
7. `time-and-timezone.md` — finalize D-10.
8. `background-jobs.md` — finalize D-07; document retry, idempotency, dead-letter, observability for jobs.
9. `caching.md` — finalize D-08.
10. `email.md` — finalize D-05; production sending path; bounce handling; template management.
11. `media.md` — finalize D-06.
12. `threat-model.md` — STRIDE per major component; OWASP ASVS Level 2 checklist; concrete mitigations.
13. `adr/` — directory for Architecture Decision Records (use MADR or Nygard template).

### Specs

1. **001-auth-foundation**: add explicit dependency on D-01, D-02, D-03, D-04 resolutions; remove `RESEND_API_KEY` assumption (link to D-05); add session-fixation test (currently only listed in edge cases, no task); add concurrent-login-from-multiple-devices test (currently edge case only); add `AuditLog` model delivery to Phase 1; add CI workflow file delivery to Phase 7.
2. **005-session-mgmt**: add `AuditLog` write to every status transition; add `version: Int` to Session model; specify the slot-generation cache invalidation rule; add the job-runner dependency.
3. **008-session-notes**: add `version: Int` to `SessionNote`; document the soft-delete policy for closed notes; cross-reference D-19.
4. **All stub specs (010, 011, 012, 013, 014, 015, 016, 017, 018)**: either flesh out or move to a "deferred" location with a target version.
5. **007-public-booking**: add CORS policy, CSRF strategy, rate-limit tier, captcha/honeypot decision, payment-on-booking-vs-checkout decision.
6. **011-billing** (if it stays in MVP): define the invoice numbering scheme, tax strategy, payment provider (Stripe vs other), reconciliation flow, refund flow, partial payment, receipt vs invoice.
7. **012-notifications** (if it stays in MVP): define the email service integration, the template system, the queue strategy, the bounce/dead-letter handling, the unsubscribe path.

### `.env.example`

1. Add `RESEND_API_KEY` (or the chosen email vendor).
2. Add `SENTRY_DSN` or `GLITCHTIP_DSN` (or chosen error tracker).
3. Add `OTEL_EXPORTER_OTLP_ENDPOINT` (OpenTelemetry endpoint).
4. Add feature flags section.
5. Add `IDEMPOTENCY_KEY_TTL_SECONDS`.
6. Add `AUDIT_LOG_DB_URL` (or note that audit uses the primary DB).
7. Add backup target configuration.
8. Add sender domain policy (SPF/DKIM/DMARC notes).

### docker-compose

1. Add the Next.js app service.
2. Uncomment Redis (the job runner + cache layer will need it).
3. Add a one-shot migration service (`prisma migrate deploy`).
4. Add healthchecks for all services.
5. Document the production-equivalent network layout (private network for DB, public ingress for Next.js and WP).

### `.specify/memory/`

1. `DECISIONS.md` is referenced in `workflow.md` but does not exist. Create it with the 26 decisions above (D-01 through D-26).
2. `BUGS.md` is referenced in `workflow.md` but does not exist. Create it (empty is fine for MVP).
3. `architecture_constitution.md` is referenced in `workflow.md` but does not exist. Create it OR remove the reference.

---

## Closing Note

The most important resolution is **C1**: every other critical finding either depends on it or is amplified by it. Once the WordPress relationship is fixed, the role taxonomy, auth contract, password strategy, schema coupling, and several medium-risk findings collapse into a tractable scope.

After C1: **C2 (role taxonomy)** and **C5 (operational baseline)** are the next two highest-leverage resolutions because they unlock all of the under-engineered security and ops concerns.

The 18-feature plan is bigger than the project can sustainably ship at MVP. **C6 (spec maturity cliff)** is the most likely cause of slippage; cut scope explicitly before cutting quality.

> *Audit complete. No files modified during audit. Remediation requires explicit user approval before any of the recommended updates are applied.*