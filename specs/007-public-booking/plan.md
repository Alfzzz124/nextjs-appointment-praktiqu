# Implementation Plan: Public Booking Portal

**Branch**: `007-public-booking` | **Date**: 2026-06-02 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/007-public-booking/spec.md`

## Summary

Implement a multi-step public booking wizard for PraktiQU: browse and select professional, choose service, pick date/time slot, login or register inline, confirm booking and view confirmation. Slots are consumed from the slot API (feature 002). Sessions are created as PENDING via the session API (feature 005). Inline registration creates WordPress account + client profile (feature 004).

## Technical Context

**Language/Version**: TypeScript (strict mode), Node 20 LTS
**Primary Dependencies**: Next.js 14+ (App Router), Prisma 5, MySQL (existing WordPress DB), NextAuth v5, Zod (validation), date-fns (date handling)
**Storage**: No new data stores — reads Professional/Service/Slot from features 002-003, writes Session via feature 005
**Testing**: Vitest (unit), @vercel/agent-browser (E2E via markdown test plans)
**Target Platform**: Web (Vercel-compatible, also works on shared hosting / VPS)
**Project Type**: Web application (public-facing Next.js pages)
**Performance Goals**: Slots display < 2s (SC-002); booking completion < 5min (SC-001)
**Constraints**: Wizard is public (no auth until Step 4). Email deferred to feature 012.
**Scale/Scope**: Public-facing — no practice limits for visitors

## Constitution Check

*GATE: Must pass before Phase 0 research.*

- [x] Design-Driven: UI follows Stitch designs; deviations documented.
- [x] Trunk-Based: Short-lived branch (max 3 days), PR to main.
- [x] Conventional Commits: `feat(booking): ...` style.
- [x] TDD + E2E: Unit tests first; E2E plan in `docs/testing/public-booking-e2e-plan.md`.
- [x] CI/CD: Lint, type-check, tests, build must pass.
- [x] API Standards: REST `/api/v1/sessions` (feature 005), JWT bearer for login during wizard.
- [x] Logging: AUDIT for session creation.
- [x] Compatibility: Compatible with Vercel / shared hosting / VPS.

## Project Structure

```text
src/
├── app/
│   ├── (public)/
│   │   └── book/
│   │       ├── page.tsx               # Step 1: Professional selection
│   │       ├── [professionalId]/
│   │       │   ├── service/page.tsx     # Step 2: Service selection
│   │       │   ├── [serviceId]/
│   │       │   │   └── slot/
│   │       │       ├── page.tsx       # Step 3: Date/time selection
│   │       │       └── confirm/
│   │       │           └── page.tsx   # Step 4: Client info/login + Step 5: Confirmation
│   └── api/
│       └── v1/
│           ├── professionals/slots/   # GET available slots (feature 002)
│           └── sessions/               # POST booking (feature 005)
├── services/
│   └── booking/
│       ├── wizard.service.ts         # Wizard state management
│       └── slot-hold.service.ts     # 15-minute slot hold tracking
├── components/
│   ├── booking/
│   │   ├── professional-card.tsx
│   │   ├── service-card.tsx
│   │   ├── slot-picker.tsx
│   │   ├── booking-form.tsx
│   │   └── confirmation.tsx
│   └── ui/
└── lib/
    └── calendar.ts                   # Add to Calendar (.ics / Google Calendar link)

tests/
├── unit/
│   └── booking/
│       └── wizard.service.test.ts
└── integration/
    └── booking/
        └── booking-flow.test.ts

docs/testing/
└── public-booking-e2e-plan.md
```

## Wizard Flow

```
Step 1: /book/ — Browse professionals (public, no auth)
    ↓ select professional
Step 2: /book/:professionalId/service/ — Pick service (public, no auth)
    ↓ select service
Step 3: /book/:professionalId/:serviceId/slot/ — Pick date/time (public, no auth)
    ↓ select slot (15-min hold starts)
Step 4: /book/:professionalId/:serviceId/confirm — Client info/login (public, session=POST)
    ↓ submit
Step 5: Confirmation — Success page (authenticated session)
```

## API Contracts

```
GET /api/v1/professionals/public           # Public professional list (from feature 002)
GET /api/v1/professionals/:id/slots?date=YYYY-MM-DD&serviceId=  # Available slots (feature 002)
POST /api/v1/sessions                      # Create PENDING session (feature 005)
```

## Authorization

- Steps 1-3: No authentication required
- Step 4: Anonymous session POST with form data
- Login: NextAuth credentials (feature 001)
- Inline registration: Creates WordPress user + Client profile

## Slot Hold Mechanism

- When user reaches Step 3 and selects a slot, a temporary hold is created in-memory (Map with TTL)
- Hold key: `slot-hold:{professionalId}:{serviceId}:{slotDate}:{startTime}`
- Hold TTL: 15 minutes
- Cleanup: Periodic background task removes expired holds
- If user completes booking within 15 min: hold is consumed and session created
- If user exceeds 15 min: hold expires, slot becomes available again
- If hold expires and user tries to submit: 409 "Slot hold expired — please select another time"
- **Multi-instance note**: In-memory hold is single-instance only. For multi-instance deployments (e.g., Vercel Edge), migrate to Redis with TTL keys. Migration path: replace Map with Redis SETEX, keep same key format.

## Complexity Tracking

> No constitution violations requiring justification.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| (none) | - | - |

## Implementation Order

1. Wizard layout and routing (5 steps)
2. Step 1: Professional listing
3. Step 2: Service listing
4. Step 3: Slot picker + hold mechanism
5. Step 4: Client info form + login
6. Step 5: Confirmation page
7. Integration tests
8. E2E plan markdown