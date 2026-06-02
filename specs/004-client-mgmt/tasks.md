# Tasks: Client Management

**Input**: Design documents from `/specs/004-client-mgmt/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), data-model.md, contracts/api.md

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2)
- Include exact file paths in descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [X] T001 Add Client model, ClientStatus enum, Gender enum to `prisma/schema.prisma` (see plan.md data model section)
- [X] T002 Generate Prisma migration: `npx prisma migrate dev --name add_client_management`
- [X] T003 Generate Prisma client: `npx prisma generate`
- [X] T004 [P] Create TypeScript types for Client entity in `src/types/client.ts`
- [X] T005 [P] Create Zod validation schemas in `src/services/client/validation.ts` (fullName max 100, email, mobile min 8 digits, dateOfBirth not future, gender enum, address max 500, emergencyContact max 100, notes max 1000)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T006 Create `src/lib/unique-id.ts` with generateUniqueClientId(practiceId, year) function using transaction/advisory lock for atomicity
- [X] T007 Create `src/services/client/client.service.ts` with create, read, update, list, deactivate, archive, reactivate, restore methods
- [X] T008 Create `src/services/client/access-control.ts` with canProfessionalAccessClient(professionalId, clientId) check (query Session for BOOKED/COMPLETED)
- [X] T009 Add AUDIT logging to client.service.ts for all state changes and profile updates
- [X] T010 Create `GET /api/v1/clients` endpoint in `src/app/api/v1/clients/route.ts` with pagination, search (fullName, mobileNumber prefix), status filter
- [X] T011 Create `POST /api/v1/clients` endpoint in `src/app/api/v1/clients/route.ts` for staff registration with unique ID generation
- [X] T012 Create `GET /api/v1/clients/[id]` endpoint in `src/app/api/v1/clients/[id]/route.ts`
- [X] T013 Create `PATCH /api/v1/clients/[id]` endpoint in `src/app/api/v1/clients/[id]/route.ts` with role-based field restrictions
- [X] T014 Create `DELETE /api/v1/clients/[id]` endpoint (archive: set status ARCHIVED, requires INACTIVE)
- [X] T015 Create `PATCH /api/v1/clients/[id]/status` endpoint in `src/app/api/v1/clients/[id]/status/route.ts`
- [X] T016 Create `GET /api/v1/clients/[id]/history` endpoint in `src/app/api/v1/clients/[id]/history/route.ts`
- [X] T017 Create `GET /api/v1/clients/[id]/progress` endpoint in `src/app/api/v1/clients/[id]/progress/route.ts`
- [X] T018 Add RBAC authorization and access control to all client endpoints (SUPER_ADMIN all, CLINIC_ADMIN practice, RECEPTIONIST read-only practice, PROFESSIONAL own clients, CLIENT self)
- [X] T019 Add email uniqueness validation per practice in client.service.ts create() and update() (ACTIVE clients only)
- [X] T020 Write unit tests in `tests/unit/client/client.service.test.ts` covering create, read, update, list, status transitions
- [X] T021 Write unit tests in `tests/unit/client/validation.test.ts` covering all Zod schemas
- [X] T022 Write unit tests in `tests/unit/client/access-control.test.ts` covering professional access rule

**Checkpoint**: Foundation ready - user story implementation can now begin

---

## Phase 3: User Story 1 - Register a Client via Staff (Priority: P1) 🎯 MVP

**Goal**: Receptionist can register a new client with all required fields; system generates unique client ID

**Independent Test**: Submit registration form with fullName, email, mobileNumber, dateOfBirth, gender → verify client created with CLT-2026-XXXXX ID and ACTIVE status

### Implementation

- [X] T023 [US1] Implement practiceId injection from authenticated user context in client.service.ts create() method
- [X] T024 [US1] Implement WordPress user provisioning in create() — create WP user account and link via userId
- [X] T025 [US1] Add 409 conflict response for duplicate email per practice in POST endpoint
- [X] T026 [US1] Add 422 field-level validation error response (future date of birth, invalid mobile format, missing fields)
- [X] T027 [US1] Create client form component in `src/components/client/client-form.tsx` with all fields
- [X] T028 [US1] Create gender select in `src/components/client/gender-select.tsx` with MALE/FEMALE/OTHER options
- [X] T029 [US1] Create admin client list page at `src/app/(dashboard)/admin/clients/page.tsx`
- [X] T030 [US1] Add integration test in `tests/integration/client/register.test.ts` covering happy path, email conflict, validation errors
- [X] T031 [US1] Verify client appears in list within 10 seconds of submission (SC-001)

---

## Phase 4: User Story 2 - Complete Client Profile (Priority: P1)

**Goal**: Client can view and update their own editable profile fields (mobile, address, emergency contact, notes)

**Independent Test**: Client updates mobile number and address → save → reload → changes visible; read-only fields (DOB, gender) not editable

### Implementation

- [X] T032 [US2] Implement role-based field restrictions in PATCH endpoint: CLIENT can edit mobileNumber, address, emergencyContact, notes only
- [X] T033 [US2] Add read-only field UI in client-form.tsx: dateOfBirth, gender, fullName, email shown as read-only with explanation text
- [X] T034 [US2] Create self-service profile page at `src/app/(dashboard)/client/profile/page.tsx`
- [X] T035 [US2] Add integration test in `tests/integration/client/profile-update.test.ts` covering self-edit and read-only field protection
- [X] T036 [US2] Verify AUDIT event is logged when client updates their own profile

---

## Phase 5: User Story 3 - List and Search Clients (Priority: P1)

**Goal**: Staff can browse client roster with pagination, search by name or mobile number, filter by status

**Independent Test**: Load client list → pagination works → search by name → search by mobile prefix → status filter → URL reflects filters

### Implementation

- [X] T037 [US3] Implement case-insensitive name search in client.service.ts list() method
- [X] T038 [US3] Implement mobile number prefix search in client.service.ts list() method
- [X] T039 [US3] Implement status filter in client.service.ts list() method
- [X] T040 [US3] Create client list component in `src/components/client/client-list.tsx` with table, pagination, search input, status filter chips
- [X] T041 [US3] Add URL-based filter persistence in client list page (page, limit, search, status)
- [X] T042 [US3] Add integration test in `tests/integration/client/list.test.ts` covering pagination, search, status filter
- [X] T043 [US3] Verify list returns 200 clients within 1 second (SC-002)
- [X] T044 [US3] Verify search returns results within 500ms (SC-003)

---

## Phase 6: User Story 4 - View Client Details and Session History (Priority: P2)

**Goal**: Professional or Receptionist can view client profile and session history to prepare for sessions

**Independent Test**: View client detail page → see all profile fields + session history timeline + session count

### Implementation

- [X] T045 [US4] Add sessionCount to client detail response in GET /clients/[id]
- [X] T046 [US4] Create session history endpoint in GET /clients/[id]/history — returns sessions sorted by date (newest first) with service, professional, status, sessionNotesAvailable flag
- [X] T047 [US4] Create client detail page at `src/app/(dashboard)/admin/clients/[id]/page.tsx` with full profile display
- [X] T048 [US4] Create session history component in `src/components/client/session-history.tsx`
- [X] T049 [US4] Add "No sessions yet" empty state in session history component
- [X] T050 [US4] Add integration test in `tests/integration/client/history.test.ts` covering history retrieval and empty state

---

## Phase 7: User Story 5 - Manage Client Status (Priority: P2)

**Goal**: Clinic Admin can deactivate or archive a client; status changes affect booking eligibility

**Independent Test**: Deactivate ACTIVE client → cannot book → reactivate → can book again; Archive INACTIVE client → hidden from active lists

### Implementation

- [X] T051 [US5] Implement status transition validation in client.service.ts setStatus() — ACTIVE can go to INACTIVE only; INACTIVE can go to ACTIVE or ARCHIVED; ARCHIVED can go to ACTIVE
- [X] T052 [US5] Implement archive preconditions: cannot archive ACTIVE client (must deactivate first)
- [X] T053 [US5] Create client status badge component in `src/components/client/client-status-badge.tsx` (ACTIVE=green, INACTIVE=yellow, ARCHIVED=gray)
- [X] T054 [US5] Create status actions in client list row (deactivate, reactivate, archive buttons)
- [X] T055 [US5] Add confirmation dialog for archive action
- [X] T056 [US5] Add integration test in `tests/integration/client/status.test.ts` covering all valid transitions and archive preconditions
- [X] T057 [US5] Verify INACTIVE/ARCHIVED status blocks booking initiation within 5 seconds (SC-004) — coordinated with feature 005
- [X] T057b [US5] [P] Add integration test in `tests/integration/client/status-blocking.test.ts` verifying INACTIVE client cannot initiate new booking — returns 403 with "Account inactive" message (FR-008, coordinated with feature 005 booking API)

---

## Phase 8: User Story 6 - Track Client Progress (Priority: P2)

**Goal**: Professional sees aggregated client progress: session timeline, session note summaries, intervention plan summaries

**Independent Test**: Open client progress view → see session timeline with dates/services/professionals/status → expand session → see note summary → see intervention plan summary

### Implementation

- [X] T058 [US6] Create progress endpoint in GET /clients/[id]/progress aggregating: totalSessions, completedSessions, upcomingSession, sessionTimeline (with sessionNotesSummary, interventionPlanSummary), activeInterventionPlan
- [X] T059 [US6] Implement graceful degradation: if Session Notes (008) or Intervention Plan (009) not implemented, show null values without error
- [X] T060 [US6] Create progress overview component in `src/components/client/progress-overview.tsx` with session timeline, note summaries, plan summaries
- [X] T061 [US6] Add progress view tab to client detail page in `src/app/(dashboard)/admin/clients/[id]/page.tsx`
- [X] T062 [US6] Add integration test in `tests/integration/client/progress.test.ts` covering progress aggregation and graceful degradation
- [X] T063 [US6] Verify session history accessible within same response time as detail view (SC-006)

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [X] T064 [P] Create E2E test plan markdown at `docs/testing/client-mgmt-e2e-plan.md` covering: register client, profile update, list search, view history, status management, progress view
- [X] T065 [P] Add OPENAPI 3.0 spec entries for all client endpoints in `docs/api/openapi.yaml`
- [X] T066 Verify all AUDIT events are logged: client.created, client.updated, client.status_changed
- [X] T067 Run ESLint and Prettier on all new files
- [X] T068 Run TypeScript strict mode check: `npx tsc --strict`
- [X] T069 Run full test suite: `npm test`
- [X] T070 Run production build: `npm run build`
- [X] T071 Create PR to main with feature description and checklist of completed items

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3-8)**: All depend on Foundational phase completion; US2 can start after US1; US4-US6 independent after foundational
- **Polish (Phase 9)**: Depends on all user stories being complete

### User Story Dependencies

- **US1 (P1)**: Independent - foundational prerequisites only
- **US2 (P2)**: Depends on US1 (same client entity and form component)
- **US3 (P1)**: Independent after foundational; shares list UI with US1
- **US4 (P2)**: Independent after foundational
- **US5 (P2)**: Independent after foundational; status badge shared with US4
- **US6 (P2)**: Independent after foundational; progress view adds tab to US4 detail page

### Parallel Opportunities

- T004 + T005 can run in parallel (types and validation, no dependencies)
- T027, T028 can run in parallel (form components for US1)
- T047, T053 can run in parallel (detail page and status badge)
- T064 + T065 can run in parallel (E2E plan and OpenAPI spec)
- T067, T068, T069, T070 can run in parallel (CI checks)

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational
3. Complete Phase 3: US1 (Register Client)
4. **STOP and VALIDATE**: Test US1 independently
5. Deploy/demo if ready

### Incremental Delivery

1. Setup + Foundational → Foundation ready
2. US1 → Test → Deploy (MVP!)
3. US3 → Test → Deploy
4. US2 → Test → Deploy
5. US4 → Test → Deploy (client detail + history)
6. US5 → Test → Deploy
7. US6 → Test → Deploy
8. Polish → Final Release

---

## Notes

- **[P]** tasks = different files, no dependencies - safe to parallelize
- **[Story]** label maps task to specific user story for traceability
- Each user story is independently testable
- Commit after each phase or logical grouping
- Stop at checkpoints to validate story independently
- AUDIT logging required for all state changes and profile updates (FR-011)
- Unique client ID generation must be atomic to prevent race conditions
- Professional access rule enforced at service layer (BR-10.01)
- INACTIVE/ARCHIVED clients blocked from booking — coordinated with feature 005
- Progress overview graceful degradation: null values if Session Notes/Intervention Plan not yet implemented