# Tasks: Service Management

**Input**: Design documents from `/specs/003-service-mgmt/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), data-model.md, contracts/api.md

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2)
- Include exact file paths in descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [X] T001 Add Service model, ServiceType enum, ServiceStatus enum to `prisma/schema.prisma` (see plan.md data model section)
- [X] T002 Generate Prisma migration: `npx prisma migrate dev --name add_service_management`
- [X] T003 Generate Prisma client: `npx prisma generate`
- [X] T004 [P] Create TypeScript types for Service entity in `src/types/service.ts`
- [X] T005 [P] Create Zod validation schemas in `src/services/service/validation.ts` (name (max 100), description (max 500), price (>=0), durationMinutes in {30,60,90,120,150,180}, serviceType enum, status enum)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T006 Create `src/services/service/service.service.ts` with create, read, update, list, deactivate, reactivate, canDelete() methods
- [X] T007 Add AUDIT logging to service.service.ts for all state changes (create, update, deactivate, reactivate, delete)
- [X] T008 Create `GET /api/v1/services` endpoint in `src/app/api/v1/services/route.ts` with pagination, search, serviceType filter, status filter
- [X] T009 Create `POST /api/v1/services` endpoint for creating new service in `src/app/api/v1/services/route.ts`
- [X] T010 Create `GET /api/v1/services/[id]` endpoint in `src/app/api/v1/services/[id]/route.ts`
- [X] T011 Create `PATCH /api/v1/services/[id]` endpoint for partial updates in `src/app/api/v1/services/[id]/route.ts`
- [X] T012 Create `DELETE /api/v1/services/[id]` endpoint in `src/app/api/v1/services/[id]/route.ts` with INACTIVE + no bookings + no assignments preconditions
- [X] T013 Create `PATCH /api/v1/services/[id]/status` endpoint in `src/app/api/v1/services/[id]/status/route.ts`
- [X] T014 Create `GET /api/v1/services/public` endpoint in `src/app/api/v1/services/public/route.ts` (public, ACTIVE services only, no auth)
- [X] T015 Add RBAC authorization checks to all service endpoints using existing auth helpers from auth-foundation (001)
- [X] T016 Add name uniqueness validation per practice in `service.service.ts` create() and update()
- [X] T017 Write unit tests in `tests/unit/service/service.service.test.ts` covering create, read, update, list, deactivate, reactivate, delete preconditions
- [X] T018 Write unit tests in `tests/unit/service/validation.test.ts` covering all Zod schemas (duration, price, name length, description length)

**Checkpoint**: Foundation ready - user story implementation can now begin

---

## Phase 3: User Story 1 - Create a Service (Priority: P1) 🎯 MVP

**Goal**: Clinic Admin can create a new service with name, price, duration, and service type; service appears in list immediately

**Independent Test**: Submit create form with name, price 150000, duration 60, serviceType KONSELING → verify service in list with ACTIVE status

### Implementation

- [X] T019 [US1] Implement practiceId injection from authenticated user context in `service.service.ts` create() method
- [X] T020 [US1] Add 409 conflict response for duplicate name per practice in `POST /api/v1/services` endpoint
- [X] T021 [US1] Add 422 field-level validation error response in `POST /api/v1/services` endpoint (invalid duration, negative price, name too long)
- [X] T022 [US1] Create service form component in `src/components/service/service-form.tsx` with all fields: name, description, price, durationMinutes (select), serviceType (select)
- [X] T023 [US1] Create duration select component in `src/components/service/duration-select.tsx` with allowed values {30, 60, 90, 120, 150, 180}
- [X] T024 [US1] Create service type select component in `src/components/service/service-type-select.tsx` with options KONSELING, ASESMEN, WORKSHOP
- [X] T025 [US1] Create admin service list page at `src/app/(dashboard)/admin/services/page.tsx`
- [X] T026 [US1] Add integration test in `tests/integration/service/create.test.ts` covering happy path, name conflict, invalid duration, negative price
- [X] T027 [US1] Verify service appears in list within 5 seconds of submission (SC-001)

---

## Phase 4: User Story 2 - Update Service Details (Priority: P1)

**Goal**: Clinic Admin can update any service field; system warns when changing duration on service with existing bookings

**Independent Test**: Update service price → reload → new price visible; Update duration on service with bookings → warning dialog appears

### Implementation

- [X] T028 [US2] Implement duration-change warning logic in `service.service.ts` update() — check for existing BOOKED sessions before duration change and return warning flag
- [X] T029 [US2] Implement name conflict check in `service.service.ts` update() — reject if new name conflicts with another service in same practice
- [X] T030 [US2] Create edit view in `service-form.tsx` with pre-filled values and save behavior
- [X] T031 [US2] Add warning dialog component in `src/components/service/duration-change-warning.tsx` shown before duration save on service with bookings
- [X] T032 [US2] Add integration test in `tests/integration/service/update.test.ts` covering happy path, name conflict, duration change warning
- [X] T033 [US2] Verify updated duration is reflected in slot generation immediately (SC-002)

---

## Phase 5: User Story 3 - List and Search Services (Priority: P1)

**Goal**: Staff and professionals can browse the service catalog with pagination, search, and filters

**Independent Test**: Load service list → pagination works → search by name → filter by type → URL reflects filters

### Implementation

- [X] T034 [US3] Implement case-insensitive name search in `service.service.ts` list() method
- [X] T035 [US3] Implement serviceType and status filters in `service.service.ts` list() method
- [X] T036 [US3] Create service list component in `src/components/service/service-list.tsx` with table view, pagination controls, search input, type filter chips
- [X] T037 [US3] Add URL-based filter persistence (page, limit, search, serviceType, status) in service list page
- [X] T038 [US3] Add integration test in `tests/integration/service/list.test.ts` covering pagination, search, type filter, status filter
- [X] T039 [US3] Verify list returns 100 services within 1 second (SC-004)

---

## Phase 6: User Story 4 - Deactivate and Reactivate Services (Priority: P2)

**Goal**: Clinic Admin can deactivate a service (removes from slot generation) and reactivate it

**Independent Test**: Deactivate ACTIVE service → verify INACTIVE status → verify not in slot results → reactivate → verify back in slot results

### Implementation

- [X] T040 [US4] Implement deactivate/reactivate in `service.service.ts` setStatus() method — status transition ACTIVE ↔ INACTIVE
- [X] T041 [US4] Implement delete preconditions check in `service.service.ts` canDelete() — returns error if not INACTIVE, has assignments, or has bookings
- [X] T042 [US4] Create status toggle in service list row actions in `src/components/service/service-list.tsx`
- [X] T043 [US4] Create confirmation dialog for delete action in `src/components/service/delete-confirmation.tsx` showing blockers if any
- [X] T044 [US4] Add integration test in `tests/integration/service/deactivate.test.ts` covering deactivate, reactivate, delete preconditions
- [X] T044b [US4] [P] Add integration test in `tests/integration/service/public-endpoint.test.ts` covering: no-auth access returns ACTIVE services, practiceId filter works, INACTIVE services excluded (FR-012)
- [X] T045 [US4] Verify deactivated service disappears from slot results within 5 seconds (SC-003)

---

## Phase 7: User Story 5 - View Service Details (Priority: P2)

**Goal**: Professional or staff can view full service details including assigned professional count

**Independent Test**: View service detail page → see all fields + assigned professional count

### Implementation

- [X] T046 [US5] Add assignedProfessionalCount to service detail response in `GET /api/v1/services/[id]` by counting ProfessionalServiceAssignment records
- [X] T047 [US5] Create service detail page at `src/app/(dashboard)/admin/services/[id]/page.tsx` showing all fields and assigned professional count
- [X] T048 [US5] Add "No professionals assigned yet" empty state in detail page

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [X] T049 [P] Create E2E test plan markdown at `docs/testing/service-mgmt-e2e-plan.md` covering: create service, update service, list with filters, deactivate, delete
- [X] T050 [P] Add OPENAPI 3.0 spec entries for all service endpoints in `docs/api/openapi.yaml`
- [X] T051 Verify all AUDIT events are logged: service.created, service.updated, service.status_changed, service.deleted
- [X] T052 Run ESLint and Prettier on all new files
- [X] T053 Run TypeScript strict mode check: `npx tsc --strict`
- [X] T054 Run full test suite: `npm test`
- [X] T055 Run production build: `npm run build`
- [X] T056 Create PR to main with feature description and checklist of completed items

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3-7)**: All depend on Foundational phase completion; US3 can start after US1; others independent
- **Polish (Phase 8)**: Depends on all user stories being complete

### User Story Dependencies

- **US1 (P1)**: Independent - foundational prerequisites only
- **US2 (P2)**: Depends on US1 (same service entity and form component)
- **US3 (P1)**: Independent after foundational; shares list UI with US1
- **US4 (P2)**: Independent after foundational
- **US5 (P2)**: Independent after foundational

### Parallel Opportunities

- T004 + T005 can run in parallel (types and validation, no dependencies)
- T022, T023, T024 can run in parallel (form components for US1)
- T049 + T050 can run in parallel (E2E plan and OpenAPI spec)
- T052, T053, T054, T055 can run in parallel (CI checks)

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational
3. Complete Phase 3: US1 (Create Service)
4. **STOP and VALIDATE**: Test US1 independently
5. Deploy/demo if ready

### Incremental Delivery

1. Setup + Foundational → Foundation ready
2. US1 → Test → Deploy (MVP!)
3. US3 → Test → Deploy
4. US2 → Test → Deploy
5. US4 → Test → Deploy
6. US5 → Test → Deploy
7. Polish → Final Release

---

## Notes

- **[P]** tasks = different files, no dependencies - safe to parallelize
- **[Story]** label maps task to specific user story for traceability
- Each user story is independently testable
- Commit after each phase or logical grouping
- Stop at checkpoints to validate story independently
- AUDIT logging required for all state changes (FR-011)
- Physical deletion only for INACTIVE services with zero bookings and zero assignments (FR-009)
- Duration change warns but does not block (FR-005)
- Public endpoint (/services/public) requires no auth (FR-012)