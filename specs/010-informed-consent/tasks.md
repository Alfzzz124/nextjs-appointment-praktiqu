# Tasks: Informed Consent

## Format: `[ID] [US?] Description`

### Foundation
- T001 [P] Add ConsentForm + ConsentSignature models to `prisma/schema.prisma`
- T002 [P] Migration: `npx prisma migrate dev --name add_consent`
- T003 [P] Types + Zod schemas in `src/types/consent.ts`
- T004 [P] Consent service in `src/services/consent/service.ts`
- T005 Create routes in `src/app/api/v1/consent-forms/` and `src/app/api/v1/consent-signatures/`
- T006 Unit tests in `tests/unit/consent/service.test.ts`

### US1: Create Consent Form (P1)
- T007 Create form builder UI in `src/components/consent/form-builder.tsx`
- T008 Integration test: create form with content

### US2: Send for Signature (P1)
- T009 Send signature request in `src/components/consent/send-signature.tsx`
- T010 Integration test: send for signature

### US3: Sign Consent (P0)
- T011 Signature capture in `src/app/(public)/consent/[id]/sign/page.tsx`
- T012 Integration test: sign consent

### US4: View Status (P1)
- T013 Status view in `src/components/consent/status-badge.tsx`
- T014 Integration test: status display

### Polish
- T015 E2E plan at `docs/testing/consent-e2e-plan.md`
- T016 Lint, type-check, tests, build