---
description: "Task list for 012-notifications feature implementation"
---

# Tasks: 012-notifications

**Input**: Feature specification from `specs/012-notifications/spec.md`
**Prerequisites**: plan.md (required), spec.md (required for user stories), 001-auth-foundation (for password.reset trigger), 005-session-mgmt (for session.* triggers), 011-billing (for invoice/payment triggers), C5 logging (for audit calls)

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Foundational Setup

- [ ] TN01 [P] Add `EmailTemplate`, `EmailMessage`, `EmailBounceStat` models to Prisma; add `Client.emailBounceCount`
- [ ] TN02 Write Prisma migration; verify `prisma migrate dev` runs cleanly
- [ ] TN03 [P] Add `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_SECURE`, `EMAIL_FROM` to `.env.example`
- [ ] TN04 [P] Create `src/lib/email/smtp.ts` — nodemailer transport factory exposing `getTransporter()` (MailHog in dev, cPanel SMTP in prod based on `NODE_ENV`)
- [ ] TN05 [P] Create `src/lib/email/variables.ts` — variable schema per event type (10 event types)
- [ ] TN06 [P] Create `src/lib/email/template-renderer.ts` — variable substitution + HTML/text render; strict mode for required vars
- [ ] TN07 [P] Create `src/lib/email/icalendar.ts` — `.ics` attachment generator for session-approved emails
- [ ] TN08 [P] Create `src/lib/email/queue.ts` — `enqueue()`, `dequeue()`, `retry()`, `moveToDeadLetter()`; idempotency by `(clinicId, eventType, recipient, scheduledFor)`

**Checkpoint**: Schema migrated, Resend SDK integrated, variable system defined.

---

## Phase 2: Outbox + Queue Worker (US2, US4)

- [ ] TN09 [US2] Write tests for `enqueue(eventType, recipient, variables)` — cases: (a) enqueue creates EmailMessage with status=pending, (b) dev mode (NODE_ENV != production) bypasses Resend (goes to MailHog), (c) scheduledFor in the past → sent immediately, (d) enqueue with missing required variable → logs warning, renders literal `{{var}}`
- [ ] TN10 [US2] Implement `enqueue` in `src/services/notifications/queue.ts`
- [ ] TN11 [US2] Write tests for the queue worker: (a) picks up pending messages in order of `scheduledFor`, (b) transitions to `sending` before API call, (c) transitions to `sent` on success, (d) increments retryCount on failure, (e) exponential backoff: 1m, 5m, 30m, 2h, 12h, (f) dead-letter after 5 attempts with `logging.error()`, (g) worker crash resilience (row stays `sending`; next sweep recovers)
- [ ] TN12 [US2] Implement the long-lived queue worker process in `src/services/notifications/send.ts`
- [ ] TN13 [US4] Write tests for SMTP send-result handling — cases: (a) SMTP `send()` returns success → status=`sent`, sentAt, (b) SMTP returns `550 mailbox not found` → status=`failed`, failureReason, `EmailFailureStat` incremented, (c) SMTP timeout → retryCount++, nextAttemptAt set, (d) connection refused → logged but worker keeps running
- [ ] TN14 (REMOVED — no external webhook receiver in SMTP-only model)
- [ ] TN15 [US4] Implement failure tracking in `src/services/notifications/bounces.ts` — threshold: 3 failures in 30 days → `logging.warn('client.email_high_failure_rate')`

**Checkpoint**: Queue worker sends emails via SMTP; failures recorded; client high-failure detection works.

---

## Phase 3: Default Templates (US3)

- [ ] TN16 [US3] Write seed data: 10 default EmailTemplate records (all `clinicId=null`) in Bahasa Indonesia, one per event type in FR-005. Cover the full variable set per template.
- [ ] TN17 [US3] Write tests for default template rendering — each event type renders correctly with a full variable set; missing optional vars render as empty string; missing required vars log warning
- [ ] TN18 [US3] Implement `src/services/notifications/templates.ts` — `getEffectiveTemplate(clinicId, eventType)` (returns override if exists, fallback to default)

**Checkpoint**: All 10 event types have working Bahasa Indonesia defaults.

---

## Phase 4: Trigger Hooks (US1, US5)

- [ ] TN19 [P] [US1] Implement `src/services/notifications/triggers.ts` — per-event-type enqueue helpers:
  - `onSessionBooked(session)` → enqueue `session.requested` to professional
  - `onSessionApproved(session)` → enqueue `session.approved` to client (+ .ics attachment)
  - `onSessionRejected(session, reason)` → enqueue `session.rejected` to client
  - `onSessionCancelled(session)` → enqueue `session.cancelled`; delete unsent reminders; update scheduled reminders if rescheduled
  - `onClientRegistered(client)` → enqueue `client.welcome`
  - `onPasswordReset(client, resetLink)` → enqueue `password.reset`
  - `onBillIssued(bill)` → enqueue `invoice.issued`
  - `onPaymentReceived(bill, payment)` → enqueue `payment.received`
  - `onReminder24h(session)` → called by scheduler → enqueue `session.reminder_24h`
  - `onReminder1h(session)` → called by scheduler → enqueue `session.reminder_1h`
