# Memory Synthesis

feature: 004-client-mgmt
status: draft
hard_conflicts: 0
soft_conflicts: 0

## Current Scope

- Feature: Client Management
- Core entity: Client (profile, unique ID, demographics, status)
- Key flows: staff registration, self-service profile, list/search, session history, status lifecycle, progress overview
- Integration: WordPress user (userId link), Practice (practiceId FK), Session (005) for history, Session Notes (008) for progress, Intervention Plan (009) for progress

## Relevant Project Context

- Next.js 14+ App Router + TypeScript strict mode
- MySQL (WordPress DB) + Prisma ORM
- NextAuth.js v5 for auth management
- Constitution: TDD, trunk-based, E2E plans in markdown
- Features 002, 003 already implemented pattern for professional/service

## Relevant Decisions

- [none yet - migrate from durable memory after implementation]

## Active Architecture Constraints

- Design-First: UI must follow Stitch designs
- All client endpoints must pass CI/CD (lint, type check, tests, build)
- TDD: Unit tests before implementation
- WordPress as user identity provider (userId link, one-to-one)
- Single practice per client in v1 (aligned with professional-practice from 002)

## Accepted Deviations

### 2026-06-02 - Client ID format
Unique client ID is per-practice per-year in format "CLT-{year}-{sequential}". Format enables easy lookup and practice-specific identification.

### 2026-06-02 - Client status lifecycle
Three states: ACTIVE (can book), INACTIVE (paused), ARCHIVED (departed/erased). INACTIVE and ARCHIVED clients cannot initiate new bookings.

## Relevant Security Constraints

- RBAC: Super Admin all-access; Clinic Admin practice-scoped; Receptionist read-only; Professional sees only clients with sessions; Client sees self only
- AUDIT logging mandatory for all status changes and profile updates
- JWT Bearer authentication on all non-public endpoints
- Professional access rule enforced at service layer (BR-10.01: "Professionals see own clients only")

## Conflict Warnings

- [none]

## Watchpoints (Implementation)

- Unique client ID generation must be atomic (race condition prevention with transaction or advisory lock)
- Professional access rule (BR-10.01) must be enforced at service layer — NOT at DB level, since access depends on session history
- INACTIVE/ARCHIVED clients must be rejected by booking API (feature 005) immediately on status change
- Email uniqueness is per-practice among ACTIVE clients only (archived clients don't block new registrations)
- Mobile number is NOT unique — search returns all matches with that prefix
- Progress overview aggregates data from Session Notes (008) and Intervention Plan (009) — graceful degradation if those features not yet implemented

## Retrieval Notes

- Index entries considered: docs/memory/INDEX.md, docs/memory/PROJECT_CONTEXT.md, docs/memory/architecture/ARCHITECTURE.md
- Memory layers active: Constitution (.specify/memory/), Project Context (docs/memory/PROJECT_CONTEXT.md), Features 002 and 003 memory-syntheses
- Budget: within limit (synthesis is ~500 words)