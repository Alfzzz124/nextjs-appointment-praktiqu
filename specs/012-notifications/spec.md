# Feature Specification: Notifications

**Feature Branch**: `feat/012-notifications`
**Created**: 2026-06-02
**Status**: Draft
**Input**: Email templates, session reminders, approval notifications, transactional email infrastructure.

> **Replaces**: the 565-byte stub that previously lived at this path. The KiviCare plugin (`Wordpress-Plugin/kivicare-clinic-management-system/app/emails/`) has the original implementation with 10 notification listeners (Appointment, Doctor, Encounter, Invoice, Patient, Payment, Prescription, etc.); this spec targets feature parity for psychology practice on the Next.js stack with **cPanel SMTP** as the email transport (nodemailer).

## Clarifications

### Session 2026-06-02 (revised 2026-06-02 after C7 resolution)

- **Q: Which email service?** → A: **cPanel SMTP** (per audit C7). Production uses the SMTP server provided by the shared hosting cPanel. Development uses **MailHog** (a local SMTP catcher, run via `docker-compose`). Both are vanilla SMTP; the transport is `nodemailer` with `smtpTransport`. Env constants: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_SECURE`, `EMAIL_FROM`. (Earlier Resend-based draft superseded.)
- **Q: Are emails sent synchronously or queued?** → A: Queued. Synchronous would block user requests and risk user-visible failures on transient SMTP errors. For MVP, the queue lives in the `email_messages` Prisma table (database-backed queue); a long-lived background worker drains the queue and sends via SMTP with retry + dead-letter. When C8 (job runner) is decided, the worker can move to Redis/BullMQ if needed.
- **Q: What events trigger notifications?** → A: 10 event types for MVP (see FR-005). Future events (e.g., invoice reminders) are added in later phases.
- **Q: Are emails per-clinic customizable?** → A: Yes. Each `Clinic` has its own set of `EmailTemplate` records (per event type). Default templates ship with PraktiQU; Clinic Admin can override per event. Override is per-clinic, not per-professional.
- **Q: Bounce / delivery tracking?** → A: With vanilla SMTP we **only know at send time** whether the SMTP server accepted the message. We do NOT get per-recipient delivery confirmations, opens, or out-of-band bounces (those require a transactional email service like Resend/SendGrid/Postmark, deferred). A send-time SMTP error (e.g., `550 mailbox not found`) is recorded as `bounced` in `EmailMessage.status` and the recipient is flagged. The 3-bounce-in-30-days threshold is still applied.
- **Q: Unsubscribe?** → A: Transactional emails (booking confirmations, password resets) are **not** unsubscribe-able per email regulation. Marketing-style emails are out of scope for MVP.
- **Q: Internationalization?** → A: Single locale for MVP (Bahasa Indonesia, given the `DEFAULT_TIMEZONE=Asia/Jakarta` and Bahasa-terminology). i18n deferred (constitution M14).
- **Q: What about SMS / WhatsApp?** → A: Out of MVP scope. Channels = email only.

---

## User Scenarios & Testing

### User Story 1 - Session-Booked Notification (Priority: P1)

When a client books a session, the assigned professional receives a notification. When the professional approves, the client receives a confirmation.

**Why this priority**: Core to the booking flow. Without this, professionals miss new requests; clients don't know if their booking was approved.

**Independent Test**: Book a session as client → verify the assigned professional's email queue has a `session.requested` email. Approve as professional → verify the client's email queue has a `session.approved` email.

**Acceptance Scenarios**:

1. **Given** a client books a session (status: PENDING), **When** the booking transaction commits, **Then** the system enqueues a `session.requested` email to the assigned professional with subject "{{clientName}} requested a session on {{date}}" and the session details. The email is sent within 60 seconds of enqueueing (queue worker drain).

2. **Given** a professional approves a PENDING session, **When** the approval transaction commits, **Then** the system enqueues a `session.approved` email to the client with subject "Your session is confirmed for {{date}}" and a calendar attachment (.ics).

3. **Given** a professional rejects a PENDING session, **When** the rejection transaction commits, **Then** the system enqueues a `session.rejected` email to the client with the rejection reason. No calendar attachment.

---

### User Story 2 - Session Reminder (Priority: P1)

The system sends a reminder email to clients 24 hours and 1 hour before their session.

**Why this priority**: No-show reduction is a primary business value. Reminders are a standard practice.

**Independent Test**: Schedule a session 25 hours in the future → verify a 24-hour reminder is enqueued within 5 minutes of session creation → advance the clock → verify the email is sent.

**Acceptance Scenarios**:

1. **Given** a BOOKED session in the future, **When** the session is created, **Then** the system schedules a 24-hour reminder and a 1-hour reminder as `EmailMessage.scheduledFor` rows in the queue.

2. **Given** the queue worker runs, **When** it finds `EmailMessage` rows where `scheduledFor <= now() AND status = 'pending'`, **Then** it sends them and transitions to `sent`.

3. **Given** a session is cancelled, **When** the cancellation commits, **Then** the system deletes any unsent reminders for that session (no orphan reminders).

4. **Given** a session time changes (reschedule), **When** the change commits, **Then** the system updates the existing reminders' `scheduledFor` to the new time (don't resend cancellation + new reminder — just reschedule).

---

### User Story 3 - Email Template Management (Priority: P1)

Clinic Admin customizes email templates for their clinic: subject, body, variables. Defaults are provided.

**Why this priority**: Clinics have varied branding; one-size-fits-all emails feel generic.

**Independent Test**: Clinic Admin edits the `session.approved` template → book and approve a session → verify the custom template is used (compare subject line).

**Acceptance Scenarios**:

1. **Given** a Clinic Admin opens the template editor, **When** they edit the `session.approved` template, **Then** changes are saved to `EmailTemplate` (per-clinic override). Validation runs (Zod) on the body for missing required variables.

2. **Given** a template has been edited, **When** the system enqueues an email of that event type for a client in that clinic, **Then** the customized template is used (not the default). Variable substitution (`{{clientName}}`, `{{date}}`, etc.) is applied per the template's variable schema.

3. **Given** a Clinic Admin wants to revert to defaults, **When** they click "Reset to default" on a template, **Then** the per-clinic override is deleted and the default template is used going forward. Sent emails (history) are unaffected.

---

### User Story 4 - Email Delivery Tracking (Priority: P2)

System tracks email send status: queued, sending, sent, failed. Clinic Admin can view the history for compliance and debugging.

**Why this priority**: Debugging "did the client get the email?" is a frequent support question.

**Scope note (C7 decision)**: With vanilla cPanel SMTP we only know whether the SMTP server **accepted** the message. We do NOT get per-recipient delivery confirmations or out-of-band bounces. A send-time SMTP error is recorded as `failed` with the SMTP response. Deeper delivery / open / click tracking is a deferred enhancement that would require migrating to a transactional email service.

**Independent Test**: Trigger an email → verify the `EmailMessage.status` transitions queued → sending → sent. Force a failure (bad recipient) → verify status becomes `failed` and `Client.emailBounceCount` is incremented.

**Acceptance Scenarios**:

1. **Given** the system enqueues an email, **When** the queue worker sends it via SMTP, **Then** `EmailMessage.status` transitions to `sent` and `sentAt` is set.

2. **Given** the SMTP server returns an error (e.g., `550 mailbox not found`), **When** the queue worker captures the failure, **Then** `EmailMessage.status` transitions to `failed`, `bounceReason` captures the SMTP response, and `Client.emailBounceCount` is incremented. If the count exceeds the threshold (3 in 30 days), a `client.email_high_bounce_rate` warning is logged.

3. **Given** a Clinic Admin opens the email history view, **When** they filter by `clientId`, **Then** the system displays all email messages sent to that client (most recent first), with status badges.

---

### User Story 5 - Welcome Email (Priority: P2)

When a new client self-registers (per 001-auth-foundation FR-022), a welcome email is sent.

**Why this priority**: Onboarding clarity. Not blocking, but standard.

**Independent Test**: Self-register a new client → verify a `client.welcome` email is enqueued → check the inbox for the email.

**Acceptance Scenarios**:

1. **Given** a new client successfully self-registers, **When** the registration transaction commits, **Then** the system enqueues a `client.welcome` email to the new client with login instructions and clinic info.

2. **Given** the welcome email bounces, **When** the bounce is processed, **Then** the system does not block further emails; only logs the warning and increments bounce count.

---

### Edge Cases

- **Resend down**: emails stay in the queue with exponential backoff retry. After 5 failed attempts, the email moves to `dead_letter` and a `logging.error()` is recorded.
- **Bounce on a one-time address (typo)**: the client may not exist; the system increments `Client.emailBounceCount` only if a client record exists for the recipient.
- **Template variable missing**: the email is sent with the literal `{{variableName}}` placeholder; the system logs a warning. (Defensive: don't fail-send on missing vars.)
- **Two clients with the same email** (e.g., parent and child): the system sends individually per-client; recipients see their own {{clientName}}.
- **Email queue grows during a long Resend outage**: the queue can grow large; the worker drains it on recovery. No size cap (subject to disk).
- **Per-clinic template edit conflict**: last-write-wins; no optimistic locking. (Clinic Admins editing the same template is a rare collaboration case.)
- **Test-mode in dev**: emails are NOT sent to real addresses; they go to MailHog (per docker-compose.yml) and `EmailMessage.status` is `sent` immediately without Resend.

---

## Requirements

### Functional Requirements

- **FR-001**: System MUST provide a database-backed email outbox (`EmailMessage` table) for queued and sent emails.
- **FR-002**: System MUST provide a queue worker that drains the outbox and sends emails via **SMTP** (`nodemailer`) with exponential backoff retry (1m, 5m, 30m, 2h, 12h). After 5 failed attempts, the email moves to `dead_letter` and a `logging.error()` is recorded.
- **FR-003**: System MUST expose `GET /api/v1/email-templates` and `PATCH /api/v1/email-templates/{key}` for Clinic Admin template management.
- **FR-004**: System MUST ship default templates for all 10 event types (see FR-005), per-locale (Bahasa Indonesia for MVP).
- **FR-005**: System MUST support the following event types, each with a default template and per-clinic override:
  - `client.welcome` — new client welcome
  - `session.requested` — booking pending, to professional
  - `session.approved` — booking confirmed, to client
  - `session.rejected` — booking rejected, to client
  - `session.cancelled` — booking cancelled, to other party
  - `session.reminder_24h` — 24h before session, to client
  - `session.reminder_1h` — 1h before session, to client
  - `password.reset` — password reset link
  - `invoice.issued` — bill issued, to client
  - `payment.received` — payment confirmed, to client
- **FR-006**: System MUST send via SMTP using **nodemailer** with transport configured from `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_SECURE` env constants. In dev (`NODE_ENV != production`), use MailHog at `localhost:1025`. In production, use the cPanel-provided SMTP server.
- **FR-007**: System MUST expose `GET /api/v1/email-messages` (paginated, filterable by `clientId`, `eventType`, `status`, `clinicId`) for Clinic Admin history view.
- **FR-008**: System MUST scope all reads and writes to the user's practice (per `BR-10.03`) and the user's role.
- **FR-009**: System MUST log every email send (success or failure) via `logging.audit()` and `logging.activity()`. No external webhook receiver (cPanel SMTP has no per-recipient webhook).
- **FR-010**: System MUST generate calendar (.ics) attachments for `session.approved` emails.
- **FR-011**: System MUST delete unsent reminders when a session is cancelled (per US2 edge case).
- **FR-012**: System MUST update reminder `scheduledFor` when a session is rescheduled.
- **FR-013**: System MUST support template variable interpolation with strict mode: missing required variables block the email (logged as `template.missing_variables`); missing optional variables are rendered as empty strings.
- **FR-014**: System MUST return RFC 7807 Problem Details for all template / message endpoint errors.
- **FR-015**: System MUST use the dev MailHog (per `docker-compose.yml`) in development; cPanel SMTP in production.

### Key Entities

- **EmailTemplate**: { id, clinicId (null = default), key (event type), subject, bodyHtml, bodyText, variables (Json schema), isActive, version, createdBy, createdAt, updatedAt }
- **EmailMessage**: { id, clinicId, clientId?, userId?, eventType, templateId, toEmail, toName, subject, bodyHtml, bodyText, status: 'pending'|'sending'|'sent'|'failed'|'dead_letter', smtpResponse?, scheduledFor, sentAt?, failedAt?, failureReason?, retryCount, lastAttemptAt?, nextAttemptAt?, createdAt, metadata (Json: icalendar attachment, custom headers, etc.) }
- **EmailFailureStat**: { id, clientId?, email, failureCount, windowStart, lastFailureAt } — used to track high-failure clients (replaces EmailBounceStat in SMTP-only model)
- **EmailVariable** (logical, defined per template as Json schema): { name, label, type, required, example }

### Success Criteria

- **SC-001**: A `session.requested` email is enqueued within 1 second of the booking transaction committing.
- **SC-002**: A queued email is sent within 60 seconds of its `scheduledFor` (or enqueue time if no schedule).
- **SC-003**: A 24-hour reminder is sent within 5 minutes of the session's 24-hour mark.
- **SC-004**: A bounced email is reflected in the `EmailMessage.status` within 30 seconds of Resend's webhook.
- **SC-005**: A Clinic Admin template edit takes effect on the next email sent for that event.
- **SC-006**: 100% of email-send events are recorded in the audit log via `logging.audit()`.
- **SC-007**: All 10 template types ship with sensible Bahasa Indonesia defaults.

### Assumptions

- **Email service**: cPanel SMTP in production, MailHog in dev. Transport is `nodemailer` with SMTP. If the email service changes later (e.g., migrate to Resend for delivery tracking), only `src/lib/email/` is affected; the queue worker interface is provider-agnostic.
- **Job runner**: The email queue worker is a scheduled job; until C8 (job runner) is decided, the worker runs as a long-lived background process spawned at server startup. A future task will move the worker to the chosen job runner.
- **Locale**: Bahasa Indonesia for MVP. i18n deferred (constitution M14).
- **No SMS / WhatsApp**: email-only channel for MVP.
- **Templates are HTML + plain text**: every template has both; clients with HTML-disabled email clients get the plain-text version automatically.
- **The KiviCare plugin's notification listeners** (Appointment, Doctor, Encounter, Invoice, etc.) are the source of truth for the 10 event types in FR-005; new events are added as features land.
- **The audit log (per C5)** captures all send / deliver / bounce / fail events with `logging.audit()` and `logging.activity()`.