- [ ] TN20 [US1] Hook into 005-session-mgmt: call `onSessionBooked()` after booking PENDING commit; call `onSessionApproved()/Rejected()` after approval/rejection commit; call `onSessionCancelled()` after cancel commit
- [ ] TN21 [US1] Hook into 001-auth-foundation: call `onClientRegistered()` after FR-022 self-registration; call `onPasswordReset()` after forgot-password request
- [ ] TN22 [US1] Hook into 011-billing: call `onBillIssued()` after bill is issued; call `onPaymentReceived()` after payment recorded
- [ ] TN23 [US1] Schedule reminders: on session creation, schedule `session.reminder_24h` (24h before start) and `session.reminder_1h` (1h before) via `scheduledFor` in EmailMessage rows

**Checkpoint**: Emails are sent for all 10 event types end-to-end.

---

## Phase 5: Template Editor (US3)

- [ ] TN24 [P] [US3] Write tests for template CRUD — cases: (a) create per-clinic override, (b) update existing override, (c) version increments, (d) reset to default deletes override row, (e) non-admin cannot edit templates, (f) RFC 7807 errors
- [ ] TN25 [P] [US3] Implement template service in `src/services/notifications/templates.ts`
- [ ] TN26 [P] [US3] Create `GET /api/v1/email-templates` and `PATCH /api/v1/email-templates/{key}` routes
- [ ] TN27 [P] [US3] Create `POST /api/v1/email-templates/{key}/reset` route (deletes override)
- [ ] TN28 [P] [US3] Build template editor page `src/app/(dashboard)/email-templates/[key]/page.tsx` — WYSIWYG editor for HTML body, variable picker, live preview with sample data, save/reset buttons

**Checkpoint**: Clinic Admin can customize any template.

---

## Phase 6: Email History + Resend Webhook (US4)

- [ ] TN29 [US4] Implement `src/services/notifications/messages.ts` — `listMessages(clinicId, filters)`, `getMessage(id)`
- [ ] TN30 [US4] Create `GET /api/v1/email-messages` route (paginated, filterable by clientId, eventType, status, clinicId)
- [ ] TN31 [US4] Build email history view `src/app/(dashboard)/email-messages/page.tsx` — table with status badges, filter bar, expandable row detail
- [ ] TN32 [US4] Write tests for `GET /api/v1/email-messages` — (a) pagination, (b) filter by clientId, (c) filter by status, (d) clinic scoping

**Checkpoint**: Clinic Admin can see all email history.

---

## Phase 7: Polish & Cross-Cutting

- [ ] TN33 [P] Add `docs/notifications/architecture.md` (email flow diagram, event catalog, variable reference), `docs/notifications/runbook.md` (Resend keys, bounce handling, resend template)
- [ ] TN34 Update `specs/012-notifications/checklists/completion.md` against spec.md FR-001…FR-015 with pass/fail
- [ ] TN35 Run full CI/CD pipeline verification
- [ ] TN36 [P] Add unit tests for edge cases: template variable missing, Resend API error → retry, worker crash mid-send, duplicate webhook delivery, icalendar format, bounce threshold window
- [ ] TN37 Security hardening review: Resend webhook signature, no PII in logs, RBAC on template/messages endpoints, audit log completeness
- [ ] TN38 Configure Vitest coverage threshold ≥ 80% for `src/services/notifications/`; fail CI below threshold
- [ ] TN39 Generate OpenAPI 3.0 spec for `/api/v1/email-*` and `/api/v1/webhooks/resend`; serve at `/docs/api`
- [ ] TN40 Add Vitest benchmark: enqueue < 100ms (SC-001)
- [ ] TN41 Add Vitest benchmark: queue worker drain 100 messages < 30s
- [ ] TN42 Write E2E test plan in `docs/testing/notifications-e2e-plan.md`
- [ ] TN43 Execute E2E test via `@vercel/agent-browser`; document results in `docs/testing/notifications-e2e-results.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Foundational (Phase 1)**: No dependencies — START HERE
- **Outbox + Worker (Phase 2)**: Depends on Foundational + C5 logging
- **Default Templates (Phase 3)**: Depends on Foundational
- **Trigger Hooks (Phase 4)**: Depends on Phases 1-3 + 001-auth-foundation + 005-session-mgmt + 011-billing
- **Template Editor (Phase 5)**: Depends on Phase 3
- **History + Webhook (Phase 6)**: Depends on Phase 2
- **Polish (Phase 7)**: Depends on all prior phases

### Within Each User Story

- Tests MUST be written and FAIL before implementation
- Core service before route handler
- Story complete before moving to next priority

### Parallel Opportunities

Phase 3 and Phase 5 can run in parallel after Phase 1. Phase 6 can run in parallel with Phase 5.