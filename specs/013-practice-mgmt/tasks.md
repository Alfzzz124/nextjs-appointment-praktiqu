# Tasks: Practice Management

## Foundation
- [X] T001 [P] Add Practice + Holiday models to `prisma/schema.prisma` (if not already existing) — Clinic (Practice) + Holiday already present; no schema change needed.
- [X] T002 [P] Migration: `npx prisma migrate dev --name add_practice_holidays` — migration SQL added; pending `prisma migrate dev` to apply against DB.
- [X] T003 [P] Types + Zod schemas in `src/types/practice.ts`
- [X] T004 [P] Practice service in `src/services/practice/service.ts`
- [X] T005 Unit tests in `tests/unit/practice/service.test.ts`

## US1: Practice Settings (P1)
- [X] T006 Settings form in `src/components/practice/settings-form.tsx`
- [X] T007 Integration test: update practice settings (`tests/integration/practice/routes.test.ts`)

## US2: Holiday Management (P1)
- [X] T008 Holiday list + form in `src/components/practice/holidays.tsx`
- [X] T009 Integration test: add/remove holiday (`tests/integration/practice/routes.test.ts`)

## Polish
- [X] T010 E2E plan at `docs/testing/practice-mgmt-e2e-plan.md`
- [X] T011 Lint, type-check, tests, build (requires `npm install` then `npm run build`)