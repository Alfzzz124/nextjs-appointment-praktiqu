# Implementation Plan: Session Management

**Branch**: `005-session-mgmt` | **Date**: 2026-06-02 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/005-session-mgmt/spec.md`

## Summary

Implement session management for PraktiQU: session booking with request-approval workflow (PENDING → BOOKED), staff direct booking (BOOKED directly), check-in/check-out workflow, session status lifecycle (PENDING/BOOKED/CHECK_IN/CHECK_OUT/COMPLETED/REJECTED/CANCELLED), double-booking prevention via atomic transactions, calendar view, session filtering, and AUDIT logging. Session duration is copied from service at creation time and stored on the session record.

## Technical Context

**Language/Version**: TypeScript (strict mode), Node 20 LTS
**Primary Dependencies**: Next.js 14+ (App Router), Prisma 5, MySQL (existing WordPress DB), NextAuth v5, Zod (validation)
**Storage**: MySQL via Prisma (extends existing WordPress DB; new Session table + enum)
**Testing**: Vitest (unit/integration), @vercel/agent-browser (E2E via markdown test plans)
**Target Platform**: Web (Vercel-compatible, also works on shared hosting / VPS)
**Project Type**: Web application (Next.js monolith: API routes + UI)
**Performance Goals**: Booking submission < 10s (SC-001); approval propagation < 5s (SC-002); double-booking check < 1s (SC-003); calendar renders 50 sessions in < 2s (SC-006)
**Constraints**: Must coexist with Professional (002), Service (003), Client (004); client INACTIVE blocks booking; professional off-days validated; auto-completion background job
**Scale/Scope**: Single practice, hundreds of sessions per day, 50 visible in calendar at once

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] Design-Driven: UI follows Stitch designs; deviations documented.
- [x] Trunk-Based: Short-lived branch (max 3 days), PR to main.
- [x] Conventional Commits: `feat(session): ...` style.
- [x] TDD + E2E: Unit tests first; E2E plan in `docs/testing/session-mgmt-e2e-plan.md`.
- [x] CI/CD: Lint, type-check, tests, build must pass.
- [x] API Standards: REST `/api/v1/sessions`, RFC 7807 errors, JWT bearer, RBAC, page pagination.
- [x] Logging: Structured DB logging, AUDIT for all status transitions.
- [x] Compatibility: Compatible with Vercel / shared hosting / VPS (no infra-specific APIs).

## Project Structure

### Documentation (this feature)

```text
specs/005-session-mgmt/
├── plan.md              # This file
├── spec.md              # Feature spec
├── memory.md            # Active feature memory
├── memory-synthesis.md  # Synthesis from durable memory
├── data-model.md        # Phase 1: entity definitions
├── contracts/           # Phase 1: API contract files
├── checklists/
│   └── requirements.md  # Quality checklist
├── architecture/        # Feature-local architecture notes
├── decisions/           # Feature-local decisions
├── bugs/               # Feature-local bug watchpoints
└── worklog/            # Feature-local work log
```

### Source Code (repository root)

```text
prisma/
└── schema.prisma                 # New model: Session + SessionStatus enum

src/
├── app/
│   ├── (dashboard)/
│   │   ├── admin/
│   │   │   └── sessions/                 # Admin: calendar, list, booking
│   │   └── professional/
│   │       └── sessions/                  # Professional: pending requests, calendar
│   └── api/
│       └── v1/
│           └── sessions/
│               ├── route.ts               # GET (list), POST (client book / staff book)
│               ├── [id]/
│               │   ├── route.ts           # GET, PATCH (status transitions)
│               │   ├── approve/route.ts  # POST (approve PENDING → BOOKED)
│               │   ├── reject/route.ts    # POST (reject PENDING → REJECTED)
│               │   ├── check-in/route.ts  # POST (BOOKED → CHECK_IN)
│               │   ├── check-out/route.ts  # POST (CHECK_IN → CHECK_OUT)
│               │   └── cancel/route.ts   # POST (PENDING/BOOKED → CANCELLED)
│               └── calendar/route.ts      # GET calendar view
├── services/
│   └── session/
│       ├── session.service.ts             # Business logic
│       ├── double-booking-check.ts        # Atomic conflict detection
│       └── validation.ts                  # Zod schemas
├── components/
│   ├── ui/                                # Base UI primitives
│   └── session/
│       ├── session-calendar.tsx           # Day/Week/Month calendar
│       ├── session-list.tsx
│       ├── session-form.tsx              # Staff booking form
│       ├── session-detail-panel.tsx
│       ├── pending-requests.tsx           # Professional approval queue
│       ├── status-badge.tsx
│       └── filters.tsx
└── lib/
    ├── prisma.ts
    ├── auth.ts                            # RBAC helpers
    ├── audit.ts                           # AUDIT logging helper
    └── auto-complete.ts                   # Background job for auto-completion

jobs/
└── session-auto-complete.ts              # Cron job: runs hourly, marks CHECK_OUT sessions > 24h as COMPLETED

tests/
├── unit/
│   └── session/
│       ├── session.service.test.ts
│       ├── double-booking-check.test.ts
│       └── validation.test.ts
└── integration/
    └── session/
        ├── client-booking.test.ts
        ├── staff-booking.test.ts
        ├── approve-reject.test.ts
        ├── check-in-out.test.ts
        ├── cancel.test.ts
        └── double-booking.test.ts

