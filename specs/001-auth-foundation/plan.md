# Implementation Plan: 001-auth-foundation

**Branch**: `feat/001-auth-foundation` | **Date**: 2026-05-31 | **Spec**: specs/001-auth-foundation/spec.md

## Summary

Implement authentication foundation for PraktiQu using NextAuth.js v5, with WordPress as the credential source of truth. Users authenticate via WordPress, then Next.js issues its own JWT tokens for application access. Supports five canonical PraktiQU roles aligned with FR-008: SUPER_ADMIN, CLINIC_ADMIN, PROFESSIONAL, RECEPTIONIST, CLIENT. WordPress role slugs are mapped to PraktiQU canonical roles via `src/lib/auth/role-mapping.ts` (see `docs/architecture/role-taxonomy.md` for the full source of truth).

## Technical Context

**Language/Version**: TypeScript (strict mode)

**Primary Dependencies**: Next.js 14+, NextAuth.js v5, Prisma, JWT (jose)

**Storage**: MySQL (WordPress schema) + Prisma ORM

**Testing**: Vitest, @vercel/agent-browser for E2E

**Target Platform**: Vercel (Next.js deployment)

**Project Type**: Web application (backend API + frontend)

**Performance Goals**: Response time < 200ms for auth endpoints

**Constraints**: Progressive rate limiting on auth endpoints; JWT required for all protected routes

**Scale/Scope**: Support for 1000 concurrent authenticated users per SC-007; initial load test (T060) validates at this level.

## Constitution Check

- [x] **Design-First**: Reviewed `stitch_praktiqu_clinic_dashboard/` for login, OAuth button, password reset screens; all UI tasks (T013, T028, T035) reference design files.
- [x] **TDD**: All user stories (US1-US4) schedule failing tests before implementation in same or earlier phase; US3/US4 test tasks have `[P]` markers removed to enforce test-first ordering.
- [x] **Conventional Commits**: All commits will use `<type>(auth):` scope; breaking changes flagged with `!`.
- [x] **E2E Critical Path**: Login + logout + Google sign-in covered with E2E plans per Principle IV critical path list.
- [x] **Full CI/CD**: Lint, type-check, Vitest (80% coverage gate), build, and E2E plan checks all required for merge per Principle V.

## Project Structure

### Documentation Source Structure

```
specs/001-auth-foundation/
├── spec.md              # Feature specification (already exists)
├── plan.md              # This file
├── memory.md            # Feature memory
├── memory-synthesis.md  # Synthesized memory for retrieval
└── checklists/          # Implementation checklists
```

### Source Code Structure

```
src/app/api/v1/auth/
├── route.ts             # POST login, logout, refresh, register
├── endpoint/
│   ├── login.ts         # Login handler
│   ├── logout.ts       # Logout handler  
│   └── refresh.ts      # Token refresh handler
├── services/
│   └── auth.service.ts # Business logic for auth
├── lib/
│   ├── jwt.ts           # JWT utilities
│   └── wp-auth.ts      # WordPress auth integration
│
src/app/login/           # Login page
src/app/register/        # Registration page
src/components/auth/    # Auth UI components

prisma/schema.prisma    # User model additions
```

## API Endpoints (to be implemented)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/v1/auth/login | Login with credentials |
| POST | /api/v1/auth/logout | Logout and invalidate tokens |
| POST | /api/v1/auth/refresh | Refresh access token |
| POST | /api/v1/auth/register | Self-registration (Client role, per FR-022) |
| POST | /api/v1/auth/forgot-password | Request password reset |
| POST | /api/v1/auth/reset-password | Set new password via reset token |
| POST | /api/v1/auth/change-password | Authenticated password change (per FR-006) |
| GET  | /api/v1/auth/me | Get current user profile (per FR-018; reads JWT claims) |
| PATCH | /api/v1/admin/users/:id/role | Admin role change (per FR-020, SUPER_ADMIN only) |
| GET  | /api/v1/admin/audit | Paginated audit log (per FR-021, SUPER_ADMIN only) |

## Implementation Phases

See `tasks.md` for detailed task breakdown.
