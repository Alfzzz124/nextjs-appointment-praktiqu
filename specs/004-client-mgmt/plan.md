# Implementation Plan: Client Management

**Branch**: `004-client-mgmt` | **Date**: 2026-06-02 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/004-client-mgmt/spec.md`

## Summary

Implement client management for PraktiQU: register clients with unique ID generation (CLT-YYYY-NNNNN), demographics and contact info, client list with pagination and search, session history view, client status lifecycle (ACTIVE/INACTIVE/ARCHIVED), and a progress overview aggregating session notes and intervention plans. Clients link one-to-one to WordPress user accounts. Data access is enforced per role (professionals see only their clients; staff see practice clients).

## Technical Context

**Language/Version**: TypeScript (strict mode), Node 20 LTS
**Primary Dependencies**: Next.js 14+ (App Router), Prisma 5, MySQL (existing WordPress DB), NextAuth v5, Zod (validation)
**Storage**: MySQL via Prisma (extends existing WordPress DB; new Client table + enums)
**Testing**: Vitest (unit/integration), @vercel/agent-browser (E2E via markdown test plans)
**Target Platform**: Web (Vercel-compatible, also works on shared hosting / VPS)
**Project Type**: Web application (Next.js monolith: API routes + UI)
**Performance Goals**: Client list < 1s for 200 clients (SC-002); search < 500ms (SC-003); status change blocks booking within 5s (SC-004)
**Constraints**: Must coexist with existing WordPress user table (auth-foundation 001), Session entity (005), Session Notes (008), Intervention Plan (009); data access enforced at service layer
**Scale/Scope**: Single practice, up to 5,000 clients per practice, each with session history

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] Design-Driven: UI follows Stitch designs; deviations documented.
- [x] Trunk-Based: Short-lived branch (max 3 days), PR to main.
- [x] Conventional Commits: `feat(client): ...` style.
- [x] TDD + E2E: Unit tests first; E2E plan in `docs/testing/client-mgmt-e2e-plan.md`.
- [x] CI/CD: Lint, type-check, tests, build must pass.
- [x] API Standards: REST `/api/v1/clients`, RFC 7807 errors, JWT bearer, RBAC, page pagination.
- [x] Logging: Structured DB logging, AUDIT for status changes and profile updates.
- [x] Compatibility: Compatible with Vercel / shared hosting / VPS (no infra-specific APIs).

## Project Structure

### Documentation (this feature)

```text
specs/004-client-mgmt/
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
└── schema.prisma                 # New model: Client + ClientStatus + Gender enums

src/
├── app/
│   ├── (dashboard)/
│   │   ├── admin/
│   │   │   └── clients/                   # Admin: list/create/edit
│   │   └── client/
│   │       └── profile/                   # Self-service profile
│   └── api/
│       └── v1/
│           └── clients/
│               ├── route.ts               # GET (list), POST (register)
│               ├── [id]/
│               │   ├── route.ts           # GET, PATCH, DELETE
│               │   └── status/route.ts    # PATCH (status change)
│               ├── [id]/history/route.ts  # GET session history
│               └── [id]/progress/route.ts # GET progress summary
├── services/
│   └── client/
│       ├── client.service.ts              # CRUD + status + unique ID generation
│       ├── validation.ts                  # Zod schemas
│       └── access-control.ts              # Professional-client access rules
├── components/
│   ├── ui/                                # Base UI primitives
│   └── client/
│       ├── client-list.tsx
│       ├── client-form.tsx
│       ├── client-detail.tsx
│       ├── client-status-badge.tsx
│       ├── session-history.tsx
│       └── progress-overview.tsx
└── lib/
    ├── prisma.ts
    ├── auth.ts                            # RBAC helpers
    ├── audit.ts                           # AUDIT logging helper
    └── unique-id.ts                       # Client ID generator

tests/
├── unit/
│   └── client/
│       ├── client.service.test.ts
│       ├── validation.test.ts
│       └── access-control.test.ts
└── integration/
    └── client/
        ├── register.test.ts
        ├── list.test.ts
        ├── status.test.ts
        └── progress.test.ts

