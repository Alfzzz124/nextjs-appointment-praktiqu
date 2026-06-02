---
description: "Task list for 001-auth-foundation feature implementation"
---

# Tasks: 001-auth-foundation

**Input**: Feature specification from `specs/001-auth-foundation/spec.md`

**Prerequisites**: plan.md (required), spec.md (required for user stories)

**Organization**: Tasks are grouped by user story to enable independent implementation and testing.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Foundational Setup

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [ ] T001 [P] Configure JWT library (jose) for token generation/verification
- [ ] T002 [P] Setup Prisma schema for User model extending WordPress
- [ ] T003 [P] Create WordPress authentication service (wp-auth.ts)
- [ ] T004 Create token service (jwt.ts) with access/refresh token logic
- [ ] T004a [P] Define `AuthorizationService` interface in `src/services/authorization.ts` with `can(user, action, resource): boolean` per FR-016
- [ ] T004b [P] Implement default `RbacAuthorizationService` checking role→capability matrix
- [ ] T004c [P] Write test verifying extension point is callable with permission-based action (mock custom impl)
- [ ] T005 [P] Implement rate limiting middleware for auth endpoints
- [ ] T005a [P] Create RFC 7807 error helper `src/lib/problem-details.ts` with `ProblemDetails` type + 401/403/429 constructors
- [ ] T005b [P] Write unit tests for RFC 7807 shape conformance (FR-013)
- [ ] T005c [P] Write integration test for 429 with `Retry-After` header (FR-020)

**Checkpoint**: Foundation ready - user story implementation can now begin

---

## Phase 2: User Story 1 - User Login (Priority: P1)

**Goal**: Users can authenticate with credentials and receive JWT tokens.

