# Tasks: Session Management

**Input**: Design documents from `/specs/005-session-mgmt/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), data-model.md, contracts/api.md

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2)
- Include exact file paths in descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [ ] T001 Add Session model, SessionStatus enum to `prisma/schema.prisma` (see plan.md data model section)
- [ ] T002 Generate Prisma migration: `npx prisma migrate dev --name add_session_management`
- [ ] T003 Generate Prisma client: `npx prisma generate`
- [ ] T004 [P] Create TypeScript types for Session and SessionStatus in `src/types/session.ts`
- [ ] T005 [P] Create Zod validation schemas in `src/services/session/validation.ts` (slotDate, startTime, endTime, status transitions, rejection reason max 500)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [ ] T006 Create `src/services/session/double-booking-check.ts` with atomic double-booking prevention using SERIALIZABLE transaction (see plan.md algorithm)
- [ ] T007 Create `src/services/session/session.service.ts` with create, read, list, all status transitions, AUDIT logging
- [ ] T008 Implement session status transition validation in session.service.ts — enforce valid transitions only (data-model.md rules)
- [ ] T009 Implement client INACTIVE blocking in create() — return 403 if client.status != ACTIVE (FR-008 coordination with feature 004)
- [ ] T010 Implement professional off-day validation in create() — check ProfessionalOffDay and reject 400 if off-day on slotDate
- [ ] T011 Implement holiday validation in create() — check practice holidays and reject 400 if slotDate is holiday (BR-05.05)
- [ ] T012 Add AUDIT logging for all status transitions in session.service.ts
- [ ] T013 Create `GET /api/v1/sessions` endpoint in `src/app/api/v1/sessions/route.ts` with pagination, status/client/professional/service/dateFrom/dateTo filters
- [ ] T014 Create `POST /api/v1/sessions` endpoint in `src/app/api/v1/sessions/route.ts` supporting both client booking (creates PENDING) and staff booking (creates BOOKED directly)
- [ ] T015 Create `GET /api/v1/sessions/[id]` endpoint in `src/app/api/v1/sessions/[id]/route.ts`
- [ ] T016 Create `POST /api/v1/sessions/[id]/approve` endpoint in `src/app/api/v1/sessions/[id]/approve/route.ts` (PENDING → BOOKED, sends confirmation)
- [ ] T017 Create `POST /api/v1/sessions/[id]/reject` endpoint in `src/app/api/v1/sessions/[id]/reject/route.ts` (PENDING → REJECTED, reason required)
- [ ] T018 Create `POST /api/v1/sessions/[id]/check-in` endpoint in `src/app/api/v1/sessions/[id]/check-in/route.ts` (BOOKED → CHECK_IN)
- [ ] T019 Create `POST /api/v1/sessions/[id]/check-out` endpoint in `src/app/api/v1/sessions/[id]/check-out/route.ts` (CHECK_IN → CHECK_OUT)
- [ ] T020 Create `POST /api/v1/sessions/[id]/cancel` endpoint in `src/app/api/v1/sessions/[id]/cancel/route.ts` (PENDING/BOOKED → CANCELLED, reason optional)
- [ ] T021 Create `GET /api/v1/sessions/calendar` endpoint in `src/app/api/v1/sessions/calendar/route.ts` with day/week/month view and date parameter
- [ ] T022 Create `GET /api/v1/sessions/pending` endpoint for professional's pending requests
- [ ] T023 Add RBAC authorization checks to all session endpoints using existing auth helpers
- [ ] T024 Write unit tests in `tests/unit/session/session.service.test.ts` covering all status transitions and validation rules
- [ ] T025 Write unit tests in `tests/unit/session/double-booking-check.test.ts` covering overlap detection and transaction behavior
- [ ] T026 Write unit tests in `tests/unit/session/validation.test.ts` covering all Zod schemas

**Checkpoint**: Foundation ready - user story implementation can now begin

---

## Phase 3: User Story 1 - Client Books a Session (Priority: P1) 🎯 MVP

**Goal**: Client can book a session and see it in PENDING status with approval pending

**Independent Test**: Client selects professional, service, date, time → submits booking → sees PENDING confirmation → professional receives notification

### Implementation

- [ ] T027 [US1] Implement client booking path in POST /sessions — creates PENDING session, sends notification to professional
- [ ] T028 [US1] Add 403 response for INACTIVE client accounts (FR-008 coordination)
- [ ] T029 [US1] Add 409 response for slot no longer available (double-booking caught at transaction time)
- [ ] T030 [US1] Add 400 response for off-day or holiday slot (second-layer validation)
- [ ] T031 [US1] Add integration test in `tests/integration/session/client-booking.test.ts` covering happy path, inactive client, slot unavailable, off-day rejection
- [ ] T032 [US1] Verify booking submission completes and shows PENDING within 10 seconds (SC-001)

---

## Phase 4: User Story 2 - Professional Approves/Rejects (Priority: P1)

**Goal**: Professional can view pending requests and approve/reject with notifications

**Independent Test**: Professional views pending → approves one → sees BOOKED in calendar → client receives confirmation

### Implementation

- [ ] T033 [US2] Implement approval in POST /approve — changes PENDING → BOOKED, sends client confirmation email
- [ ] T034 [US2] Implement rejection in POST /reject — changes PENDING → REJECTED, reason required, sends client notification
- [ ] T035 [US2] Add 400 response when session not in PENDING status
- [ ] T036 [US2] Add 403 response when professional does not own the session
- [ ] T037 [US2] Create pending requests component in `src/components/session/pending-requests.tsx` for professional dashboard
- [ ] T038 [US2] Create professional sessions page at `src/app/(dashboard)/professional/sessions/page.tsx`
- [ ] T039 [US2] Add integration test in `tests/integration/session/approve-reject.test.ts` covering approve, reject, invalid status, unauthorized
- [ ] T040 [US2] Verify approval propagation to calendar within 5 seconds (SC-002)

---

## Phase 5: User Story 3 - Staff Books for Client (Priority: P1)

**Goal**: Receptionist can book a session directly (BOOKED), bypassing approval

**Independent Test**: Receptionist selects client, professional, service, date, time → submits → sees BOOKED confirmation → client notified

### Implementation

- [ ] T041 [US3] Implement staff booking path in POST /sessions — creates BOOKED session directly (createdBy = receptionist), sends confirmation
- [ ] T042 [US3] Detect staff booking vs client booking from JWT role: if RECEPTIONIST/CLINIC_ADMIN/SUPER_ADMIN → BOOKED; else → PENDING
- [ ] T043 [US3] Create session booking form in `src/components/session/session-form.tsx` with client, professional, service, date, time selectors
- [ ] T044 [US3] Add integration test in `tests/integration/session/staff-booking.test.ts` covering direct BOOKED creation and double-booking rejection
- [ ] T045 [US3] Verify double-booking check returns 409 within 1 second (SC-003)

---

## Phase 6: User Story 4 - Check In and Check Out (Priority: P1)

**Goal**: Receptionist can check in and check out sessions to progress the lifecycle

**Independent Test**: Receptionist checks in BOOKED session → sees CHECK_IN → checks out → sees CHECK_OUT

### Implementation

- [ ] T046 [US4] Implement check-in in POST /check-in — changes BOOKED → CHECK_IN, logs checkedInAt timestamp
- [ ] T047 [US4] Implement check-out in POST /check-out — changes CHECK_IN → CHECK_OUT, logs checkedOutAt timestamp
- [ ] T048 [US4] Add 400 response when session not in correct status for transition
- [ ] T049 [US4] Create status badges in `src/components/session/status-badge.tsx` with color coding (PENDING=yellow, BOOKED=green, CHECK_IN=blue, CHECK_OUT=purple, COMPLETED=gray, REJECTED=red, CANCELLED=gray)
- [ ] T050 [US4] Add integration test in `tests/integration/session/check-in-out.test.ts` covering check-in, check-out, invalid transition rejection
- [ ] T051 [US4] Verify status transitions reflect immediately in calendar (SC-004)

---

## Phase 7: User Story 5 - Cancel a Session (Priority: P1)

**Goal**: Client or Receptionist can cancel a PENDING or BOOKED session

**Independent Test**: Client cancels PENDING session → sees CANCELLED → professional notified → session disappears from calendar

### Implementation

- [ ] T052 [US5] Implement cancel in POST /cancel — changes PENDING/BOOKED → CANCELLED, optional reason, notifies professional
- [ ] T053 [US5] Add 400 response when session is in CHECK_IN or later status (cannot cancel in-progress)
- [ ] T054 [US5] Add 403 response when client tries to cancel another client's session
- [ ] T055 [US5] Add integration test in `tests/integration/session/cancel.test.ts` covering cancel from PENDING, cancel from BOOKED, cancel from CHECK_IN (rejected)
- [ ] T056 [US5] Verify cancellation reflects immediately in calendar (SC-004)

---

## Phase 8: User Story 6 - View Calendar (Priority: P1)

**Goal**: Staff and professionals can view sessions in day/week/month calendar views

**Independent Test**: View "Today" calendar → see all sessions with status colors, client names, professional names → switch to Week view → see week sessions

### Implementation

- [ ] T057 [US6] Implement calendar endpoint with day/week/month views and session grouping
- [ ] T058 [US6] Create calendar component in `src/components/session/session-calendar.tsx` with day/week/month view switching
- [ ] T059 [US6] Create admin sessions calendar page at `src/app/(dashboard)/admin/sessions/page.tsx`
- [ ] T060 [US6] Add URL-based view persistence (view=day|week|month, date=YYYY-MM-DD)
- [ ] T061 [US6] Verify calendar renders 50 sessions within 2 seconds (SC-006)

---

## Phase 9: User Story 7 - View Session Details (Priority: P1)

**Goal**: Staff can view full session details including client, professional, service, times, status

**Independent Test**: Click session in calendar → see all details in side panel

### Implementation

- [ ] T062 [US7] Create session detail panel in `src/components/session/session-detail-panel.tsx` showing: client name/contact, professional name, service/duration, slot times, status timestamp, notes link
- [ ] T063 [US7] Add "No session selected" empty state
- [ ] T064 [US7] Integrate detail panel into calendar page as a slide-over or modal

---

## Phase 10: User Story 8 - Filter Sessions (Priority: P2)

**Goal**: Staff can filter session list/calendar by status, date range, professional, client, service

**Independent Test**: Filter by PENDING status → see only pending requests → filter by date range → see only that range

### Implementation

- [ ] T065 [US8] Create session filters component in `src/components/session/filters.tsx` with status chips, date range picker, professional select, client select, service select
- [ ] T066 [US8] Add URL-based filter persistence in session list page
- [ ] T067 [US8] Verify filters work on both list view and calendar view

---

## Phase 11: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [ ] T068 [P] Create E2E test plan markdown at `docs/testing/session-mgmt-e2e-plan.md` covering: client booking, approval workflow, staff booking, check-in/out, cancel, calendar view
- [ ] T069 [P] Add OPENAPI 3.0 spec entries for all session endpoints in `docs/api/openapi.yaml`
- [ ] T070 Create auto-completion background job in `jobs/session-auto-complete.ts` — runs hourly, marks CHECK_OUT sessions > 24h as COMPLETED
- [ ] T070b [P] [US4] Add integration test in `tests/integration/session/auto-complete.test.ts` verifying CHECK_OUT sessions older than 24 hours are marked COMPLETED by the auto-completion job (FR-008, SC-007)
- [ ] T071 Verify all AUDIT events are logged: session.created, session.status_changed, session.cancelled, session.rejected
- [ ] T072 Implement professional off-day invalidation: when off-day updated (feature 002), auto-cancel PENDING sessions on affected dates
- [ ] T073 Run ESLint and Prettier on all new files
- [ ] T074 Run TypeScript strict mode check: `npx tsc --strict`
- [ ] T075 Run full test suite: `npm test`
- [ ] T076 Run production build: `npm run build`
- [ ] T077 Create PR to main with feature description and checklist of completed items

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3-10)**: All depend on Foundational phase completion; US2-US7 can start after US1 completes; US8 independent
- **Polish (Phase 11)**: Depends on all user stories being complete

### User Story Dependencies

- **US1 (P1)**: Independent - foundational prerequisites only
- **US2 (P2)**: Depends on US1 (session entity and approve endpoint exist)
- **US3 (P1)**: Independent after foundational
- **US4 (P2)**: Depends on US1 (check-in/check-out endpoints exist)
- **US5 (P2)**: Depends on US1 (cancel endpoint exists)
- **US6 (P1)**: Independent after foundational; uses calendar endpoint
- **US7 (P1)**: Independent after foundational; uses detail panel
- **US8 (P2)**: Independent after foundational; adds filters on top of list/calendar

### Parallel Opportunities

- T004 + T005 can run in parallel (types and validation, no dependencies)
- T016 + T017 can run in parallel (approve and reject sub-routes)
- T018 + T019 can run in parallel (check-in and check-out sub-routes)
- T057 + T062 can run in parallel (calendar and detail panel)
- T068 + T069 can run in parallel (E2E plan and OpenAPI spec)
- T073, T074, T075, T076 can run in parallel (CI checks)

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational
3. Complete Phase 3: US1 (Client Books)
4. **STOP and VALIDATE**: Test US1 independently
5. Deploy/demo if ready

### Incremental Delivery

1. Setup + Foundational → Foundation ready
2. US1 → Test → Deploy (MVP! — client booking with approval workflow)
3. US3 → Test → Deploy (staff can book directly)
4. US2 → Test → Deploy (approval workflow completes)
5. US4 → Test → Deploy (check-in/out operational)
6. US5 → Test → Deploy (cancellation)
7. US6 + US7 → Test → Deploy (calendar and details)
8. US8 → Test → Deploy (filters)
9. Polish → Final Release

---

## Notes

- **[P]** tasks = different files, no dependencies - safe to parallelize
- **[Story]** label maps task to specific user story for traceability
- Each user story is independently testable
- Commit after each phase or logical grouping
- Stop at checkpoints to validate story independently
- Double-booking prevention uses SERIALIZABLE transaction - critical for data integrity
- Auto-completion job runs hourly - marks CHECK_OUT sessions > 24h as COMPLETED
- Professional off-day updates trigger PENDING session invalidation
- Session duration stored on session record - changes to Service.durationMinutes do not affect existing sessions