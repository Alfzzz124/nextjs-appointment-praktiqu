# Memory Synthesis

feature: 006-dashboard
status: draft
hard_conflicts: 0
soft_conflicts: 0

## Current Scope

- Feature: Dashboard
- Read-only aggregation from Session (005), Client (004), Professional (002), Service (003)
- No new entities or migrations
- Role-specific widgets per user role
- Widgets: Today's Sessions, Pending Approvals, Active Clients, Statistics, Upcoming Sessions, Recent History, Quick Actions

## Relevant Project Context

- Next.js 14+ App Router + TypeScript strict mode
- MySQL (WordPress DB) + Prisma ORM
- NextAuth.js v5 for auth management
- Constitution: TDD, trunk-based, E2E plans in markdown
- Features 002-005 already define the entities dashboard reads from

## Relevant Decisions

- [none yet - migrate from durable memory after implementation]

## Active Architecture Constraints

- Design-First: UI must follow Stitch designs
- Dashboard loads aggregated data on page load — no real-time updates for MVP
- All statistics computed server-side for performance
- Fixed dashboard layout per role — no widget customization for MVP

## Accepted Deviations

### 2026-06-02 - No new entities
Dashboard reads from existing Session, Client, Professional, Service entities. No migrations or new tables required.

### 2026-06-02 - Revenue placeholder
Revenue widget shows null/placeholder until billing feature (011) is implemented. No broken UI.

## Relevant Security Constraints

- RBAC: Role determines which widgets and data are visible
- Data scoping: Professional sees own data only; Receptionist/Admin see practice data; Super Admin sees all
- JWT Bearer authentication required on all dashboard endpoints

## Conflict Warnings

- [none]

## Watchpoints (Implementation)

- All aggregation queries must be scoped by role — no data leakage between roles
- Super Admin dashboard aggregates across all practices — requires additional aggregation layer
- Dashboard loads on page navigation — no page refresh required
- Skeleton loaders must show while data fetches — no blank screens
- Placeholder content for unimplemented features (revenue) — no error states

## Retrieval Notes

- Index entries considered: docs/memory/INDEX.md, docs/memory/PROJECT_CONTEXT.md, docs/memory/architecture/ARCHITECTURE.md
- Memory layers active: Constitution (.specify/memory/), Project Context (docs/memory/PROJECT_CONTEXT.md), Features 002-005 memory-syntheses
- Budget: within limit (synthesis is ~400 words)