docs/testing/
└── client-mgmt-e2e-plan.md
```

**Structure Decision**: Single Next.js project. API routes under `/api/v1/clients/`. Follows established pattern from features 002 and 003 for consistency.

## Data Model (Prisma)

```prisma
model Client {
  id              String       @id @default(cuid())
  userId          String       @unique          // WordPress user link
  practiceId      String                        // foreign key to Practice
  uniqueClientId  String                        // human-readable ID, e.g., CLT-2026-00001
  fullName        String   @db.VarChar(100)
  email           String   @db.VarChar(255)
  mobileNumber    String   @db.VarChar(20)
  dateOfBirth     DateTime
  gender          Gender
  address         String?  @db.Text
  emergencyContact String? @db.VarChar(100)
  notes           String?  @db.Text
  status          ClientStatus @default(ACTIVE)
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  sessions        Session[]

  @@unique([practiceId, uniqueClientId])   // unique per practice
  @@unique([practiceId, email])             // email unique per practice
  @@index([practiceId, status])
  @@index([fullName])
  @@index([mobileNumber])
}

enum Gender {
  MALE
  FEMALE
  OTHER
}

enum ClientStatus {
  ACTIVE    // can book
  INACTIVE  // paused
  ARCHIVED  // departed/erased
}
```

## Client ID Generation Algorithm

```
generateUniqueClientId(practiceId, year):
  1. Query last Client where practiceId AND uniqueClientId LIKE "CLT-{year}-%"
  2. Extract sequential number from last ID (or start at 0)
  3. nextNumber = lastNumber + 1
  4. Return "CLT-{year}-{padded(nextNumber, 5)}"  // e.g., CLT-2026-00042
  5. Handle overflow: if nextNumber > 99999, log warning and use overflow format "CLT-{year}-OVF-{nextNumber}"
```

## API Contracts

```
GET    /api/v1/clients                        # list (paginated, searchable, filterable)
POST   /api/v1/clients                         # register (Receptionist/Admin)
GET    /api/v1/clients/:id                     # read details
PATCH  /api/v1/clients/:id                    # partial update (profile)
DELETE /api/v1/clients/:id                    # soft-delete (archive)

PATCH  /api/v1/clients/:id/status             # ACTIVE/INACTIVE/ARCHIVED

GET    /api/v1/clients/:id/history            # session history for client
GET    /api/v1/clients/:id/progress           # aggregated progress (sessions + notes + plans)
```

## Authorization Matrix

| Endpoint | SUPER_ADMIN | CLINIC_ADMIN | PROFESSIONAL | RECEPTIONIST | CLIENT |
|---|---|---|---|---|---|
| GET /clients | yes (all) | yes (practice) | see note | yes (practice) | no |
| POST /clients | yes | yes (practice) | no | yes (practice) | no |
| GET /clients/:id | yes (all) | yes (practice) | own clients only | yes (practice) | yes (self) |
| PATCH /clients/:id | yes | yes (practice) | limited (self) | no | limited (self) |
| DELETE /clients/:id | yes | yes (practice) | no | no | no |
| PATCH /clients/:id/status | yes | yes (practice) | no | no | no |
| GET /clients/:id/history | yes (all) | yes (practice) | own clients only | yes (practice) | no |
| GET /clients/:id/progress | yes (all) | yes (practice) | own clients only | no | no |

**Professional access note**: Professionals see only clients they have had at least one BOOKED/COMPLETED session with (enforced in client.service.ts accessControl()).

## Data Access Rules (BR-10.01 through BR-10.05)

Implemented at the service layer:
- `SUPER_ADMIN`: all clients, all practices
- `CLINIC_ADMIN`: clients in their practice only
- `RECEPTIONIST`: clients in their practice only (read-only)
- `PROFESSIONAL`: clients they have had sessions with (BR-10.01: "Professionals see own clients only")
- `CLIENT`: own profile only (self)

## Progress Aggregation

The `/clients/:id/progress` endpoint aggregates data from:
- Session entity (005) — always available
- Session Notes (008) — may not be implemented; show null summaries in degraded mode
- Intervention Plan (009) — may not be implemented; show null summaries in degraded mode

**Degraded mode** (008/009 not implemented):
- `sessionTimeline[].sessionNotesSummary` = null
- `sessionTimeline[].interventionPlanSummary` = null
- `activeInterventionPlan` = null

No error thrown — graceful degradation preserves user experience.

## Complexity Tracking

> No constitution violations requiring justification.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| (none) | - | - |

## Implementation Order

1. Prisma schema + migration (add Client model + enums)
2. Unique client ID generator utility
3. Validation schemas (Zod)
4. Client service (CRUD, status, unique ID, access control)
5. API routes (all endpoints)
6. UI: admin list + create + edit
7. UI: self-service profile
8. UI: client detail + session history + progress overview
9. Unit + integration tests
10. E2E plan markdown
11. AUDIT logging integration