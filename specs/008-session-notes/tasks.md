# Tasks: Session Notes

**Input**: Design docs from `/specs/008-session-notes/`

## Format: `[ID] [P?] [US?] Description`

---

## Phase 1: Foundation

- [ ] T001 Add SessionNote model + NoteStatus enum to `prisma/schema.prisma`
- [ ] T002 Generate migration: `npx prisma migrate dev --name add_session_notes`
- [ ] T003 [P] TypeScript types in `src/types/session-note.ts`
- [ ] T004 [P] Zod schemas in `src/services/session-notes/validation.ts`
- [ ] T005 Create session-notes service in `src/services/session-notes/service.ts`
- [ ] T006 Create routes in `src/app/api/v1/session-notes/route.ts`
- [ ] T007 Write unit tests in `tests/unit/session-notes/service.test.ts`

## Phase 2: User Story 1 - Create Notes (P1)

- [ ] T008 [US1] Create notes form in `src/components/session-notes/note-form.tsx`
- [ ] T009 [US1] Integration test covering create, edit lock, status rules

## Phase 3: User Story 2 - List Notes (P1)

- [ ] T010 [US2] Create notes list in `src/components/session-notes/note-list.tsx`
- [ ] T011 [US2] Integration test covering list, search, empty state

## Phase 4: User Story 3 - Close Notes (P1)

- [ ] T012 [US3] Close endpoint + route
- [ ] T013 [US3] Read-only view after close
- [ ] T014 [US3] Integration test covering close + edit-after-close rejection

## Phase 5: User Story 4 - Print Notes (P2)

- [ ] T015 [US4] Print view in `src/app/(dashboard)/session-notes/[id]/print/page.tsx`
- [ ] T016 [US4] Print CSS + E2E test

## Phase 6: Polish

- [ ] T017 [P] E2E plan at `docs/testing/session-notes-e2e-plan.md`
- [ ] T018 Run ESLint, type-check, tests, build