- [ ] T006 [US1] Write unit tests for login flow
- [ ] T007 [US1] Write integration tests for login API — cases: (a) valid creds → 200 + tokens, (b) invalid pwd → 401, (c) inactive user → 403, (d) missing field → 400 RFC7807, (e) rate-limited IP → 429 + Retry-After
- [ ] T008 [US1] Create POST /api/v1/auth/login endpoint
- [ ] T009 [US1] Implement login handler with WordPress verification
- [ ] T010 [US1] Add JWT token issuance on successful login — include test asserting `payload.role` is present per FR-018
- [ ] T011 [US1] Implement progressive rate limiting on failed attempts
- [ ] T012 [US1] Add login audit logging
- [ ] T013 [US1] Create login page UI component — reference `stitch_praktiqu_clinic_dashboard/screens/login.png` (includes "Forgot password?" link per US1 acceptance #4)

**Checkpoint**: User can login and receive valid JWT tokens

---

## Phase 3: User Story 1 - Login UI Testing

**Goal**: Verify end-to-end login flow.

- [ ] T014 [US1] Write E2E test plan for login in `docs/testing/auth-e2e-plan.md`
- [ ] T015 [US1] Execute E2E test via @vercel/agent-browser
- [ ] T016 [US1] Document E2E results in `docs/testing/auth-e2e-results.md`

---

## Phase 4: User Story 2 - Session Management & Token Refresh (Priority: P1)

**Goal**: Authenticated sessions persist with token refresh.

- [ ] T017 [US2] Write tests for token refresh — cases: (a) valid refresh → 200 + new access + rotated refresh, (b) expired refresh → 401, (c) revoked refresh → 401, (d) replayed old refresh → 401 + family revoke (FR-015), (e) cross-device refresh does NOT invalidate other devices
- [ ] T018 [US2] Write tests for logout — cases: (a) valid access → 204 + refresh revoked, (b) old refresh post-logout → 401, (c) double-logout → 204 idempotent, (d) unauthenticated logout → 401
- [ ] T019 [US2] Create POST /api/v1/auth/refresh endpoint
- [ ] T020 [US2] Create POST /api/v1/auth/logout endpoint
- [ ] T021 [US2] Implement refresh token rotation
- [ ] T022 [US2] Implement refresh token invalidation on logout
- [ ] T023 [US2] Create GET /api/v1/auth/me endpoint
- [ ] T023a [US2] Write E2E test plan for logout in `docs/testing/logout-e2e-plan.md`
- [ ] T023b [US2] Execute logout E2E test via @vercel/agent-browser
- [ ] T023c [US2] Document logout E2E results in `docs/testing/logout-e2e-results.md`

---

## Phase 4.5: User Story 5 — Role-Based Access Control (Priority: P1)

**Goal**: Enforce 5-role RBAC across all protected endpoints per FR-008/FR-009.

- [ ] T046 [US5] Define role→capability matrix in `src/services/authorization.ts` per spec B1
- [ ] T047 [US5] Implement RBAC middleware returning RFC 7807 403 on denial
- [ ] T048 [US5] Write unit tests per role × endpoint matrix
- [ ] T049 [US5] Write integration tests for cross-role access attempts (PROFESSIONAL hits SUPER_ADMIN route → 403, etc.)

**Checkpoint**: 5-role RBAC enforced; 403 returned on unauthorized access

---

## Phase 5: User Story 3 - Social Login (Google) (Priority: P2)

**Goal**: Users can authenticate via Google OAuth.

- [ ] T024 [P] [US3] Configure Google OAuth provider in NextAuth
- [ ] T025 [US3] Write tests for OAuth callback handling — cases: (a) new Google user → CLIENT account + tokens, (b) linked existing user → original role + tokens, (c) Google email mismatch with no link → auto-create CLIENT, (d) Google error → 400 RFC7807
- [ ] T026 [US3] Create Google OAuth integration with WordPress user linking
- [ ] T027 [US3] Implement auto-creation of Client account for new Google users
- [ ] T028 [US3] Create Google login button and flow — reference `stitch_praktiqu_clinic_dashboard/components/oauth-buttons.png`
- [ ] T028a [US3] Write E2E test plan for Google sign-in in `docs/testing/google-signin-e2e-plan.md`
- [ ] T028b [US3] Execute Google sign-in E2E test
- [ ] T028c [US3] Document results in `docs/testing/google-signin-e2e-results.md`

**Checkpoint**: User can login with Google and receive PraktiQu tokens

---

## Phase 6: User Story 4 - Password Management (Priority: P2)

**Goal**: Users can change passwords and reset forgotten ones.

- [ ] T029 [US4] Write tests for password change — cases: (a) correct current pwd → 200 + new tokens, all refresh revoked, (b) wrong current pwd → 401, (c) weak new pwd → 400, (d) unauthenticated → 401
- [ ] T030 [US4] Write tests for password reset request — cases: (a) known email → 200 (always, no enumeration) + email sent, (b) unknown email → 200 (no enumeration), (c) rate limit → 429
- [ ] T031 [US4] Create POST /api/v1/auth/forgot-password endpoint
- [ ] T032 [US4] Create POST /api/v1/auth/reset-password endpoint
- [ ] T033 [US4] Implement secure reset token generation (30-min expiry)
- [ ] T034 [US4] Implement email sending — integrate Resend (transactional, free tier) for password reset emails via `RESEND_API_KEY` env. Fallback: log to console with structured `email.delivery_failed` event per U8.
- [ ] T035 [US4] Create password reset flow UI components — reference `stitch_praktiqu_clinic_dashboard/screens/forgot-password.png` and `reset-password.png`
- [ ] T043 [US4] Create POST /api/v1/auth/change-password endpoint (authenticated; validates current password, updates in WordPress, invalidates all refresh tokens per FR-006)
- [ ] T044 [US4] Write tests for change-password flow (correct current → 200 + new tokens; wrong current → 401; weak new pwd → 400; unauth → 401)
- [ ] T045 [US4] Invalidate all refresh tokens for user on successful change per FR-006
- [ ] T061 [US4] Create POST /api/v1/auth/register endpoint per FR-022 — rate-limited (FR-019), 201 with `{ userId }` (no tokens), 400 on weak pwd, 409 on duplicate email, 429 on rate limit
- [ ] T062 [US4] Write tests for register flow (valid → 201; weak pwd → 400; duplicate email → 409; rate-limited IP → 429; missing fields → 400 RFC7807)

---

## Phase 5.5: User Story 6 — Audit Logging (Priority: P2)

**Goal**: Persist all security events per FR-010/011/012/022.

- [ ] T050 [US6] Create audit service (`src/services/audit.ts`) with typed event schemas per FR-010
- [ ] T051 [US6] Wire audit writes to: login (T012), logout (T022), refresh (T021), password change/reset (T031, T032, T045), role change (T052)
- [ ] T052 [US6] Implement PATCH /api/v1/admin/users/:id/role per FR-020 (SUPER_ADMIN only)
- [ ] T053 [US6] Implement GET /api/v1/admin/audit paginated endpoint (SUPER_ADMIN only) per FR-021
- [ ] T054 [US6] Write test: audit log row persisted before HTTP response sent (SC-008)
- [ ] T055 [US6] Write test: audit metadata schema validates per FR-010 event types

**Checkpoint**: User can change/reset their password

---

## Phase 6.5: PraktiQU Webhook Receiver (Priority: P1)

**Purpose**: Receive and act on signed state-change events from the `praktiqu-endpoint` WordPress plugin. Addresses FR-023…FR-027 (credential staleness gap from C4).

**Goal**: PraktiQU can react to WP-side changes (password reset, role change, deactivation, deletion) within the 60-second propagation SLO without polling.

- [ ] TW01 [P] Write tests for webhook receiver — cases: (a) valid signature → 200 + action triggered, (b) missing signature → 401 RFC7807, (c) invalid signature → 401, (d) replayed payload (same event ID) → 200 + idempotent no-op, (e) `password.changed` → all tokens revoked + cache cleared, (f) `user.deactivated` → tokens revoked + audit logged, (g) `user.role_changed` → role cache invalidated, (h) `user.deleted` → User.status=0 + tokens revoked, (i) `login.failed` → audit event appended, (j) WP down → 503 from our side if we ever call them upstream (not now; they're the callee)
- [ ] TW02 [P] Write tests: idempotency — same `event`+`wpUserId`+`issuedAt` (within 5s window) must not trigger double revocation
- [ ] TW03 Create `POST /api/v1/webhooks/wordpress` endpoint
- [ ] TW04 Implement HMAC-SHA256 signature verification (constant-time `crypto.timingSafeEqual`) per FR-025; reject missing or invalid with 401 RFC7807
- [ ] TW05 Store `eventId` in idempotency table (`WordpressWebhookEvent` model); skip if already `received` or `processed` within 5-second window
- [ ] TW06 Implement `password.changed` handler: revoke all refresh tokens for user; delete cached WP identity
- [ ] TW07 Implement `user.deactivated` handler: revoke all refresh tokens; next refresh returns `account_inactive` error
- [ ] TW08 Implement `user.deleted` handler: set `User.status = 0`; revoke all tokens
- [ ] TW09 Implement `user.role_changed` handler: invalidate role cache for user; next access-token refresh reads fresh role from database
- [ ] TW10 Implement `login.failed` handler: append audit event `login.failure` with `reason: 'wp_reported'`
- [ ] TW11 Implement `user.reactivated` handler: no automatic action; log event; new logins allowed (no fresh tokens needed)
- [ ] TW12 Log all received events to audit (`eventType: 'webhook.received'`) per FR-026 before processing
- [ ] TW13 Add `WordpressWebhookEvent` Prisma model for idempotency + replay protection
- [ ] TW14 Write E2E test plan for webhook end-to-end (WP side triggers → PraktiQU receives → tokens revoked) — coordinate with WP plugin author
- [ ] TW15 Run full CI/CD pipeline verification

**Dependencies**: Phase 1 (rate limiting, RFC 7807 helpers, Redis); Phase 4.5 (RBAC middleware)

**Checkpoint**: WP-side password reset causes PraktiQU session to end on next request within 60 seconds

---

## Phase 7: Polish & Cross-Cutting

**Purpose**: Improvements that affect multiple user stories.

- [ ] T036 [P] Add documentation set: `docs/auth/architecture.md` (component diagram), `docs/auth/runbook.md` (env vars, deployment, rollback), `docs/auth/security.md` (threat model per OWASP ASVS)
- [ ] T037 Update `specs/001-auth-foundation/checklists/completion.md` against spec.md FR-001…FR-022 with pass/fail per requirement
- [ ] T038 Run full CI/CD pipeline verification
- [ ] T039 [P] Add unit tests for edge cases: token-expiry-during-request, concurrent logins, role-degradation-mid-session, session-fixation, reset-token-reuse, reset-link-expired, RFC 7807 503 from WP-down
- [ ] T040 Security hardening review against OWASP ASVS Level 2 checklist `docs/auth/security-checklist.md`; all items resolved or documented as accepted risk
- [ ] T041 Configure Vitest coverage threshold ≥80% (lines, branches, functions) in `vitest.config.ts`; fail CI below threshold.
- [ ] T042 Generate OpenAPI 3.0 spec for `/api/v1/auth/*` via `zod-to-openapi`; serve at `/docs/api` per Constitution.
- [ ] T056 Add Vitest benchmark: login endpoint p95 < 3s (SC-001)
- [ ] T057 Add Vitest benchmark: token refresh p95 < 1s (SC-002)
- [ ] T058 Add Vitest benchmark: RBAC middleware p95 < 100ms (SC-006)
- [ ] T059 Add Vitest benchmark: JWT validation p95 < 50ms (SC-009)
- [ ] T060 Add k6 load test: 1000 concurrent auth requests, p95 < 3s (SC-007)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Foundational (Phase 1)**: No dependencies - START HERE
- **User Story 1 — Login (Phase 2-3)**: Depends on Foundational
- **User Story 2 — Session Management & Token Refresh (Phase 4)**: Depends on Foundational + US1 (T008 endpoint pattern)
- **User Story 3 — Social Login (Phase 5)**: Depends on Foundational
- **User Story 4 — Password Management (Phase 6)**: Depends on Foundational
- **User Story 5 — RBAC (Phase 4.5)**: Depends on Foundational; can run parallel to US2-US4
- **User Story 6 — Audit Logging (Phase 5.5)**: Depends on Foundational + US5 (uses role checks)
- **Polish (Phase 7)**: Depends on US1-US6

### User Story Dependencies

- User Story 1 is BLOCKING for all other stories (MVP requirement)
- User Stories 2, 3, 4, 5 can proceed in parallel after Foundational
- User Story 6 (Audit) depends on US5 (uses role checks)

### Within Each User Story

- Tests MUST be written and FAIL before implementation
- Core implementation before UI components
- Story complete before moving to next priority

---

## Parallel Example

```bash
# Launch all Foundational tasks together:
Task: "Configure JWT library (jose)"
Task: "Setup Prisma schema for User model"
Task: "Create WordPress authentication service"
Task: "Implement rate limiting middleware"
```
