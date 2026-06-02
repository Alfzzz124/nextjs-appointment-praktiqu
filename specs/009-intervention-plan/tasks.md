# Tasks: Intervention Plan

- [X] T001 [P] Add InterventionPlan + RecommendationItem models to `prisma/schema.prisma`
- [X] T002 [P] Migration: `npx prisma migrate dev --name add_intervention_plan`
- [X] T003 [P] Types + Zod schemas in `src/types/intervention-plan.ts`
- [X] T004 [P] InterventionPlan service in `src/services/intervention-plan/service.ts`
- [X] T005 [P] Routes in `src/app/api/v1/intervention-plans/`
- [X] T006 [P] Unit tests in `tests/unit/intervention-plan/service.test.ts`
- [X] T007 [US1] Plan creation UI in professional dashboard
- [X] T008 [US1] Integration test for plan creation
- [X] T009 [US2] Recommendation items UI in `src/components/intervention-plan/recommendation-form.tsx`
- [X] T010 [US2] Integration test for adding items
- [X] T011 [US3] Client plan view in `src/app/(dashboard)/client/intervention-plan/page.tsx`
- [X] T012 [US3] Client marks items complete
- [X] T013 [US3] Integration test: client completes item
- [X] T014 [P] E2E plan at `docs/testing/intervention-plan-e2e-plan.md`
- [X] T015 Run lint, type-check, tests, build