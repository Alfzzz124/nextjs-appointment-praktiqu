# Implementation Plan: Dashboard

**Branch**: `006-dashboard` | **Date**: 2026-06-02 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/006-dashboard/spec.md`

## Summary

Implement role-specific dashboards for PraktiQU: Receptionist/Admin, Professional, Client, and Super Admin views. Each dashboard shows role-appropriate widgets: today's sessions, pending approvals, active clients, upcoming sessions, recent history, and statistics. Dashboard is read-only — all data is aggregated from existing Session (005), Client (004), Professional (002), and Service (003) entities. No new data stores.

## Technical Context

**Language/Version**: TypeScript (strict mode), Node 20 LTS
**Primary Dependencies**: Next.js 14+ (App Router), Prisma 5, MySQL (existing WordPress DB), NextAuth v5
**Storage**: No new data stores — dashboard reads from existing Session, Client, Professional, Service tables
**Testing**: Vitest (unit), @vercel/agent-browser (E2E via markdown test plans)
**Target Platform**: Web (Vercel-compatible, also works on shared hosting / VPS)
**Project Type**: Web application (Next.js — primarily UI, server-side aggregation)
**Performance Goals**: Dashboard loads within 3s (SC-001); aggregation queries < 1s per widget
**Constraints**: All data from features 002-005; no new entities; Super Admin cross-practice aggregation
**Scale/Scope**: Single practice dashboards (Receptionist/Admin/Professional/Client); Super Admin aggregates across all practices

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] Design-Driven: UI follows Stitch designs; deviations documented.
- [x] Trunk-Based: Short-lived branch (max 3 days), PR to main.
- [x] Conventional Commits: `feat(dashboard): ...` style.
- [x] TDD + E2E: Unit tests for aggregation logic; E2E plan in `docs/testing/dashboard-e2e-plan.md`.
- [x] CI/CD: Lint, type-check, tests, build must pass.
- [x] API Standards: REST endpoints for dashboard data, RFC 7807 errors, JWT bearer, RBAC.
- [x] Logging: No new logging requirements — existing audit trails cover actions.
- [x] Compatibility: Compatible with Vercel / shared hosting / VPS (no infra-specific APIs).

**Dashboard Pages**: Use Next.js Server Components (RSC) for initial data load. Client-side refresh via SWR or React Query for subsequent updates. Quick Actions widget is client-side only — renders static link-based CTAs; no API endpoint required.

## Project Structure

### Documentation (this feature)

```text
specs/006-dashboard/
├── plan.md              # This file
├── spec.md              # Feature spec
├── memory.md            # Active feature memory
├── memory-synthesis.md  # Synthesis from durable memory
├── data-model.md        # Phase 1: entity references (no new entities)
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
src/
├── app/
│   ├── (dashboard)/
│   │   ├── dashboard/
│   │   │   └── page.tsx             # Root dashboard — redirects to role-specific view
│   │   ├── admin/
│   │   │   └── dashboard/
│   │   │       └── page.tsx         # Receptionist/Clinic Admin dashboard
│   │   ├── professional/
│   │   │   └── dashboard/
│   │   │       └── page.tsx         # Professional dashboard
│   │   └── client/
│   │       └── dashboard/
│   │           └── page.tsx          # Client dashboard
│   └── api/
│       └── v1/
│           └── dashboard/
│               ├── route.ts          # GET aggregated dashboard data (role-scoped)
│               └── stats/
│                   └── route.ts       # GET statistics (Admin/Super Admin only)
├── services/
│   └── dashboard/
│       ├── dashboard.service.ts        # Widget data aggregation
│       └── stats.service.ts         # Statistics computation
├── components/
│   ├── ui/                          # Base UI primitives
│   └── dashboard/
│       ├── dashboard-layout.tsx      # Main layout with sidebar
│       ├── widgets/
│       │   ├── today-sessions.tsx
│       │   ├── pending-approvals.tsx
│       │   ├── active-clients.tsx
│       │   ├── upcoming-sessions.tsx
│       │   ├── recent-history.tsx
│       │   ├── statistics.tsx
│       │   ├── quick-actions.tsx
│       │   └── skeleton-loader.tsx
│       └── shared/
│           ├── stat-card.tsx
│           └── session-list-item.tsx

tests/
├── unit/
│   └── dashboard/
│       ├── dashboard.service.test.ts
│       └── stats.service.test.ts
└── integration/
    └── dashboard/
        ├── admin-dashboard.test.ts
        ├── professional-dashboard.test.ts
        └── client-dashboard.test.ts