docs/testing/
└── session-mgmt-e2e-plan.md
```

**Structure Decision**: Single Next.js project. API routes under `/api/v1/sessions/`. Background auto-completion job as a separate script. Follows established pattern from features 002-004.

## Data Model (Prisma)

```prisma
model Session {
  id               String        @id @default(cuid())
  clientId        String                     // FK → Client
  professionalId  String                     // FK → Professional
  serviceId       String                     // FK → Service
  practiceId      String                     // FK → Practice
  slotDate        DateTime                   // UTC date of session
  startTime       DateTime                   // UTC start time
  endTime         DateTime                   // UTC end time (startTime + service.durationMinutes)
  status          SessionStatus @default(PENDING)
  rejectionReason  String?  @db.Text
  checkedInAt     DateTime?
  checkedOutAt    DateTime?
  createdBy       String                     // userId who created (client or receptionist)
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  client          Client     @relation(fields: [clientId], references: [id])
  professional    Professional @relation(fields: [professionalId], references: [id])
  service         Service    @relation(fields: [serviceId], references: [id])

  @@index([professionalId, slotDate, status])
  @@index([clientId, slotDate])
  @@index([practiceId, slotDate])
  @@index([status])
}

enum SessionStatus {
  PENDING      // awaiting approval
  BOOKED       // confirmed
  CHECK_IN     // client arrived
  CHECK_OUT    // session ended
  COMPLETED    // auto-closed after 24h
  REJECTED     // professional rejected
  CANCELLED    // cancelled before start
}
```

## Session Status Transitions

```
PENDING ───[approve]───→ BOOKED ───[check-in]───→ CHECK_IN ───[check-out]───→ CHECK_OUT ───[auto/24h]───→ COMPLETED
   │                           │
   │                           └──[cancel]───→ CANCELLED
   │
   └──[reject]───→ REJECTED
   └──[cancel]───→ CANCELLED
```

**Valid transition rules**:
- PENDING → BOOKED (approve), REJECTED (reject), CANCELLED (cancel)
- BOOKED → CHECK_IN (check-in), CANCELLED (cancel)
- CHECK_IN → CHECK_OUT (check-out)
- CHECK_OUT → COMPLETED (auto or manual after 24h)
- REJECTED, CANCELLED, COMPLETED are terminal — no transitions out

## Double-Booking Prevention Algorithm

```
checkAndBookSlot(clientId, professionalId, serviceId, slotDate, startTime, practiceId):
  1. BEGIN TRANSACTION with SERIALIZABLE isolation
  2. Verify client.status == ACTIVE (or reject 403)
  3. Verify professional.status == ACTIVE (or reject 400)
  4. Verify professional has no off-day on slotDate (or reject 400)
  5. Verify slotDate is not a practice holiday (or reject 400)
  6. endTime = startTime + service.durationMinutes
  7. Query existing sessions where:
     professionalId = given professionalId
     status IN (BOOKED, CHECK_IN, CHECK_OUT, COMPLETED)
     slotDate = given slotDate
     (startTime < calculatedEndTime AND endTime > givenStartTime)  // overlap check
  8. If any session found: ROLLBACK and return 409 "Double-booking prevented"
  9. Create session record
  10. COMMIT and return 201
```

## API Contracts

```
GET    /api/v1/sessions                         # list (paginated, filterable)
POST   /api/v1/sessions                         # client book (PENDING) or staff book (BOOKED directly)
GET    /api/v1/sessions/:id                     # read details
PATCH  /api/v1/sessions/:id                    # partial update (status transitions via sub-routes)

POST   /api/v1/sessions/:id/approve            # PENDING → BOOKED
POST   /api/v1/sessions/:id/reject             # PENDING → REJECTED (reason required)
POST   /api/v1/sessions/:id/check-in          # BOOKED → CHECK_IN
POST   /api/v1/sessions/:id/check-out         # CHECK_IN → CHECK_OUT
POST   /api/v1/sessions/:id/cancel            # PENDING/BOOKED → CANCELLED (reason optional)

GET    /api/v1/sessions/calendar?view=day|week|month&date=YYYY-MM-DD  # calendar view
GET    /api/v1/sessions/pending               # Professional's pending requests
```

**Calendar pagination**: Day/Week views return ≤50 sessions — no pagination needed. Month view applies standard pagination for larger datasets.

## Authorization Matrix

| Endpoint | SUPER_ADMIN | CLINIC_ADMIN | PROFESSIONAL | RECEPTIONIST | CLIENT |
|---|---|---|---|---|---|
| GET /sessions | yes (all) | yes (practice) | own only | yes (practice) | own only |
| POST /sessions (client) | no | no | no | no | yes (creates PENDING) |
| POST /sessions (staff) | yes | yes | no | yes (practice) | no (creates BOOKED) |
| GET /sessions/:id | yes (all) | yes (practice) | own only | yes (practice) | own only |
| PATCH /sessions/:id | yes | yes | no | yes | own only |
| POST /approve | yes | yes | own only | no | no |
| POST /reject | yes | yes | own only | no | no |
| POST /check-in | no | yes | no | yes (practice) | no |
| POST /check-out | no | yes | no | yes (practice) | no |
| POST /cancel | no | yes | no | yes (practice) | own only |
| GET /pending | yes | yes | own only | no | no |

## Auto-Completion Background Job

Runs as a cron job (hourly):
1. Query all sessions where status = CHECK_OUT AND checkedOutAt < NOW() - 24 hours
2. Update each to status = COMPLETED with AUDIT log

**Cron trigger**: Deferred to deployment configuration (Vercel cron, external cron service, or similar).

## Complexity Tracking

> No constitution violations requiring justification.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| (none) | - | - |

## Implementation Order

1. Prisma schema + migration (add Session model + SessionStatus enum)
2. Validation schemas (Zod)
3. Double-booking prevention service
4. Session service (CRUD, all status transitions, AUDIT logging)
5. API routes (all endpoints)
6. Calendar component (day/week/month views)
7. Professional pending requests queue
8. UI: session list, detail panel, booking form, status badges, filters
9. Auto-completion background job
10. Unit + integration tests
11. E2E plan markdown