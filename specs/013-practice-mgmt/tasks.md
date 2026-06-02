# Tasks: Practice Management

## Foundation
- T001 [P] Add Practice + Holiday models to `prisma/schema.prisma` (if not already existing)
- T002 [P] Migration: `npx prisma migrate dev --name add_practice_holidays`
- T003 [P] Types + Zod schemas in `src/types/practice.ts`
- T004 [P] Practice service in `src/services/practice/service.ts`
- T005 Unit tests in `tests/unit/practice/service.test.ts`

## US1: Practice Settings (P1)
- T006 Settings form in `src/components/practice/settings-form.tsx`
- T007 Integration test: update practice settings

## US2: Holiday Management (P1)
- T008 Holiday list + form in `src/components/practice/holidays.tsx`
- T009 Integration test: add/remove holiday

## Polish
- T010 E2E plan at `docs/testing/practice-mgmt-e2e-plan.md`
- T011 Lint, type-check, tests, build