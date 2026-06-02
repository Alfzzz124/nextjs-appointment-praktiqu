# Tasks: Intervention Plan

- T001 [P] Add InterventionPlan + RecommendationItem models to `prisma/schema.prisma`
- T002 [P] Migration: `npx prisma migrate dev --name add_intervention_plan`
- T003 [P] Types + Zod schemas in `src/types/intervention-plan.ts`
- T004 [P] InterventionPlan service in `src/services/intervention-plan/service.ts`
- T005 [P] Routes in `src/app/api/v1/intervention-plans/`
- T006 [P] Unit tests in `tests/unit/intervention-plan/service.test.ts`
- T007 [US1] Plan creation UI in professional dashboard
- T008 [US1] Integration test for plan creation
- T009 [US2] Recommendation items UI in `src/components/intervention-plan/recommendation-form.tsx`
- T010 [US2] Integration test for adding items
- T011 [US3] Client plan view in `src/app/(dashboard)/client/intervention-plan/page.tsx`
- T012 [US3] Client marks items complete
- T013 [US3] Integration test: client completes item
- T014 [P] E2E plan at `docs/testing/intervention-plan-e2e-plan.md`
- T015 Run lint, type-check, tests, build