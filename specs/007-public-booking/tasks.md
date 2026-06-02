# Tasks: Public Booking Portal

**Input**: Design documents from `/specs/007-public-booking/`

**Prerequisites**: plan.md (required), spec.md (required), data-model.md, contracts/

**Organization**: Tasks are grouped by user story to enable independent implementation and testing.

## Format: `[ID] [P?] [Story?] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2)
- Include exact file paths in descriptions

---

## Phase 1: Foundation (Shared Infrastructure)

**Purpose**: Wizard layout and shared components all steps depend on

- [X] T001 Create wizard layout in `src/app/(public)/book/layout.tsx` with step indicator and URL-based step tracking
- [X] T002 [P] Create `src/components/booking/wizard-step-indicator.tsx` showing current step and progress
- [X] T003 [P] Create `src/components/booking/wizard-layout.tsx` with sidebar or header step navigation
- [X] T004 Create `src/services/booking/slot-hold.service.ts` with in-memory slot hold mechanism (15-min TTL, key = professionalId+serviceId+date+startTime)
- [X] T005 Write unit tests in `tests/unit/booking/slot-hold.service.test.ts` covering hold creation, expiry, and consumption

**Checkpoint**: Foundation ready - step implementation can begin

---

## Phase 2: Step 1 - Browse Professionals (Priority: P0) 🎯 MVP

**Goal**: Visitor can browse and select a professional to book with

**Independent Test**: Visitor opens `/book` → sees professional list → selects one → URL updates → advances to Step 2

- [X] T006 [US1] Create `src/app/(public)/book/page.tsx` — Step 1: Professional listing page
- [X] T007 [US1] Create `src/components/booking/professional-card.tsx` with name, photo, type, specialties, next available slot
- [X] T008 [US1] Consume GET `/api/v1/professionals/public` to list ACTIVE professionals with slot availability
- [X] T009 [US1] Add specialty filter chips in professional list
- [X] T010 [US1] Add integration test in `tests/integration/booking/professional-list.test.ts`

---

## Phase 3: Step 2 - Select Service (Priority: P0)

**Goal**: Visitor selects a service offered by the chosen professional

**Independent Test**: Visitor on Step 2 → sees service list → selects one → advances to Step 3

- [X] T011 [US2] Create `src/app/(public)/book/[professionalId]/service/page.tsx` — Step 2: Service selection
- [X] T012 [US2] Create `src/components/booking/service-card.tsx` with name, description, duration, price
- [X] T013 [US2] Consume service list from GET `/api/v1/professionals/:id/services` (feature 002)
- [X] T014 [US2] Add integration test in `tests/integration/booking/service-select.test.ts`

---

## Phase 4: Step 3 - Pick Date/Time (Priority: P0)

**Goal**: Visitor selects an available time slot; slot is held for 15 minutes

**Independent Test**: Visitor on Step 3 → picks date → sees slots → selects one → hold created → advances to Step 4

- [X] T015 [US3] Create `src/app/(public)/book/[professionalId]/[serviceId]/page.tsx` — Step 3: Slot selection
- [X] T016 [US3] Create `src/components/booking/slot-picker.tsx` with calendar date picker and time slot grid
- [X] T017 [US3] Consume GET `/api/v1/professionals/:id/slots?date=YYYY-MM-DD&serviceId=`
- [X] T018 [US3] Implement slot hold on selection: call slot-hold service, store 15-min hold in memory
- [X] T019 [US3] Display slot hold countdown timer on Step 4
- [X] T020 [US3] Add integration test in `tests/integration/booking/slot-pick.test.ts` covering slot hold creation and countdown
- [X] T020b [P] Add unit test in `tests/unit/booking/slot-hold-ttl.test.ts` covering: hold created with 15-min TTL, hold consumed on booking, hold expired after TTL, concurrent expiry race condition (SC-004)
- [X] T021 [US3] Implement slot expiry countdown warning UI: show timer when < 5 minutes remain

---

## Phase 5: Step 4 - Client Info / Login (Priority: P0)

**Goal**: Visitor logs in or registers; booking is created as PENDING

**Independent Test**: Visitor on Step 4 → submits info → PENDING session created → advances to confirmation

- [X] T021 [US4] Create `src/app/(public)/book/[professionalId]/[serviceId]/confirm/page.tsx` — Step 4: Client info + login
- [X] T022 [US4] Create `src/components/booking/booking-form.tsx` with name, email, mobile, password fields for inline registration
- [X] T023 [US4] Create "Already have an account? Login" link triggering NextAuth login modal
- [X] T024 [US4] Implement inline registration: create WordPress user + client profile (feature 004 pattern), provision JWT, pre-fill form on success
- [X] T025 [US4] On form submit: consume POST `/api/v1/sessions` with slot details (feature 005 pattern)
- [X] T026 [US4] Display 15-min hold countdown with warning when < 5 minutes remain
- [X] T027 [US4] Handle 409 (slot unavailable) with "Slot no longer available — please select another time" message
- [X] T028 [US4] Handle 403 (inactive account) with "Account inactive — contact practice" message
- [X] T029 [US4] Add integration test in `tests/integration/booking/booking-confirm.test.ts` covering registration, login, hold expiry, double-booking rejection

---

## Phase 6: Step 5 - Confirmation (Priority: P0)

**Goal**: Visitor sees confirmed booking details and booking details

**Independent Test**: Visitor completes booking → sees confirmation with all details and next steps

- [X] T030 [US5] Create `src/app/(public)/book/confirmation/page.tsx` — Step 5: Confirmation page
- [X] T031 [US5] Create `src/components/booking/confirmation.tsx` with session summary: date, time, professional, service, status PENDING
- [X] T032 [US5] Add "Add to Calendar" button generating .ics file or Google Calendar link
- [X] T033 [US5] Show new account credentials for inline-registered clients
- [X] T034 [US5] Consume notification service for confirmation email (feature 012 placeholder until implemented)
- [X] T035 [US5] Add integration test in `tests/integration/booking/confirmation.test.ts`

---

## Phase 7: Polish & Cross-Cutting Concerns

- [X] T036 [P] Create E2E test plan markdown at `docs/testing/public-booking-e2e-plan.md` covering full wizard flow, inline registration, login, hold expiry
- [X] T037 Run ESLint and Prettier on all new files
- [X] T038 Run TypeScript strict mode check: `npx tsc --strict`
- [X] T039 Run full test suite: `npm test`
- [X] T040 Run production build: `npm run build`
- [X] T041 Create PR to main with feature description and checklist of completed items

---

## Dependencies & Execution Order

- **Phase 1**: No dependencies — starts immediately
- **Phase 2**: Depends on Phase 1
- **Phase 3**: Depends on Phase 1
- **Phase 4**: Depends on Phase 3 (need service from Step 2)
- **Phase 5**: Depends on Phase 4 (need slot hold)
- **Phase 6**: Depends on Phase 5
- **Phase 7**: Depends on all steps complete

### Parallel Opportunities

- T002, T003 can run in parallel (shared components)
- T006, T007, T008 can run in parallel (Step 1)
- T011, T012, T013 can run in parallel (Step 2)
- T037, T038, T039, T040 can run in parallel (CI checks)

---

## Notes

- **[P]** = different files, no dependencies — safe to parallelize
- Slot hold uses in-memory storage for MVP; Redis can be added later
- Email sending deferred to feature 012 — confirmation logs email for now
- Practice address deferred to feature 013 — placeholder shown until then
- "Add to Calendar" generates .ics file for MVP; Google Calendar link as enhancement