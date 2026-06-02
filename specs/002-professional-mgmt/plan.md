# Implementation Plan: Professional Management

**Branch**: `002-professional-mgmt` | **Date**: 2026-06-02 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-professional-mgmt/spec.md`

## Summary

Implement professional (psychologist/psychiatrist) management for PraktiQU: registration with SIP/SIK and professional type, self-service profile maintenance, weekly availability + off-day configuration, slot generation intersected with assigned services' durations, and admin controls (list/search/status/service assignment) for clinic administrators. Times stored in UTC; converted at the API edge per practice timezone / client locale.

## Technical Context

**Language/Version**: TypeScript (strict mode), Node 20 LTS
**Primary Dependencies**: Next.js 14+ (App Router), Prisma 5, MySQL (existing WordPress DB), NextAuth v5, Zod (validation), date-fns-tz (timezone)
**Storage**: MySQL via Prisma (extends existing WordPress DB; new tables for professional profile, availability, off-days, service assignments)
**Testing**: Vitest (unit/integration), @vercel/agent-browser (E2E via markdown test plans)
**Target Platform**: Web (Vercel-compatible, also works on shared hosting / VPS)
**Project Type**: Web application (Next.js monolith: API routes + UI)
**Performance Goals**: Slot query < 500ms p95; list endpoint < 1s for 500 professionals (SC-006)
**Constraints**: Must coexist with WordPress user table; no breaking changes to auth-foundation (001)
**Scale/Scope**: Single practice, hundreds of professionals, thousands of availability windows

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] Design-Driven: UI follows Stitch designs; deviations documented.
- [x] Trunk-Based: Short-lived branch (max 3 days), PR to main.
- [x] Conventional Commits: `feat(professional): ...` style.
- [x] TDD + E2E: Unit tests first; E2E plan in `docs/testing/professional-mgmt-e2e-plan.md`.
- [x] CI/CD: Lint, type-check, tests, build must pass.
- [x] API Standards: REST `/api/v1/professionals`, RFC 7807 errors, JWT bearer, RBAC, page pagination.
- [x] Logging: Structured DB logging, AUDIT for state changes, PERF for slot endpoint.
- [x] Compatibility: Compatible with Vercel / shared hosting / VPS (no infra-specific APIs).

## Project Structure

### Documentation (this feature)

```text
specs/002-professional-mgmt/
├── plan.md              # This file
├── spec.md              # Feature spec
├── memory.md            # Active feature memory
├── memory-synthesis.md  # Synthesis from durable memory
├── checklists/
│   └── requirements.md  # Quality checklist
├── architecture/        # Feature-local architecture notes
├── decisions/           # Feature-local decisions
├── bugs/                # Feature-local bug watchpoints
└── worklog/             # Feature-local work log
```

### Source Code (repository root)

```text
prisma/
└── schema.prisma                 # New models: Professional, ProfessionalAvailability, ProfessionalOffDay, ProfessionalServiceAssignment

src/
├── app/
│   ├── (dashboard)/
│   │   ├── admin/
│   │   │   └── professionals/            # Admin: list/create/edit
│   │   └── professional/
│   │       └── profile/                  # Self-service profile + schedule
│   └── api/
│       └── v1/
│           ├── professionals/
│           │   ├── route.ts              # GET (list), POST (create)
│           │   ├── [id]/
│           │   │   ├── route.ts          # GET, PATCH, DELETE
│           │   │   ├── status/route.ts   # PATCH (activate/deactivate)
│           │   │   ├── services/route.ts # GET, POST, DELETE
│           │   │   ├── availability/route.ts # GET, PUT
│           │   │   └── off-days/route.ts # GET, POST, DELETE
│           └── professionals/[id]/slots/route.ts # GET public slot grid
├── services/
│   └── professional/
│       ├── professional.service.ts        # Business logic
│       ├── availability.service.ts        # Slot generation
│       └── validation.ts                 # Zod schemas
├── components/
│   ├── ui/                                # Base UI primitives
│   └── professional/
│       ├── professional-form.tsx
│       ├── professional-list.tsx
│       ├── availability-editor.tsx
│       └── off-day-editor.tsx
└── lib/
    ├── prisma.ts
    ├── auth.ts                            # RBAC helpers
    ├── time.ts                            # UTC ↔ timezone conversion
    └── audit.ts                           # AUDIT logging helper

tests/
├── unit/
│   └── professional/
│       ├── professional.service.test.ts
│       ├── availability.service.test.ts
│       └── validation.test.ts
└── integration/
    └── professional/
        ├── create.test.ts
        ├── list.test.ts
        ├── status.test.ts
        └── slots.test.ts

docs/testing/
└── professional-mgmt-e2e-plan.md
```

**Structure Decision**: Single Next.js project (no separate backend/frontend split). API routes under `/api/v1/professionals/` per the API standards in the Constitution.

## API Contracts

```
GET    /api/v1/professionals                 # list (paginated, filterable)
POST   /api/v1/professionals                 # create (Super Admin)
GET    /api/v1/professionals/:id             # read
PATCH  /api/v1/professionals/:id             # partial update
DELETE /api/v1/professionals/:id             # soft-delete (set INACTIVE)

PATCH  /api/v1/professionals/:id/status      # activate/deactivate
GET    /api/v1/professionals/:id/services    # list assigned services
POST   /api/v1/professionals/:id/services    # assign service
DELETE /api/v1/professionals/:id/services/:serviceId

