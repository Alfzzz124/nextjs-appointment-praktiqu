# Memory Synthesis

feature: 001-auth-foundation
status: draft
hard_conflicts: 0
soft_conflicts: 0

<!-- Keep every section below, even when empty. Use "- [none]" for empty sections. -->
<!-- Keep this file within retrieval.max_synthesis_words, default 900 words. -->

## Current Scope

- Feature: Authentication & Authorization Foundation
- Auth Strategy: WordPress credential verification → Next.js JWT issuance
- Roles: Admin, Professional, Client
- Security: Progressive rate limiting (5 failed → 30s delay, 10 failed → 5min lockout)

## Relevant Project Context

- Next.js 14+ App Router + TypeScript strict mode
- MySQL (WordPress DB) + Prisma ORM
- NextAuth.js v5 for auth management

## Relevant Decisions

- [none yet - migrate from durable memory after implementation]

## Active Architecture Constraints

- Design-First: UI must follow Stitch designs
- All auth endpoints must pass CI/CD (lint, type check, tests, build)
- TDD: Unit tests before implementation

## Accepted Deviations

### 2026-05-31 - WordPress Auth Integration
WordPress is the source of truth for credential verification. Next.js authenticates through a dedicated WordPress endpoint rather than direct hash verification. This reduces coupling with WordPress internals.

## Relevant Security Constraints

- JWT access token: 15-minute expiry
- JWT refresh token: 7-day expiry
- Password reset link: 30-minute expiry
- Progressive rate limiting on auth endpoints

## Related Historical Lessons

- [none yet]

## Conflict Warnings

- [none]

## Retrieval Notes

- Index entries considered: docs/memory/INDEX.md
- Memory layers active: Constitution (.specify/memory/), Project Context (docs/memory/PROJECT_CONTEXT.md)
- Budget: within limit (synthesis is ~450 words)
