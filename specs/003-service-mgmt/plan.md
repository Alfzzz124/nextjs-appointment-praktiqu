# Implementation Plan: Service Management

**Branch**: `003-service-mgmt` | **Date**: 2026-06-02 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/003-service-mgmt/spec.md`

## Summary

Implement service catalog management for PraktiQU: create, update, list, search, deactivate, reactivate, and delete services with pricing, flexible duration (30/60/90/120/150/180 min), and service types (KONSELING/ASESMEN/WORKSHOP). Services belong to a single practice. Deactivation is soft-delete only; physical deletion is blocked for services with booking history. The service entity drives slot generation for Professional Management (002).

## Technical Context

**Language/Version**: TypeScript (strict mode), Node 20 LTS
**Primary Dependencies**: Next.js 14+ (App Router), Prisma 5, MySQL (existing WordPress DB), NextAuth v5, Zod (validation)
**Storage**: MySQL via Prisma (extends existing WordPress DB; new Service table)
**Testing**: Vitest (unit/integration), @vercel/agent-browser (E2E via markdown test plans)
**Target Platform**: Web (Vercel-compatible, also works on shared hosting / VPS)
**Project Type**: Web application (Next.js monolith: API routes + UI)
**Performance Goals**: Service list < 1s for 100 services (SC-004); deactivated services hidden in slot results within 5s (SC-003)
**Constraints**: Must coexist with existing Professional, Practice, and ProfessionalServiceAssignment entities from features 002 and 013
**Scale/Scope**: Single practice, up to 100 services per practice, each service assigned to 1-N professionals

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] Design-Driven: UI follows Stitch designs; deviations documented.
- [x] Trunk-Based: Short-lived branch (max 3 days), PR to main.
- [x] Conventional Commits: `feat(service): ...` style.
- [x] TDD + E2E: Unit tests first; E2E plan in `docs/testing/service-mgmt-e2e-plan.md`.
- [x] CI/CD: Lint, type-check, tests, build must pass.
- [x] API Standards: REST `/api/v1/services`, RFC 7807 errors, JWT bearer, RBAC, page pagination.
- [x] Logging: Structured DB logging, AUDIT for all state changes.
- [x] Compatibility: Compatible with Vercel / shared hosting / VPS (no infra-specific APIs).

## Project Structure

### Documentation (this feature)

```text
specs/003-service-mgmt/
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
└── schema.prisma                 # New model: Service + ServiceType + ServiceStatus enums

src/
├── app/
│   ├── (dashboard)/
│   │   └── admin/
│   │       └── services/                 # Admin: list/create/edit
│   └── api/
│       └── v1/
│           └── services/
│               ├── route.ts              # GET (list), POST (create)
│               ├── [id]/
│               │   ├── route.ts          # GET, PATCH, DELETE
│               │   └── status/route.ts   # PATCH (activate/deactivate)
│           └── public/
│               └── route.ts              # GET ACTIVE services (public booking portal)
├── services/
│   └── service/
│       ├── service.service.ts            # CRUD + soft-delete
│       └── validation.ts                # Zod schemas
├── components/
│   ├── ui/                              # Base UI primitives
│   └── service/
│       ├── service-list.tsx
│       ├── service-form.tsx
│       ├── service-type-select.tsx
│       └── duration-select.tsx
└── lib/
    ├── prisma.ts
    ├── auth.ts                          # RBAC helpers
    └── audit.ts                         # AUDIT logging helper

tests/
├── unit/
│   └── service/
│       ├── service.service.test.ts
│       └── validation.test.ts
└── integration/
    └── service/
        ├── create.test.ts
        ├── list.test.ts
        ├── update.test.ts
        └── deactivate.test.ts

docs/testing/
└── service-mgmt-e2e-plan.md
```

**Structure Decision**: Single Next.js project (no separate backend/frontend split). API routes under `/api/v1/services/` per the API standards in the Constitution. Follows the same pattern as feature 002 (Professional Management) for consistency.

## Data Model (Prisma)

```prisma
model Service {
  id            String       @id @default(cuid())
  practiceId    String                    // foreign key to Practice
  name          String   @db.VarChar(100)
  description   String?  @db.Text
  price         Int                       // smallest currency unit (e.g., rupiahs)
  durationMinutes Int                     // 30, 60, 90, 120, 150, 180
  serviceType   ServiceType
  status        ServiceStatus @default(ACTIVE)
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  assignments   ProfessionalServiceAssignment[]

  @@unique([practiceId, name])
  @@index([practiceId, status])
  @@index([serviceType])
}

enum ServiceType {
  KONSELING   // Individual counseling
  ASESMEN     // Psychological assessment
  WORKSHOP    // Group training/workshop
}

enum ServiceStatus {
  ACTIVE
  INACTIVE
}
```

## API Contracts

```
GET    /api/v1/services                          # list (paginated, filterable by type, status)
POST   /api/v1/services                          # create (Clinic Admin)
GET    /api/v1/services/:id                      # read details
PATCH  /api/v1/services/:id                      # partial update
DELETE /api/v1/services/:id                      # physical delete (INACTIVE + no bookings only)

PATCH  /api/v1/services/:id/status               # activate/deactivate

GET    /api/v1/services/public                   # ACTIVE services for public booking portal (no auth required)
```

## Authorization Matrix

| Endpoint | SUPER_ADMIN | CLINIC_ADMIN | PROFESSIONAL | RECEPTIONIST | CLIENT |
|---|---|---|---|---|---|
| GET /services | yes (all) | yes (own practice) | yes (read) | yes (read) | no |
| POST /services | yes | yes (own practice) | no | no | no |
| GET /services/:id | yes (all) | yes (own practice) | yes | yes | no |
| PATCH /services/:id | yes | yes (own practice) | no | no | no |
| DELETE /services/:id | yes | yes (own practice) | no | no | no |
| PATCH /services/:id/status | yes | yes (own practice) | no | no | no |
| GET /services/public | yes | yes | yes | yes | yes |

## Slot Duration Integration

The `durationMinutes` field on Service is the primary input to slot generation (feature 002, FR-007). The service entity does not store slot data — it only defines the duration. Slot generation reads `Service.durationMinutes` for each service assigned to a professional.

When `durationMinutes` is updated:
- Existing BOOKED sessions retain the old duration value (session stores its own start/end time)
- New slot generation reads the updated value immediately
- The system returns HTTP 200 with `X-Warning` header when changing duration on a service with existing bookings (FR-005). The UI displays the warning dialog before confirming the save.

## Complexity Tracking

> No constitution violations requiring justification.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| (none) | - | - |

## Implementation Order

1. Prisma schema + migration (add Service model + enums to existing schema)
2. Validation schemas (Zod)
3. Service service (CRUD, soft-delete, deactivation)
4. API routes (all endpoints)
5. UI: admin list + create + edit
6. Unit + integration tests
7. E2E plan markdown
8. AUDIT logging integration