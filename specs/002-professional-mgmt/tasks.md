# Tasks: Professional Management

**Input**: Design documents from `/specs/002-professional-mgmt/`

**Prerequisites**: plan.md (required), spec.md (required for user stories)

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2)
- Include exact file paths in descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [X] T001 Create feature branch `feat/002-professional-management` per trunk-based development rules
- [X] T002 Update `prisma/schema.prisma` with Professional, ProfessionalAvailability, ProfessionalOffDay, ProfessionalServiceAssignment models, and enums ProfessionalType and ProfessionalStatus (see plan.md data model section)
- [X] T003 Generate Prisma migration: `npx prisma migrate dev --name add_professional_management`
- [X] T004 Generate Prisma client: `npx prisma generate`
- [X] T005 [P] Create TypeScript types for all professional entities in `src/types/professional.ts`
- [X] T006 [P] Add Zod validation schemas in `src/services/professional/validation.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T007 Create `src/services/professional/professional.service.ts` with create, read, update, list, deactivate, activate methods
- [X] T008 Create `src/services/professional/availability.service.ts` with generateSlots(), getWeeklySchedule(), addOffDay(), removeOffDay() methods
- [X] T009 Create `src/services/professional/service-assignment.service.ts` with assignService(), unassignService(), listAssignedServices() methods
- [X] T010 Create `src/lib/audit.ts` helper for AUDIT logging of all professional state changes
- [X] T011 Create `src/lib/time.ts` utility for UTC ↔ practice timezone conversion using date-fns-tz
- [X] T012 Create `GET /api/v1/professionals` endpoint in `src/app/api/v1/professionals/route.ts` with pagination, search, and status filter
- [X] T013 Create `POST /api/v1/professionals` endpoint for Super Admin registration in `src/app/api/v1/professionals/route.ts`
- [X] T014 Create `GET /api/v1/professionals/[id]` endpoint in `src/app/api/v1/professionals/[id]/route.ts`
- [X] T015 Create `PATCH /api/v1/professionals/[id]` endpoint in `src/app/api/v1/professionals/[id]/route.ts`
- [X] T016 Create `PATCH /api/v1/professionals/[id]/status` endpoint in `src/app/api/v1/professionals/[id]/status/route.ts`
- [X] T017 Create `GET /api/v1/professionals/[id]/slots` endpoint in `src/app/api/v1/professionals/[id]/slots/route.ts` with date and serviceId query params
- [X] T018 Add RBAC authorization checks to all professional endpoints using existing auth helpers from auth-foundation (001)
- [X] T019 Write unit tests in `tests/unit/professional/professional.service.test.ts` covering create, read, update, list, status change
- [X] T020 Write unit tests in `tests/unit/professional/availability.service.test.ts` covering slot generation for 30/60/90/120-minute services

**Checkpoint**: Foundation ready - user story implementation can now begin

---

## Phase 3: User Story 1 - Register Professional (Priority: P1) 🎯 MVP

**Goal**: Super Admin can register a new professional with name, email, professional type, SIP/SIK, and practice assignment

**Independent Test**: Submit create form with all required fields → verify professional created with PENDING_ACTIVATION status and appears in list

### Implementation

- [X] T021 [US1] Add professional-type enum values (PSIKOLOG_KLINIS, PSIKOLOG_ANAK, PSIKIATER, KONSELOR) to `prisma/schema.prisma` if not already done in T002
- [X] T022 [US1] Implement WordPress user provisioning in `professional.service.ts` create() method: create WP user account and link via userId
- [X] T023 [US1] Add SIP/SIK uniqueness validation in `validation.ts` checkUniqueRegistrationNumber() 
- [X] T024 [US1] Add email uniqueness validation in `validation.ts` checkUniqueEmail()
- [X] T025 [US1] Add field-level validation errors response format per API standards (RFC 7807 with field-level detail)
- [X] T026 [US1] Create admin professional list component in `src/components/professional/professional-list.tsx` with pagination, search, status filter chips
- [X] T027 [US1] Create professional create/edit form component in `src/components/professional/professional-form.tsx` with all required fields
- [X] T028 [US1] Create admin page at `src/app/(dashboard)/admin/professionals/page.tsx` mounting professional-list and create form
- [X] T029 [US1] Add integration test in `tests/integration/professional/create.test.ts` covering happy path and validation errors
- [X] T030 [US1] Verify professional list returns results within 1 second for 500 professionals (SC-006)

---

## Phase 4: User Story 2 - Maintain Profile (Priority: P1)

**Goal**: Professional can view and update their own profile (biography, specialties, contact info) but cannot edit SIP/SIK or professional type

**Independent Test**: Professional updates biography and specialties → reload profile → changes persist

### Implementation

- [X] T031 [US2] Add PATCH filter in `professional.service.ts` to restrict updatable fields for self-edit (biography, specialties, contactInfo only)
- [X] T032 [US2] Add "read-only" field definitions in `professional-form.tsx` for SIP/SIK and professional type with explanatory tooltip
- [X] T033 [US2] Create self-service profile page at `src/app/(dashboard)/professional/profile/page.tsx`
- [X] T034 [US2] Add specialties multi-select/tag input component in `src/components/professional/specialties-input.tsx`
- [X] T035 [US2] Create integration test in `tests/integration/professional/profile.test.ts` covering self-edit with restricted fields
- [X] T036 [US2] Verify AUDIT event is logged when professional updates their own profile (FR-012)

---

## Phase 5: User Story 3 - Configure Availability (Priority: P1)

**Goal**: Professional can define weekly availability and off-day overrides; system generates bookable slots per service duration

**Independent Test**: Configure Mon/Wed/Fri 09:00-12:00 for 60-min service → query slots for next Monday → verify 3 slots at 09:00, 10:00, 11:00

### Implementation

- [X] T037 [US3] Add PUT `availability` endpoint in `src/app/api/v1/professionals/[id]/availability/route.ts` to replace full weekly schedule
- [X] T038 [US3] Add GET/POST/DELETE off-days endpoints in `src/app/api/v1/professionals/[id]/off-days/route.ts`
- [X] T039 [US3] Implement availability validation: no overlapping windows on same day-of-week (FR-015)
- [X] T039b [US3] [P] Add integration test in `tests/integration/professional/availability-overlap.test.ts` covering overlapping window rejection (FR-015)
- [X] T040 [US3] Implement slot generation in `availability.service.ts` following algorithm in plan.md (intersect availability + service duration + subtract off-days + subtract booked/pending sessions)
- [X] T041 [US3] Create availability editor component in `src/components/professional/availability-editor.tsx` with day-of-week grid and time range inputs
- [X] T042 [US3] Create off-day editor component in `src/components/professional/off-day-editor.tsx` with date picker and reason field
- [X] T043 [US3] Add availability and off-day management to self-service profile page at `src/app/(dashboard)/professional/profile/page.tsx`
- [X] T044 [US3] Write integration tests in `tests/integration/professional/slots.test.ts` covering 30/60/90/120-min services and off-day overrides
- [X] T045 [US3] Verify slots API returns within 500ms p95 (SC performance goal)

---

## Phase 6: User Story 4 - List, Search, Status (Priority: P2)

**Goal**: Clinic Admin can browse, search, and activate/deactivate professionals within their practice

**Independent Test**: Filter by ACTIVE → deactivate one → verify it disappears from slot results within 5 seconds

### Implementation

- [X] T046 [US4] Add practice-scoped query in `professional.service.ts` list() method: Clinic Admin sees only their practice's professionals
- [X] T047 [US4] Add URL-based filter persistence for status filter in `professional-list.tsx`
- [X] T048 [US4] Add "activate/deactivate" action in professional list with confirmation dialog in `src/components/professional/professional-actions.tsx`
- [X] T049 [US4] Add test in `tests/integration/professional/status.test.ts` covering status change → slot visibility propagation (SC-005)
- [X] T050 [US4] Verify deactivated professional disappears from slot results within 5 seconds (SC-005)

---

## Phase 7: User Story 5 - Service Assignment (Priority: P2)

**Goal**: Clinic Admin can assign services to a professional; assigned services determine which slot grids appear

**Independent Test**: Assign 60-min and 120-min services to professional → query slots for each → verify correct duration per service

### Implementation

- [X] T051 [US5] Add GET/POST/DELETE endpoints for service assignments in `src/app/api/v1/professionals/[id]/services/route.ts`
- [X] T052 [US5] Add ACTIVE service filter in `service-assignment.service.ts` assignService() (only ACTIVE services can be assigned, per FR-011)
- [X] T053 [US5] Add "no duplicate assignment" check in assignService() 
- [X] T054 [US5] Create service assignment UI in professional form: searchable multi-select showing service name, duration, and status in `src/components/professional/service-assignment-select.tsx`
- [X] T055 [US5] Create read-only service list in self-service profile in `src/components/professional/assigned-services-list.tsx`
- [X] T056 [US5] Add integration test in `tests/integration/professional/service-assignment.test.ts` covering assign/unassign and ACTIVE-only filter
- [X] T057 [US5] Verify slot API reflects correct duration per assigned service (FR-007)

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [X] T058 [P] Create E2E test plan markdown at `docs/testing/professional-mgmt-e2e-plan.md` covering: register professional, configure availability, book a slot, activate/deactivate
- [X] T059 [P] Add OPENAPI 3.0 spec entries for all professional endpoints in `docs/api/openapi.yaml`
- [X] T060 Verify all AUDIT events are logged: professional.created, professional.updated, professional.status_changed, professional.service_assigned, professional.service_unassigned, professional.availability_changed, professional.off_day_added, professional.off_day_removed
- [X] T061 Run ESLint and Prettier on all new files
- [X] T062 Run TypeScript strict mode check: `npx tsc --strict`
- [X] T063 Run full test suite: `npm test`
- [X] T064 Run production build: `npm run build`
- [X] T065 Create PR to main with feature description and checklist of completed items

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3-7)**: All depend on Foundational phase completion; proceed sequentially in priority order
- **Polish (Phase 8)**: Depends on all user stories being complete

### User Story Dependencies

- **US1 (P1)**: Independent - foundational prerequisites only
- **US2 (P2)**: Depends on US1 (same professional entity)
- **US3 (P1)**: Depends on US1 (availability links to professional)
- **US4 (P2)**: Independent after foundational
- **US5 (P2)**: Depends on US1 (service assignment links to professional)

### Parallel Opportunities

- T005, T006 can run in parallel (types and validation, no dependencies)
- T021, T022, T023, T024, T025 can run in parallel (US1 implementation tasks)
- T041, T042 can run in parallel (availability and off-day editors)
- T058, T059 can run in parallel (E2E plan and OpenAPI spec)

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational
3. Complete Phase 3: US1 (Register Professional)
4. **STOP and VALIDATE**: Test US1 independently
5. Deploy/demo if ready

### Incremental Delivery

1. Setup + Foundational → Foundation ready
2. US1 → Test → Deploy (MVP!)
3. US2 → Test → Deploy
4. US3 → Test → Deploy (completeness for availability MVP)
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
- AUDIT logging required for all state changes (FR-012)
- Slot generation must handle 30/60/90/120-minute services correctly (SC-003)
- All times stored in UTC; conversion at API edge (FR-014)
