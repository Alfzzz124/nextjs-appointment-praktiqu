# PraktiQU Constitution

**Project**: PraktiQU - Next.js Psychology Practice Management System

---

## Core Principles

### I. Psychology-First Terminology

**NON-NEGOTIABLE RULES:**

- All code, docs, and UI MUST use psychology terminology:
  - `Doctor` → `Professional` or specific type (`Psikolog Klinis`, `Psikiater`)
  - `Patient` → `Client`
  - `Appointment` → `Session`
  - `Prescription` → `Intervention Plan` (retained for recommendations/activities)
  - `Encounter` → `Session Notes`
- Database schemas MUST reflect psychology entities
- Error messages and logs MUST use psychology terms

**RATIONALE**: Consistency prevents confusion for psychology practitioners who are the primary users.

---

### II. Design-Driven Development

**NON-NEGOTIABLE RULES:**

- All UI implementations MUST be based on approved Stitch designs from `/stitch_praktiqu_clinic_dashboard/`
- Design files serve as source of truth for:
  - Component structure and hierarchy
  - Color palette (Primary: #5046E5, etc.)
  - Typography (Inter font family)
  - Spacing and layout patterns
  - Status colors and states
- Before coding, developer MUST review relevant design files in Stitch folder
- Any deviation from design MUST be justified and documented

**RATIONALE**: Designs created in Stitch represent approved UX decisions; deviation wastes review effort.

---

### III. Session Booking Flow Integrity

**NON-NEGOTIABLE RULES:**

- Session booking flow MUST follow this exact sequence:
  ```
  CLIENT_BOOK → PENDING → PROFESSIONAL_APPROVE → BOOKED → CHECK_IN → CHECK_OUT → COMPLETED
                     ↓
                 REJECTED/CANCELLED
  ```
- Professional MUST approve or reject PENDING sessions before BOOKED status
- Client CANNOT be checked-in without APPROVED/BOOKED status
- Session duration MUST respect service type:
  - Konseling Individual: 60 min
  - Konseling Kelompok: 90 min
  - Asesmen Psikologis: 120 min
- No double-booking for same professional at same time slot

**RATIONALE**: This workflow ensures professional oversight of all client sessions, a legal/ethical requirement for psychology practice.

---

### IV. Role-Based Access Control (RBAC)

**NON-NEGOTIABLE RULES:**

- Five roles with strict access boundaries:
  | Role | Access Scope |
  |------|--------------|
  | Super Admin | All modules, all practices |
  | Clinic Admin | Own practice only |
  | Professional | Own clients, own sessions |
  | Receptionist | Practice sessions, client registration |
  | Client | Own records, own bookings |
- Data isolation MUST be enforced at database query level
- API endpoints MUST validate role permissions before returning data
- UI MUST hide inaccessible features based on role

**RATIONALE**: Psychology practice requires strict confidentiality; professionals see only their clients.

---

### V. TDD with Critical-Path E2E

**NON-NEGOTIABLE RULES:**

**Unit/Integration Testing (TDD):**
- Tests MUST be written BEFORE implementation
- Red-Green-Refactor cycle MUST be followed:
1. Write failing test
  2. Verify test fails with correct error
  3. Write minimal implementation
  4. Verify test passes
  5. Refactor if needed
- Test coverage target: 80% for core modules
- Required test types:
  - API endpoint tests (happy path + error cases)
  - Database model tests (validation rules)
  - Service logic tests (booking flow, RBAC)

**E2E Testing (Post-Implementation):**
- E2E tests MUST use `@vercel/agent-browser`
- Test plan document required BEFORE coding E2E tests
- Critical paths requiring E2E:
  - Public booking flow (all 4 steps)
  - Session approval workflow
  - Client self-registration
  - Authentication (login/logout)
- E2E results MUST be documented in `/docs/testing/e2e-results.md`

**RATIONALE**: TDD ensures correctness; E2E validates user journeys work end-to-end.

---

### VI. Trunk-Based Development

**NON-NEGOTIABLE RULES:**

- All work happens in short-lived feature branches
- Branch naming: `feat/###-short-description` (e.g., `feat/001-auth-login`)
- Branch lifespan: MAX 3 days
- Commit early and often to feature branch
- Merge to `main` via PR (no direct push)
- Delete branch after merge
- Feature flags for incomplete but mergeable work

**RATIONALE**: Trunk-based enables fast iteration and reduces merge conflicts.

---

### VII. Conventional Commits

**NON-NEGOTIABLE RULES:**

- Commit format: `<type>(<scope>): <description>`
- Types:
  - `feat`: New feature
  - `fix`: Bug fix
  - `docs`: Documentation
  - `style`: Formatting (no code change)
  - `refactor`: Code refactoring
  - `test`: Adding tests
  - `chore`: Maintenance tasks
  - `spec`: Spec/requirement docs
- Scope: module affected (e.g., `auth`, `session`, `client`, `ui`)
- Description: imperative mood, no period, max 72 chars
- Breaking changes: `!` after type (e.g., `feat(auth)!: remove legacy login`)

**EXAMPLES:**
```
feat(session): add approval workflow for pending sessions
fix(client): validate unique client ID format
docs(spec): add BR-05 session business rules
test(auth): add login failure test cases
```

**RATIONALE**: Convention enables automated changelog and clear commit history.

---

### VIII. Full CI/CD Pipeline

**NON-NEGOTIABLE RULES:**

Every PR MUST pass:
1. **Lint**: ESLint + Prettier check
2. **Type Check**: TypeScript strict mode
3. **Unit Tests**: `npm test` (Vitest)
4. **Build**: `npm run build` (Next.js production build)
5. **E2E Tests** (for affected paths): `npm run test:e2e`

PR CANNOT be merged if any check fails.

**CI Output Requirements:**
- Test coverage report (must meet 80% threshold)
- Build artifact for verification
- E2E test report with screenshots/videos/traces

**RATIONALE**: Full CI prevents regressions and ensures code quality at every merge.

---

## Technology Stack

This section defines the canonical technology choices; deviations require constitutional amendment.

| Layer | Technology | Justification |
|-------|------------|---------------|
| Framework | Next.js 14+ (App Router) | SSR, API routes, React 18 |
| Language | TypeScript (strict mode) | Type safety, better DX |
| Styling | Tailwind CSS + Inter font | Consistent design system |
| Database | PostgreSQL + Prisma | Reliable, type-safe ORM |
| Auth | NextAuth.js v5 | Session-based, RBAC support |
| State | React Server Components + Zustand | Minimal client state |
| Testing | Vitest (unit) + agent-browser (E2E) | TDD + E2E coverage |
| Deployment | Vercel | Next.js native, preview deployments |

---

## API Standards

### REST API Conventions

**Base URL Structure:**
```
/api/v1/{resource}
/api/v1/{resource}/{id}
/api/v1/{resource}/{id}/{sub-resource}
```

**HTTP Methods:**
```
GET    /api/v1/sessions          - List sessions (paginated)
POST /api/v1/sessions          - Create session
GET    /api/v1/sessions/:id      - Get session by ID
PATCH  /api/v1/sessions/:id      - Update session (partial)
DELETE /api/v1/sessions/:id      - Delete session
```

**Response Format:**
```json
{
  "data": { ... },           // Single resource
  "pagination": {            // List response only
    "currentPage": 1,
    "totalPages": 5,
    "totalItems": 100,
    "itemsPerPage": 20
  }
}
```

**Error Format (RFC 7807 Problem Details):**
```json
{
  "type": "/errors/resource-not-found",
  "title": "Resource Not Found",
  "status": 404,
  "detail": "Session with ID xxx does not exist",
  "instance": "/api/v1/sessions/xxx"
}
```

**Pagination:**
- Query params: `?page=1&limit=20`
- Response includes pagination metadata
- Default limit: 20, max limit: 100

**Authentication:**
- All protected endpoints require JWT Bearer token
- Header: `Authorization: Bearer <jwt_token>`
- Token contains: `userId`, `role`, `exp`

**Authorization:**
- Service-level permission checks (not middleware-level)
- Auth validates JWT; service validates permissions
- Each request includes authenticated user context

**Rate Limiting:**
- Global rate limiting: 100 requests/minute per user
- Endpoint-specific limits deferred until usage patterns observed
- Response headers: `X-RateLimit-*`

**OpenAPI Documentation:**
- Full OpenAPI 3.0 specification
- Swagger UI hosted at `/docs/api`
- Auto-generated from route decorators/annotations

---

## E2E Testing Standards

### Test Structure (Hybrid)

```
/tests/e2e
  /flows/                    # User journeys
    client-booking-flow.spec.ts
    session-approval-flow.spec.ts
    client-registration.spec.ts
    authentication.spec.ts
  /critical-pages/          # Important pages
    dashboard-admin.spec.ts
    dashboard-professional.spec.ts
    client-profile.spec.ts
    session-list.spec.ts
```

### Test Data Management

- **Primary Strategy**: Deterministic database seed
- Seed script runs before each E2E test suite
- Provides repeatable, debuggable, stable tests
- Factories may be introduced later for special scenarios

**Seed Command:**
```bash
npm run test:e2e:seed    # Reset DB to known state
npm run test:e2e          # Run tests
```

### Test Execution

- **Initial**: Full E2E suite on every PR
- **Future Evolution**: Smart CI (affected tests only) + nightly full suite
- Maximum confidence with manageable maintenance

### Test Reporting

- **Format**: Playwright HTML reports (built-in)
- **Artifacts**: Screenshots, videos, traces
- **Location**: `/reports/e2e/index.html`
- **CI Artifacts**: Upload to GitHub Actions artifacts (future)

---

## Logging& Monitoring Standards

### Log Levels

| Level | Category | Usage |
|-------|----------|-------|
| ERROR | System | Unrecoverable failures, exceptions |
| WARN | System | Recoverable issues, degraded functionality |
| INFO | Business | Important business events, state changes |
| DEBUG | Development | Detailed debugging (dev/staging only) |
| TRACE | Development | Function-level verbose (dev/staging only) |
| AUDIT | Compliance | Security events, data access, consent changes |
| PERF | Performance | API response times, query durations |

### Log Storage

- **Primary**: Database-backed structured logging
- **Rationale**: Portable across all deployment options (Vercel, VPS, Shared Hosting)
- **Future**: Can migrate to CloudWatch, ELK, OpenSearch without changing business code

**Log Table Schema:**
```sql
application_logs (
  id,
  level,           -- ERROR, WARN, INFO, DEBUG, TRACE, AUDIT, PERF
  message,
  context,         -- JSON (userId, requestId, etc.)
  source,          -- 'api', 'service', 'worker', 'cron'
  created_at,
  metadata         -- JSON (stack trace, request details)
)
```

### Log Retention

| Level | Retention | Storage |
|-------|-----------|---------|
| DEBUG, TRACE | 7 days | Development only |
| INFO, WARN, ERROR | 30 days | Standard |
| AUDIT | 90 days | Compliance |
| PERF | 7 days | Aggregated metrics |

### Application Performance Monitoring (APM)

- **Status**: Deferred until deployment architecture is clearer
- **Future Requirement**: OpenTelemetry-compatible, vendor-agnostic
- APM integration MUST NOT be tightly coupled to specific vendor

### Error Tracking

- **Current**: Database-backed error tracking
- **Alerts**: Critical errors trigger email notifications
- **Dashboard**: Manual review via admin interface
- **Future**: Extensible to Slack, Discord, Sentry, or webhook integrations

### Health Check Endpoint

**Endpoint**: `GET /api/health`

**Response:**
```json
{
  "status": "healthy",      // healthy | degraded | unhealthy
  "timestamp": "2026-05-30T10:00:00Z",
  "version": "1.0.0",
  "checks": {
    "database": "healthy",
    "auth": "healthy",
    "api": "healthy"
  }
}
```

**Requirements:**
- MUST NOT expose secrets
- MUST verify database connectivity
- Status values: `healthy`, `degraded`, `unhealthy`
- Future K8s liveness/readiness probes MUST be backward-compatible

---

## Data Conventions

### Schema Naming
- Table names: `snake_case` (e.g., `session_notes`, `intervention_plan`)
- Column names: `snake_case` (e.g., `client_id`, `session_date`)
- Foreign keys: `<table>_id` pattern (e.g., `professional_id`)

### Status Enums
```typescript
SessionStatus: 'PENDING' | 'APPROVED' | 'BOOKED' | 'CHECK_IN' | 'CHECK_OUT' | 'COMPLETED' | 'REJECTED' | 'CANCELLED'
ConsentStatus: 'PENDING' | 'SIGNED' | 'WITHDRAWN'
UserRole: 'SUPER_ADMIN' | 'CLINIC_ADMIN' | 'PROFESSIONAL' | 'RECEPTIONIST' | 'CLIENT'
```

### Unique IDs
- Client ID: `KLN-YYYY-NNNN` format
- Session Booking: `SBK-YYYY-NNNN` format
- Professional SIP/SIK: As provided (no standardization enforced)

---

## Project Structure

```
praktiQU/
├── src/
│   ├── app/                    # Next.js App Router pages
│   ├── components/             # Shared UI components
│   │   ├── ui/               # Base components (Button, Input, etc.)
│   │   ├── session/          # Session-specific components
│   │   ├── client/          # Client-specific components
│   │   └── layout/          # Layout components (Sidebar, Header)
│   ├── lib/                  # Utilities and helpers
│   ├── services/             # Business logic
│   ├── api/                  # API route handlers
│   ├── hooks/                # Custom React hooks
│   └── types/                # TypeScript types
├── prisma/
│   ├── schema.prisma         # Database schema
│   └── migrations/           # Database migrations
├── tests/
│   ├── unit/                 # Vitest unit tests
│   ├── integration/          # API integration tests
│   └── e2e/                 # agent-browser E2E tests
├── stitch_praktiqu_clinic_dashboard/  # Stitch design files
├── docs/                     # Project documentation
└── .specify/               # Speckit constitution files
```

---

## Development Workflow

### Feature Implementation Flow

1. **Spec Review**: Read related spec in `/specs/###-feature/spec.md`
2. **Design Review**: Check Stitch designs in `/stitch_praktiqu_clinic_dashboard/`
3. **Write Tests**: Write failing tests first (TDD)
4. **Implement**: Write minimal code to pass tests
5. **Refactor**: Improve code while tests pass
6. **Create PR**: Open PR with description of changes
7. **CI Pass**: Ensure all checks pass
8. **Code Review**: Get approval from team
9. **Merge**: Squash and merge to main

### Definition of Done

A feature is DONE when:
- [ ] All acceptance criteria from spec are met
- [ ] All unit/integration tests pass (80%+ coverage)
- [ ] All E2E tests pass (for affected paths)
- [ ] Design matches Stitch mockups
- [ ] No TypeScript errors
- [ ] No linting errors
- [ ] PR reviewed and approved
- [ ] Documentation updated

---

## Governance

### Amendment Procedure

1. Propose change in GitHub Discussion with rationale
2. Team reviews (minimum 3 days comment period)
3. If approved, update constitution with new version
4. Propagate changes to dependent templates

### Version Policy

- **MAJOR** (X.0.0): Backward-incompatible changes (e.g., removing a role, changing auth flow)
- **MINOR** (x.Y.0): New principles added or materially expanded guidance
- **PATCH** (x.y.Z): Clarifications, wording fixes, non-semantic refinements

### Compliance Verification

- All PRs MUST include Constitution Check section
- Reviewer MUST verify compliance with all 8 principles
- Non-compliance MUST be justified in PR description

---

**Version**: 1.0.0 | **Ratified**: 2026-05-30 | **Last Amended**: 2026-05-30
