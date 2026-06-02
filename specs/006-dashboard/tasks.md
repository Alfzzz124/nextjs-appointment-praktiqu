# Tasks: Dashboard

**Input**: Design documents from `/specs/006-dashboard/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), data-model.md, contracts/api.md

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2)
- Include exact file paths in descriptions

---

## Phase 1: Foundation (Shared Infrastructure)

**Purpose**: Dashboard service layer and API routes that all user stories depend on

- [X] T001 Create `src/services/dashboard/dashboard.service.ts` with aggregation methods: getTodaySessions(role, userId), getPendingApprovals(role, userId), getActiveClients(role, userId), getUpcomingSessions(userId), getRecentHistory(userId)
- [X] T002 Create `src/services/dashboard/stats.service.ts` with: getWeeklyStats(practiceId), getMonthlyStats(practiceId), getActiveClientsCount(practiceId), getNewClientsCount(practiceId)
- [X] T003 Create `GET /api/v1/dashboard` endpoint in `src/app/api/v1/dashboard/route.ts` returning role-scoped widget data
- [X] T004 Create `GET /api/v1/dashboard/stats` endpoint in `src/app/api/v1/dashboard/stats/route.ts` for Admin/Super Admin statistics
- [X] T005 Add RBAC authorization checks: determine role from JWT, scope data accordingly
- [X] T006 Write unit tests in `tests/unit/dashboard/dashboard.service.test.ts` covering all aggregation methods
- [X] T007 Write unit tests in `tests/unit/dashboard/stats.service.test.ts` covering all stats methods

**Checkpoint**: Foundation ready - widget implementation can now begin

---

## Phase 2: UI Components (Shared)

**Purpose**: Reusable widget and shared components used by all dashboard pages

- [X] T008 [P] Create `src/components/dashboard/shared/stat-card.tsx` reusable card component with title, value, change indicator, and optional trend
- [X] T009 [P] Create `src/components/dashboard/shared/session-list-item.tsx` for displaying session in a list
- [X] T010 [P] Create `src/components/dashboard/widgets/skeleton-loader.tsx` loading skeleton for widget placeholder
- [X] T011 Create `src/components/dashboard/shared/quick-actions.tsx` with role-appropriate action links

---

## Phase 3: User Story 1 - View Dashboard Overview (Priority: P0) 🎯 MVP

**Goal**: All authenticated users see a role-specific dashboard on login

**Independent Test**: Login as each role → verify correct role-specific dashboard loads with appropriate widgets

### Implementation

- [X] T012 [US1] Create `src/app/(dashboard)/dashboard/page.tsx` root dashboard page that redirects to role-specific view
- [X] T013 [US1] Create `src/app/(dashboard)/admin/dashboard/page.tsx` for Receptionist and Clinic Admin
- [X] T014 [US1] Create `src/app/(dashboard)/professional/dashboard/page.tsx` for Professional
- [X] T015 [US1] Create `src/app/(dashboard)/client/dashboard/page.tsx` for Client
- [X] T016 [US1] Create `src/components/dashboard/dashboard-layout.tsx` base layout with header and role-specific sidebar
- [X] T017 [US1] Create `src/components/dashboard/widgets/today-sessions.tsx` widget for Receptionist/Admin/Professional
- [X] T018 [US1] Create `src/components/dashboard/widgets/pending-approvals.tsx` widget for Professional/Admin
- [X] T019 [US1] Create `src/components/dashboard/widgets/active-clients.tsx` widget for Professional
- [X] T020 [US1] Create `src/components/dashboard/widgets/statistics.tsx` widget for Clinic Admin
- [X] T021 [US1] Create `src/components/dashboard/widgets/upcoming-sessions.tsx` widget for Client
- [X] T022 [US1] Create `src/components/dashboard/widgets/recent-history.tsx` widget for Client
- [X] T023 [US1] Create `src/components/dashboard/widgets/quick-actions.tsx` widget with role-appropriate CTAs
- [X] T024 [US1] Add integration test in `tests/integration/dashboard/admin-dashboard.test.ts` verifying admin widgets, Super Admin cross-practice aggregation, data scoping, and role-specific widget inclusion
- [X] T025 [US1] Verify dashboard loads within 3 seconds (SC-001)

---

## Phase 4: Polish & Cross-Cutting Concerns

**Purpose**: E2E testing and final validation

- [X] T026 [P] Create E2E test plan markdown at `docs/testing/dashboard-e2e-plan.md` covering: login as each role, verify correct widgets, data scoping verification
- [X] T027 [P] Add OPENAPI 3.0 spec entries for dashboard endpoints in `docs/api/openapi.yaml`
- [X] T028 Run ESLint and Prettier on all new files
- [X] T029 Run TypeScript strict mode check: `npx tsc --strict`
- [X] T030 Run full test suite: `npm test`
- [X] T031 Run production build: `npm run build`
- [X] T032 Create PR to main with feature description and checklist of completed items

---

## Dependencies & Execution Order

### Phase Dependencies

- **Foundation (Phase 1)**: No dependencies - can start immediately
- **UI Components (Phase 2)**: Depends on Foundation - can start after T001-T003 complete
- **US1 (Phase 3)**: Depends on Foundation + UI Components
- **Polish (Phase 4)**: Depends on US1

### User Story Dependencies

- **US1 (P0)**: Single user story covering all roles. Independent after foundational tasks.

### Parallel Opportunities

- T008, T009, T010 can run in parallel (shared components)
- T012, T013, T014, T015 can run in parallel (dashboard pages per role)
- T017, T018, T019, T020, T021, T022, T023 can run in parallel (widget components)
- T026 + T027 can run in parallel (E2E plan and OpenAPI spec)
- T028, T029, T030, T031 can run in parallel (CI checks)

---

## Implementation Strategy

### MVP First

1. Complete Phase 1: Foundation
2. Complete Phase 2: UI Components
3. Complete Phase 3: US1 (Dashboard Overview)
4. **STOP and VALIDATE**: Test dashboard loads correctly for all roles
5. Deploy/demo if ready

### Incremental Delivery

1. Foundation → UI Components → Dashboard Overview → Polish → Release

---

## Notes

- **[P]** tasks = different files, no dependencies - safe to parallelize
- **[Story]** label maps task to specific user story for traceability
- No migrations needed - Dashboard reads from existing Session, Client, Professional, Service tables
- Revenue widget shows placeholder until billing (011) is implemented
- Skeleton loaders required for loading states - no blank screens
- Role scoping enforced in dashboard.service.ts - no data leakage between roles