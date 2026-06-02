# Implementation Plan: 012-notifications

**Branch**: `feat/012-notifications` | **Date**: 2026-06-02 | **Spec**: specs/012-notifications/spec.md

## Summary

Implement a database-backed email notification system for PraktiQU. Provides template management (per-clinic overrides), an outbox queue with retry / dead-letter, **cPanel SMTP** transport via nodemailer, and 10 event types covering the full booking / billing / auth lifecycle. Targets feature parity with the KiviCare plugin's email subsystem (`Wordpress-Plugin/kivicare-clinic-management-system/app/emails/`) on the Next.js stack.

> **C7 decision (revised 2026-06-02)**: earlier draft used Resend. Per user direction, MVP uses the **cPanel SMTP server** (provided by shared hosting). MailHog remains for local dev. No third-party transactional email service in MVP.

## Technical Context

- **Language/Version**: TypeScript (strict mode)
- **Primary Dependencies**: Next.js 14+ (App Router), Prisma, Zod, nodemailer, ical-generator, Vitest
- **Storage**: MySQL (PraktiQU's `praktiqu` schema) + Prisma ORM
- **Testing**: Vitest + `@vercel/agent-browser` for E2E
- **Target Platform**: Vercel (Next.js) + cPanel SMTP (production) + MailHog (dev)
- **Project Type**: Web application (backend API + background worker)
- **Performance Goals**: enqueue < 1s of triggering event; send within 60s of `scheduledFor`
- **Constraints**: email-only channel; SMTP transport (no third-party service); database-backed outbox
- **Scale/Scope**: clinic-scoped templates; 10 event types; < 10k emails/month MVP

## Constitution Check

- [x] **Design-Driven**: Email templates follow clinic branding (Stitch reference for header/footer).
- [x] **Trunk-Based**: Branch lifespan ≤ 3 days.
- [x] **Conventional Commits**: `<type>(notifications):` scope.
- [x] **TDD**: All US1-US5 schedule failing tests before implementation.
- [x] **Full CI/CD**: lint, type-check, vitest, build, E2E plan.
- [x] **RFC 7807**: all errors.
- [x] **JWT Auth**: protected endpoints; RBAC per `docs/architecture/role-taxonomy.md`.
- [x] **Database-backed logging**: all events via `logging.audit()` / `logging.activity()`.

## Source Code Structure

```
src/lib/email/
├── smtp.ts                       # nodemailer transport factory (cPanel in prod, MailHog in dev)
├── template-renderer.ts          # variable substitution + HTML/text render
├── icalendar.ts                  # .ics attachment generator
├── queue.ts                      # enqueue / dequeue / retry / dead-letter
└── variables.ts                  # variable schemas per event type

src/services/notifications/
├── send.ts                       # the queue worker (long-lived process)
├── templates.ts                  # CRUD on EmailTemplate
├── messages.ts                   # read EmailMessage history
├── bounces.ts                    # bounce tracking + threshold logic
└── triggers.ts                   # per-event-type enqueue helpers (called from 001, 005, 011)

src/app/api/v1/email-templates/
├── route.ts                      # GET (list) / POST (create override)
└── [key]/route.ts                # GET / PATCH / DELETE

src/app/api/v1/email-messages/
├── route.ts                      # GET (list with filters, paginated)
└── [id]/route.ts                 # GET (single)

src/app/api/v1/webhooks/
└── (none in MVP — cPanel SMTP has no webhook receiver)

src/app/(dashboard)/email-templates/
├── page.tsx                      # list
├── [key]/page.tsx                # editor
└── reset/[key]/page.tsx          # reset to default

src/app/(dashboard)/email-messages/
├── page.tsx                      # history view (filterable)
└── [id]/page.tsx                 # single message view

scripts/
└── email-worker.ts               # entry point for the long-lived worker process
```

## Data Model

New Prisma models added to `prisma/schema.prisma`:

```prisma
model EmailTemplate {
  id        String   @id @default(cuid())
  clinicId  String?  // null = default template (shipped with PraktiQU)
  key       String   // "session.requested", "invoice.issued", etc.
  subject   String
  bodyHtml  String   @db.Text
  bodyText  String   @db.Text
  variables Json     // schema of supported variables
  isActive  Boolean  @default(true)
  version   Int      @default(1)
  createdBy String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  clinic    Clinic? @relation(fields: [clinicId], references: [id], onDelete: Cascade)

  @@unique([clinicId, key])
  @@index([clinicId])
  @@index([key])
  @@map("email_templates")
}

model EmailMessage {
  id              String    @id @default(cuid())
  clinicId        String?
  clientId        String?
  userId          String?
  eventType       String
  templateId      String?
  toEmail         String
  toName          String?
  subject         String
  bodyHtml        String    @db.Text
  bodyText        String    @db.Text
  status          String    @default("pending")
  // pending | sending | sent | delivered | bounced | complained | failed | dead_letter
  resendMessageId String?   @unique
  scheduledFor    DateTime  @default(now())
  sentAt          DateTime?
  deliveredAt     DateTime?
  bouncedAt       DateTime?
  bounceReason    String?   @db.Text
  retryCount      Int       @default(0)
  lastAttemptAt   DateTime?
  nextAttemptAt   DateTime?
  createdAt       DateTime  @default(now())
  metadata        Json?

  clinic    Clinic?       @relation(fields: [clinicId], references: [id], onDelete: SetNull)
  client    Client?       @relation(fields: [clientId], references: [id], onDelete: SetNull)
  user      User?         @relation(fields: [userId], references: [id], onDelete: SetNull)
  template  EmailTemplate? @relation(fields: [templateId], references: [id], onDelete: SetNull)

  @@index([status, scheduledFor])
  @@index([clinicId, createdAt])
  @@index([clientId, createdAt])
  @@index([eventType, createdAt])
  @@map("email_messages")
}

model EmailFailureStat {
  id            String    @id @default(cuid())
  clientId      String?
  email         String
  failureCount  Int       @default(1)
  windowStart   DateTime
  lastFailureAt DateTime  @default(now())

  client Client? @relation(fields: [clientId], references: [id], onDelete: SetNull)

  @@unique([email, windowStart])
  @@index([clientId])
  @@map("email_failure_stats")
}
```

Also add `Client.emailFailureCount: Int @default(0)` to the existing Client model.

## API Endpoints

| Method | Endpoint | Description | Roles |
| --- | --- | --- | --- |
| GET | `/api/v1/email-templates` | List templates (per clinic override + defaults) | SUPER_ADMIN, CLINIC_ADMIN |
| GET | `/api/v1/email-templates/{key}` | Get single template | per role |
| PATCH | `/api/v1/email-templates/{key}` | Update template (creates per-clinic override) | SUPER_ADMIN, CLINIC_ADMIN |
| POST | `/api/v1/email-templates/{key}/reset` | Reset to default (deletes override) | SUPER_ADMIN, CLINIC_ADMIN |
| GET | `/api/v1/email-messages` | List sent/queued messages (paginated, filterable) | SUPER_ADMIN, CLINIC_ADMIN |
| GET | `/api/v1/email-messages/{id}` | Get single message | per role |

## Implementation Phases

See `tasks.md` for the task breakdown. Phases:

1. **Phase 1 — Data model + nodemailer transport**: schema migration, `smtp.ts`, env vars
2. **Phase 2 — Outbox + queue worker**: enqueue, send, retry, dead-letter
3. **Phase 3 — Default templates + variable schema**: 10 event types, Bahasa defaults
4. **Phase 4 — Trigger hooks from 001/005/011**: event-driven enqueueing
5. **Phase 5 — Template editor API + frontend**
6. **Phase 6 — Failure tracking (no webhook in SMTP-only model)**
7. **Phase 7 — Email history view**
8. **Phase 8 — Polish + E2E**

## Dependencies

- **001-auth-foundation**: `password.reset` event
- **005-session-mgmt**: `session.requested`, `session.approved`, `session.rejected`, `session.cancelled`, `session.reminder_24h`, `session.reminder_1h`
- **011-billing**: `invoice.issued`, `payment.received`
- **C5 (logging)**: required for `logging.audit()` / `logging.activity()` calls
- **Resend account**: not required (per C7 — using cPanel SMTP instead)
- **Job runner (C8)**: worker is a long-lived process for MVP; will migrate to chosen runner when C8 is decided

## Risk Register

- **R-1**: Worker crashes mid-send → row stays `sending`; next sweep with timeout recovers; idempotency via `resendMessageId` prevents double-send.
- **R-2**: Resend outage → exponential backoff; dead-letter after 5 attempts; user not affected.
- **R-3**: Template variable missing → logged as warning, literal `{{var}}` rendered; not fail-send.
- **R-4**: Per-clinic override conflict → explicit version bump; override always wins.
- **R-5**: Bounce threshold false positives → 30-day rolling window; admin can manually reset `Client.emailBounceCount = 0`.
- **R-6**: Dev (MailHog) vs prod (Resend) divergence → worker checks `process.env.NODE_ENV`.