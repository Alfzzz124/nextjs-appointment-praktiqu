# Memory Synthesis

feature: 003-service-mgmt
status: draft
hard_conflicts: 0
soft_conflicts: 0

## Current Scope

- Feature: Service Management
- Core entity: Service (name, price, duration, type, status)
- Key flows: create, update, list, search, deactivate/reactivate, delete
- Integration: ProfessionalManagement (002) via ProfessionalServiceAssignment; PracticeManagement (013) via practiceId FK; PublicBooking (006) via /public endpoint

## Relevant Project Context

- Next.js 14+ App Router + TypeScript strict mode
- MySQL (WordPress DB) + Prisma ORM
- NextAuth.js v5 for auth management
- Constitution: TDD, trunk-based, E2E plans in markdown
- Feature 002 Professional Management: slot generation reads Service.durationMinutes

## Relevant Decisions

- [none yet - migrate from durable memory after implementation]

## Active Architecture Constraints

- Design-First: UI must follow Stitch designs
- All service endpoints must pass CI/CD (lint, type check, tests, build)
- TDD: Unit tests before implementation
- Single practice per service in v1 (aligned with professional-practice from 002)

## Accepted Deviations

### 2026-06-02 - Service duration values
Duration is restricted to 30/60/90/120/150/180 minutes to match psychology practice session standards. This drives slot generation in feature 002.

### 2026-06-02 - Soft-delete only with booking history protection
Physical deletion is blocked for services with bookings or professional assignments. Only INACTIVE services with zero dependencies can be deleted.

## Relevant Security Constraints

- RBAC: Clinic Admin manages services within their practice; Super Admin cross-practice; Professional/Receptionist read-only
- AUDIT logging mandatory for all state changes
- JWT Bearer authentication on all non-public endpoints
- Public /services/public endpoint requires no auth

## Conflict Warnings

- [none]

## Watchpoints (Implementation)

- durationMinutes change must warn admin about existing bookings but not block the change
- Physical deletion must check both ProfessionalServiceAssignment and session records before allowing
- Service name uniqueness is per practice, not global
- Public endpoint must return ACTIVE services only, no auth required
- price stored as integer (smallest currency unit) - display formatting is UI layer concern

## Retrieval Notes

- Index entries considered: docs/memory/INDEX.md, docs/memory/PROJECT_CONTEXT.md, docs/memory/architecture/ARCHITECTURE.md
- Memory layers active: Constitution (.specify/memory/), Project Context (docs/memory/PROJECT_CONTEXT.md), Feature 002 memory-synthesis
- Budget: within limit (synthesis is ~450 words)