GET    /api/v1/professionals/:id/availability
PUT    /api/v1/professionals/:id/availability # replace full weekly schedule

GET    /api/v1/professionals/:id/off-days
POST   /api/v1/professionals/:id/off-days
DELETE /api/v1/professionals/:id/off-days/:offDayId

GET    /api/v1/professionals/:id/slots?date=YYYY-MM-DD&serviceId=...
```

## Data Model (Prisma sketch)

```prisma
model Professional {
  id                  String   @id @default(cuid())
  userId              String   @unique          // WordPress user
  practiceId          String                      // foreign key to Practice
  fullName            String
  email               String   @unique
  professionalType    ProfessionalType
  registrationNumber  String   @unique
  status              ProfessionalStatus @default(PENDING_ACTIVATION)
  biography           String?  @db.Text
  specialties         Json?                       // array of strings
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt

  availability        ProfessionalAvailability[]
  offDays             ProfessionalOffDay[]
  serviceAssignments  ProfessionalServiceAssignment[]

  @@index([practiceId, status])
}

model ProfessionalAvailability {
  id              String @id @default(cuid())
  professionalId  String
  dayOfWeek       Int      // 0-6 (Sun-Sat)
  startMinute     Int      // minutes from 00:00
  endMinute       Int      // minutes from 00:00
  professional    Professional @relation(fields: [professionalId], references: [id], onDelete: Cascade)

  @@unique([professionalId, dayOfWeek, startMinute])
  @@index([professionalId, dayOfWeek])
}

model ProfessionalOffDay {
  id              String @id @default(cuid())
  professionalId  String
  startDate       DateTime  // UTC
  endDate         DateTime  // UTC
  reason          String?
  professional    Professional @relation(fields: [professionalId], references: [id], onDelete: Cascade)

  @@index([professionalId, startDate, endDate])
}

model ProfessionalServiceAssignment {
  id              String @id @default(cuid())
  professionalId  String
  serviceId       String
  createdAt       DateTime @default(now())
  professional    Professional @relation(fields: [professionalId], references: [id], onDelete: Cascade)

  @@unique([professionalId, serviceId])
}

enum ProfessionalType {
  PSIKOLOG_KLINIS
  PSIKOLOG_ANAK
  PSIKIATER
  KONSELOR
  // extensible via migration; closed enumeration in v1
}

enum ProfessionalStatus {
  PENDING_ACTIVATION
  ACTIVE
  INACTIVE
}
```

## Authorization Matrix

| Endpoint | SUPER_ADMIN | CLINIC_ADMIN | PROFESSIONAL | RECEPTIONIST | CLIENT |
|---|---|---|---|---|---|
| GET /professionals | yes (all) | yes (own practice) | no | no | no |
| POST /professionals | yes | no | no | no | no |
| GET /professionals/:id | yes | yes (own practice) | yes (self) | yes (own practice, read-only) | no |
| PATCH /professionals/:id | yes (all fields) | yes (status, services) | yes (limited fields, self) | no | no |
| PATCH /professionals/:id/status | yes | yes (own practice) | no | no | no |
| /services (assign) | yes | yes (own practice) | no | no | no |
| /availability | yes | no | yes (self) | no | no |
| /off-days | yes | no | yes (self) | no | no |
| /slots (read) | yes | yes | yes | yes | yes |

**Note**: All state changes use soft-delete (set INACTIVE) or status-based transitions. Physical deletion is not supported in v1.

## Slot Generation Algorithm

```
generateSlots(professionalId, date, serviceId):
  1. Verify professional.status == ACTIVE
  2. Verify service is assigned to professional and ACTIVE
  3. Get practice.timezone
  4. Convert date (in practice TZ) → weekday
  5. Fetch windows for (professionalId, weekday)
  6. Subtract off-days where startDate..endDate includes date
  7. Subtract existing BOOKED, PENDING, CHECKED_IN sessions for date (PENDING blocks slots same as BOOKED)
  8. For each window:
     - Walk in service.durationMinutes increments
     - Emit slot = window.start + i*duration
     - Stop when next slot would exceed window.end
  9. Convert each slot (local TZ) → UTC, return
```

**Watchpoints**:
- Holiday blocking (BR-05.05) is deferred to feature 013 (Practice Management). Until holiday entity exists, slot generation treats holidays as no-ops. When feature 013 is implemented, union off-day and holiday overrides.
- PENDING sessions block slot generation (same as BOOKED). Only COMPLETED, CANCELLED, REJECTED sessions do not block.
- Off-day overrides and holiday overrides must be unioned; any match yields no slots.
- Slot generation must handle 30/60/90/120-minute services correctly (SC-003).

## Audit Events

- `professional.created`
- `professional.updated`
- `professional.status_changed` (with before/after)
- `professional.service_assigned`
- `professional.service_unassigned`
- `professional.availability_changed`
- `professional.off_day_added`
- `professional.off_day_removed`

## Complexity Tracking

> No constitution violations requiring justification.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| (none) | - | - |

## Implementation Order

1. Prisma schema + migration
2. Validation schemas (Zod)
3. Professional service (CRUD, status, services)
4. Availability service (schedule + off-days)
5. Slot generation service
6. API routes (all endpoints)
7. UI: admin list + create + edit
8. UI: self-service profile + availability editor
9. Unit + integration tests
10. E2E plan markdown
11. AUDIT logging integration
