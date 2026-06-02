# Memory Synthesis

feature: 007-public-booking
status: draft
hard_conflicts: 0
soft_conflicts: 0

## Current Scope

- Feature: Public Booking Portal
- 5-step wizard: Professional → Service → Date/Time → Client Info/Login → Confirmation
- Consumes slot API (002), session API (005), professional service list (002)
- Creates WordPress user + client profile inline for new visitors
- Generates PENDING session on confirmation

## Relevant Project Context

- Next.js 14+ App Router + TypeScript strict mode
- MySQL (WordPress DB) + Prisma ORM
- NextAuth.js v5 for auth management
- Constitution: TDD, trunk-based, E2E plans in markdown

## Active Architecture Constraints

- Design-First: UI must follow Stitch designs
- All endpoints must pass CI/CD (lint, type check, tests, build)
- TDD: Unit tests before implementation
- Wizard is public until Step 4 confirmation

## Accepted Deviations

### 2026-06-02 - Slot hold uses in-memory storage
Slot hold (15-min TTL) uses in-memory storage for MVP. Redis can be added later without breaking the contract.

### 2026-06-02 - Email deferred to feature 012
Confirmation email is logged for MVP. Feature 012 provides the actual email sending.

### 2026-06-02 - Practice address deferred to feature 013
Confirmation shows practice address placeholder until feature 013 provides practice details.

## Relevant Security Constraints

- Wizard is public (no auth on Steps 1-3)
- Session POST requires form data validation
- Slot hold prevents double-booking race conditions
- AUDIT logging on session creation

## Conflict Warnings

- [none]

## Watchpoints (Implementation)

- Slot hold TTL must be enforced server-side — not just client-side countdown
- Inline registration must provision WordPress user + client profile atomically
- Wizard URL state must be preserved on browser back navigation
- 409 on slot unavailability must show clear re-selection prompt

## Retrieval Notes

- Index entries considered: docs/memory/INDEX.md, docs/memory/PROJECT_CONTEXT.md
- Budget: within limit (synthesis is ~300 words)