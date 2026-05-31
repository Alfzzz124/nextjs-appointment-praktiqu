# PraktiQU Constitution

**Project**: PraktiQU - Next.js Psychology Practice Management System

> **Note**: Product requirements (terminology, session workflow, RBAC, business rules) are defined in `/docs/PRD-index.md`. This constitution covers development conventions only.

---

## Core Principles

### I. Design-Driven Development

All UI implementations MUST be based on approved Stitch designs from `/stitch_praktiqu_clinic_dashboard/`.

Design files serve as source of truth for component structure, color palette, typography, spacing, and status states. Before coding, review relevant design files. Deviation from design MUST be justified and documented.

---

### II. Trunk-Based Development

All work happens in short-lived feature branches:
- Branch naming: `feat/###-short-description` (e.g., `feat/001-auth-login`)
- Branch lifespan: MAX 3 days
- Merge to `main` via PR (no direct push)
- Delete branch after merge

---

### III. Conventional Commits

Commit format: `<type>(<scope>): <description>`

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`, `spec`

Breaking changes: `!` after type (e.g., `feat(auth)!: remove legacy login`)

---

### IV. TDD with E2E Validation

**Unit/Integration Testing:**
- Tests written BEFORE implementation
- Red-Green-Refactor cycle: Write failing test → Verify fails → Implement → Verify passes → Refactor
- Coverage target: 80% for core modules

**E2E Testing (Post-Implementation):**
- Uses `@vercel/agent-browser`
- Test plan required BEFORE coding E2E tests
- Critical paths: Public booking flow, session approval, client registration, authentication
- Results documented in `/docs/testing/e2e-results.md`

---

### V. Full CI/CD Pipeline

Every PR MUST pass:
1. **Lint**: ESLint + Prettier check
2. **Type Check**: TypeScript strict mode
3. **Unit Tests**: `npm test` (Vitest)
4. **Build**: `npm run build` (Next.js production build)
5. **E2E Tests** (for affected paths): `npm run test:e2e`

PR CANNOT be merged if any check fails.

---

## API Standards

**Base URL**: `/api/v1/{resource}`

**HTTP Methods**:
```
GET    /api/v1/sessions      - List (paginated)
POST   /api/v1/sessions       - Create
GET    /api/v1/sessions/:id   - Get by ID
PATCH  /api/v1/sessions/:id   - Update (partial)
DELETE /api/v1/sessions/:id   - Delete
```

**Response Format**:
```json
{
  "data": { ... },
  "pagination": {
    "currentPage": 1,
    "totalPages": 5,
    "totalItems": 100,
    "itemsPerPage": 20
  }
}
```

**Error Format (RFC 7807)**:
```json
{
  "type": "/errors/resource-not-found",
  "title": "Resource Not Found",
  "status": 404,
  "detail": "Session with ID xxx does not exist",
  "instance": "/api/v1/sessions/xxx"
}
```

**Pagination**: Query params `?page=1&limit=20`, default limit 20, max 100

**Authentication**: JWT Bearer token in `Authorization: Bearer <token>` header

**Authorization**: Service-level permission checks (auth validates JWT, service validates permissions)

**Rate Limiting**: Global 100 requests/minute per user, endpoint-specific deferred

**Documentation**: OpenAPI 3.0 spec, Swagger UI at `/docs/api`

---

## E2E Testing Standards

**Test Structure (Hybrid)**:
```
/tests/e2e
  /flows/              # User journeys
    client-booking-flow.spec.ts
    session-approval-flow.spec.ts
  /critical-pages/    # Important pages
    dashboard-admin.spec.ts
```

**Test Data**: Deterministic database seed before each test run
```bash
npm run test:e2e:seed    # Reset DB
npm run test:e2e         # Run tests
```

**Execution**: Full E2E suite on every PR (evolve to smart CI + nightly later)

**Reporting**: Playwright HTML reports with screenshots/videos/traces

---

## Logging & Monitoring

**Log Levels**: ERROR, WARN, INFO, DEBUG, TRACE, AUDIT, PERF

**Storage**: Database-backed structured logging (portable across deployment options)

**Retention**:
| Level | Retention |
|-------|-----------|
| DEBUG, TRACE | 7 days |
| INFO, WARN, ERROR | 30 days |
| AUDIT | 90 days |
| PERF | 7 days (aggregated) |

**APM**: Deferred until deployment architecture is clearer. Future integration MUST be OpenTelemetry-compatible.

**Error Tracking**: Database-backed with email alerts for critical errors

**Health Check**: `GET /api/health` returns status, version, and dependency checks

```json
{
  "status": "healthy",
  "timestamp": "2026-05-30T10:00:00Z",
  "version": "1.0.0",
  "checks": { "database": "healthy", "auth": "healthy" }
}
```

---

## Project Structure

```
praktiQU/
├── src/
│   ├── app/              # Next.js App Router
│   ├── components/      # UI components (ui/, session/, client/, layout/)
│   ├── lib/              # Utilities
│   ├── services/         # Business logic
│   ├── api/              # API route handlers
│   ├── hooks/            # Custom React hooks
│   └── types/            # TypeScript types
├── prisma/               # Database schema & migrations
├── tests/
│   ├── unit/             # Vitest unit tests
│   ├── integration/     # API integration tests
│   └── e2e/              # agent-browser E2E tests
├── stitch_praktiqu_clinic_dashboard/  # Stitch design files
├── docs/                 # Documentation
└── .specify/             # Speckit constitution
```

---

## Technology Stack

| Layer | Technology |
|-------|------------|
| Framework | Next.js 14+ (App Router) |
| Language | TypeScript (strict mode) |
| Styling | Tailwind CSS + Inter font |
| Database | PostgreSQL + Prisma |
| Auth | NextAuth.js v5 |
| State | React Server Components + Zustand |
| Testing | Vitest + agent-browser |
| Deployment | Vercel |

---

## Development Workflow

1. **Spec Review**: Read related spec in `/specs/###-feature/spec.md`
2. **Design Review**: Check Stitch designs
3. **Write Tests**: Write failing tests first (TDD)
4. **Implement**: Write minimal code to pass tests
5. **Refactor**: Improve while tests pass
6. **Create PR**: Open with description, ensure CI passes
7. **Code Review**: Get approval
8. **Merge**: Squash and merge to main

### Definition of Done

- [ ] Acceptance criteria from spec met
- [ ] Unit/integration tests pass (80%+ coverage)
- [ ] E2E tests pass (for affected paths)
- [ ] Design matches Stitch mockups
- [ ] No TypeScript/linting errors
- [ ] PR reviewed and approved

---

## Governance

### Amendment Procedure

1. Propose change with rationale
2. Team reviews (minimum 3 days)
3. If approved, update constitution with new version
4. Propagate to dependent templates

### Version Policy

- **MAJOR** (X.0.0): Backward-incompatible changes
- **MINOR** (x.Y.0): New principles or expanded guidance
- **PATCH** (x.y.Z): Clarifications, wording fixes

### Compliance

- All PRs include Constitution Check section
- Reviewer verifies compliance
- Non-compliance MUST be justified

---

**Version**: 2.0.0 | **Ratified**: 2026-05-30 | **Last Amended**: 2026-05-31

---

## References

- **Product Requirements**: `/docs/PRD-index.md`
- **Business Requirements**: `/docs/BR-index.md`
- **User Stories**: `/docs/US-index.md`
- **Stitch Designs**: `/stitch_praktiqu_clinic_dashboard/`