docs/testing/
└── dashboard-e2e-plan.md
```

**Structure Decision**: Single Next.js project. Dashboard pages under `(dashboard)/` route group with role-specific sub-routes. API routes for server-side aggregation. Widgets as reusable components. Follows established Next.js App Router patterns.

## Data Model (No New Entities)

Dashboard reads from existing entities:

- **Session** (feature 005): slotDate, startTime, status, clientId, professionalId, serviceId, practiceId
- **Client** (feature 004): id, fullName, status, practiceId, createdAt
- **Professional** (feature 002): id, fullName, practiceId, status
- **Service** (feature 003): id, name, price, practiceId

### Dashboard Widget Data Shapes

```
Today's Sessions Widget:
  - Query: Session WHERE slotDate = today AND practiceId = user's practice (scoped by role)
  - Group by: status
  - List: top 20 sessions ordered by startTime
  - Fields: clientName, professionalName, serviceName, startTime, status

Pending Approvals Widget:
  - Query: Session WHERE status = PENDING AND professionalId = user's professionalId (or practice)
  - Count + list

Active Clients Widget (Professional):
  - Query: DISTINCT clientId FROM Session WHERE professionalId = user AND status IN (BOOKED, COMPLETED)
  - Count

Statistics Widget (Admin):
  - Sessions this week: COUNT WHERE slotDate between week_start AND week_end
  - Sessions last week: same for previous week
  - Percentage change: calculated
  - Active clients: COUNT DISTINCT Client WHERE status = ACTIVE AND practiceId = practice
  - New clients this month: COUNT WHERE createdAt between month_start AND now

Upcoming Sessions Widget (Client):
  - Query: Session WHERE clientId = user AND slotDate >= today ORDER BY slotDate ASC LIMIT 5
  - Fields: date, startTime, serviceName, professionalName

Recent History Widget (Client):
  - Query: Session WHERE clientId = user AND status = COMPLETED ORDER BY endTime DESC LIMIT 3
```

## API Contracts

```
GET /api/v1/dashboard                    # Aggregated dashboard data (role-scoped)
GET /api/v1/dashboard/stats            # Statistics (Admin/Super Admin only)
```

### GET /api/v1/dashboard

Returns role-appropriate dashboard data in a single response.

**Authorization**: All authenticated roles (data scoped by role)

**Response** (200):
```json
{
  "data": {
    "role": "PROFESSIONAL",
    "widgets": {
      "todaySessions": {
        "count": 4,
        "sessions": [
          { "id": "ses_abc", "client": "Ahmad", "service": "Konseling", "time": "09:00", "status": "BOOKED" }
        ]
      },
      "pendingApprovals": {
        "count": 2
      },
      "activeClients": {
        "count": 15
      },
      "upcomingSessions": {
        "sessions": [
          { "id": "ses_xyz", "date": "2026-06-10", "time": "09:00", "service": "Konseling", "professional": "Dr. Sarah" }
        ]
      }
    }
  }
}
```

### GET /api/v1/dashboard/stats

Returns administrative statistics.

**Authorization**: CLINIC_ADMIN, SUPER_ADMIN only

**Response** (200):
```json
{
  "data": {
    "sessionsThisWeek": 24,
    "sessionsLastWeek": 20,
    "percentageChange": 20,
    "activeClients": 45,
    "newClientsThisMonth": 3,
    "revenue": null
  }
}
```

**Note**: `revenue` is null until billing feature 011 is implemented.

## Authorization Matrix

| Endpoint | SUPER_ADMIN | CLINIC_ADMIN | PROFESSIONAL | RECEPTIONIST | CLIENT |
|---|---|---|---|---|---|
| GET /dashboard | yes (all practices) | yes (practice) | yes (own data) | yes (practice) | yes (own data) |
| GET /dashboard/stats | yes (all practices) | yes (practice) | no | no | no |

## Widget Role Mapping

| Widget | SUPER_ADMIN | CLINIC_ADMIN | PROFESSIONAL | RECEPTIONIST | CLIENT |
|---|---|---|---|---|---|
| Today's Sessions | ✅ (all practices) | ✅ (practice) | ✅ (own) | ✅ (practice) | ❌ |
| Pending Approvals | ✅ (all) | ✅ (practice) | ✅ (own) | ❌ | ❌ |
| Active Clients | ✅ (all) | ✅ (practice) | ✅ (own) | ❌ | ❌ |
| Statistics | ✅ (all) | ✅ (practice) | ❌ | ❌ | ❌ |
| Upcoming Sessions | ❌ | ❌ | ❌ | ❌ | ✅ |
| Recent History | ❌ | ❌ | ❌ | ❌ | ✅ |
| Quick Actions | ✅ | ✅ | ✅ | ✅ | ✅ |
| Super Admin Aggregate | ✅ (cross-practice) | ❌ | ❌ | ❌ | ❌ |

## Complexity Tracking

> No constitution violations requiring justification.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| (none) | - | - |

## Implementation Order

1. Dashboard service (aggregation queries per role)
2. Dashboard API routes (GET /dashboard, GET /dashboard/stats)
3. Base dashboard layout and shared components
4. Widget components (today-sessions, pending-approvals, active-clients, upcoming-sessions, recent-history, statistics, quick-actions)
5. Role-specific dashboard pages
6. Skeleton loaders
7. Unit tests
8. E2E plan markdown