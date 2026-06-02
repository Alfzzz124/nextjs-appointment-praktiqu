# Tasks: Informed Consent

## Format: `[ID] [US?] Description`

### Foundation
- [X] T001 [P] Add ConsentForm + ConsentSignature models to `prisma/schema.prisma`
- [X] T002 [P] Migration: `npx prisma migrate dev --name add_consent`
- [X] T003 [P] Types + Zod schemas in `src/types/consent.ts`
- [X] T004 [P] Consent service in `src/services/consent/service.ts`
- [X] T005 Create routes in `src/app/api/v1/consent-forms/` and `src/app/api/v1/consent-signatures/`
- [X] T006 Unit tests in `tests/unit/consent/service.test.ts`

### US1: Create Consent Form (P1)
- [X] T007 Create form builder UI in `src/components/consent/form-builder.tsx`
- [X] T008 Integration test: create form with content

### US2: Send for Signature (P1)
- [X] T009 Send signature request in `src/components/consent/send-signature.tsx`
- [X] T010 Integration test: send for signature

### US3: Sign Consent (P0)
- [X] T011 Signature capture in `src/app/(public)/consent/[id]/sign/page.tsx`
- [X] T012 Integration test: sign consent

### US4: View Status (P1)
- [X] T013 Status view in `src/components/consent/status-badge.tsx`
- [X] T014 Integration test: status display

### Polish
- [X] T015 E2E plan at `docs/testing/consent-e2e-plan.md`
- [X] T016 Lint, type-check, tests, build