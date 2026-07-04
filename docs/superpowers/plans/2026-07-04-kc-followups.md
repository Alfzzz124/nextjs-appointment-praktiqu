# KiviCare Followups (Slice 8c) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add the Pro Followups module — followup chains, followups (with complete/cancel/bulk-status/due), reminders (rule CRUD + immediate email send), and an activity log — at `/api/v1/followups`, `/api/v1/followup-chains`, `/api/v1/followup-reminders`, following the KC billing pattern.

**Architecture:** KC raw-SQL pattern (`withAuth` + `kcHandle` + `assertCan` + `resolveKcActor` + scope). Pure parameterized raw SQL over the 4 `wp_kc_followup*` tables. Direct-column scope (`clinic_id`/`doctor_id`). Status changes write an activity-log row. Reminder rules are CRUD; `POST /followups/{id}/send-reminder` sends **email** immediately via the existing `sendEmail` (`src/lib/email.ts`, Resend with dev-logging fallback); sms/push and scheduled/offset dispatch return 501.

**Tech Stack:** Next.js 14 App Router, TS strict, Prisma 5 + MySQL (raw SQL), Zod, Vitest. **Branch:** `feat/kc-followups` (created from `main`).

## CONFIRMED live schema (all 0 rows)
```
wp_kc_followups: id, clinic_id(NN), doctor_id(NN), patient_id(NN), encounter_id?, chain_id(NN),
  parent_followup_id?, reason(text NN), priority enum('routine','important','urgent') dflt routine,
  status enum('pending','scheduled','completed','missed','cancelled') dflt pending,
  created_at_utc(NN), suggested_date_utc(NN), suggested_deadline_utc(NN),
  scheduled_appointment_id?, completed_at_utc?, cancelled_at_utc?, metadata(longtext)?, created_by?, updated_at_utc?, updated_by?
wp_kc_followup_chains: id, clinic_id(NN), patient_id(NN), doctor_id(NN), diagnosis_id?, name(varchar255)?,
  status enum('active','closed','on_hold') dflt active, created_at_utc(NN), closed_at_utc?, closed_by?
wp_kc_followup_reminders: id, followup_id(NN), reminder_type(varchar50 NN), offset_days(int NN dflt 0),
  channel enum('sms','email','push') NN dflt email, action_id?, processed_at?
wp_kc_followup_activity_log: id, followup_id(NN), user_id(NN), action(varchar50 NN), old_status?, new_status?, note(text)?, created_at_utc(NN)
```
Note: `chain_id` is NOT NULL — **a followup must belong to a chain** (create requires a valid in-scope chain).

## Endpoints
Chains (`/api/v1/followup-chains`): GET list, POST create, GET/{id} (+ its followups), PUT/{id}.
Followups (`/api/v1/followups`): GET list, POST create, GET/{id}, PUT/{id}, DELETE/{id}, POST/{id}/complete, POST/{id}/cancel, POST bulk/status, GET due, GET/{id}/activity.
Reminders: GET `/followups/{id}/reminders`, POST `/followups/{id}/reminders`, DELETE `/followup-reminders/{id}`, POST `/followups/{id}/send-reminder`.

## Scope (`followupScopeFor`)
```ts
export interface FollowupScope { clinicId?: bigint; doctorId?: bigint } // null = SUPER_ADMIN
// SUPER_ADMIN → null; CLINIC_ADMIN/RECEPTIONIST → { clinicId }; PROFESSIONAL → { doctorId }; default → { clinicId: -1n }
```
Applied directly to followups + chains (both have clinic_id/doctor_id). Reminders + activity scope by joining their parent followup. On create: non-super clinic forced to `kc.clinicId`; PROFESSIONAL doctor forced to self.

## Capabilities
```
followup_read:   ['SUPER_ADMIN','CLINIC_ADMIN','PROFESSIONAL','RECEPTIONIST']
followup_manage: ['SUPER_ADMIN','CLINIC_ADMIN','PROFESSIONAL']
```
(CLIENT excluded — followups are a provider workflow.)

## DB SAFETY
Only the live `wordpress-praktiqu` DB exists — no test DB. DB-backed tests MUST NOT run here; keep `assertTestDb()` intact. No migrations. All datetimes stored in UTC (`*_utc` columns) via `UTC_TIMESTAMP()`.

---

### Task 1: Capabilities + validation + scope + activity-log helper

**Files:** modify `kc-permissions.ts`, `validation.ts`; create `src/services/billing/followup-scope.ts`; extend `tests/billing/kc-permissions.test.ts`.

- [ ] **Step 1: Capabilities** — add `followup_read` / `followup_manage` (roles above) to the union + MATRIX.

- [ ] **Step 2: Validation** (`validation.ts`):
```ts
export const FOLLOWUP_PRIORITY = ['routine','important','urgent'] as const;
export const FOLLOWUP_STATUS = ['pending','scheduled','completed','missed','cancelled'] as const;
export const CHAIN_STATUS = ['active','closed','on_hold'] as const;
const DT = z.string().min(1); // ISO datetime or 'YYYY-MM-DD HH:mm:ss'

export const chainListQuerySchema = z.object({ page: z.coerce.number().int().min(1).default(1), perPage: z.union([z.coerce.number().int().min(1).max(100), z.literal('all')]).default(10), patientId: z.coerce.number().int().optional(), doctorId: z.coerce.number().int().optional(), status: z.enum(CHAIN_STATUS).optional() });
export const chainCreateSchema = z.object({ patientId: z.coerce.number().int(), doctorId: z.coerce.number().int().optional(), clinicId: z.coerce.number().int().optional(), name: z.string().max(255).optional(), diagnosisId: z.coerce.number().int().optional() });
export const chainUpdateSchema = z.object({ name: z.string().max(255).optional(), status: z.enum(CHAIN_STATUS).optional() }).strict();

export const followupListQuerySchema = z.object({ page: z.coerce.number().int().min(1).default(1), perPage: z.union([z.coerce.number().int().min(1).max(100), z.literal('all')]).default(10), chainId: z.coerce.number().int().optional(), patientId: z.coerce.number().int().optional(), doctorId: z.coerce.number().int().optional(), status: z.enum(FOLLOWUP_STATUS).optional(), priority: z.enum(FOLLOWUP_PRIORITY).optional() });
export const followupCreateSchema = z.object({ chainId: z.coerce.number().int(), patientId: z.coerce.number().int(), doctorId: z.coerce.number().int().optional(), clinicId: z.coerce.number().int().optional(), encounterId: z.coerce.number().int().optional(), parentFollowupId: z.coerce.number().int().optional(), reason: z.string().min(1).max(5000), priority: z.enum(FOLLOWUP_PRIORITY).default('routine'), suggestedDate: DT, suggestedDeadline: DT, metadata: z.string().max(5000).optional() });
export const followupUpdateSchema = z.object({ reason: z.string().min(1).max(5000).optional(), priority: z.enum(FOLLOWUP_PRIORITY).optional(), status: z.enum(FOLLOWUP_STATUS).optional(), suggestedDate: DT.optional(), suggestedDeadline: DT.optional() }).strict();
export const followupStatusSchema = z.object({ status: z.enum(FOLLOWUP_STATUS), note: z.string().max(1000).optional() });
export const followupBulkStatusSchema = z.object({ ids: z.array(z.coerce.number().int()).min(1), status: z.enum(FOLLOWUP_STATUS), note: z.string().max(1000).optional() });
export const reminderCreateSchema = z.object({ reminderType: z.string().min(1).max(50), offsetDays: z.coerce.number().int().min(0).max(365).default(0), channel: z.enum(['sms','email','push']).default('email') });
```

- [ ] **Step 3: `src/services/billing/followup-scope.ts`** — `FollowupScope` + `followupScopeFor(kc)` (code above).

- [ ] **Step 4: Capability test** in `kc-permissions.test.ts` (manage: PROFESSIONAL yes, RECEPTIONIST no; read: RECEPTIONIST yes, CLIENT no). Run `npx vitest run tests/billing/kc-permissions.test.ts` → PASS.

- [ ] **Step 5: Commit** `feat(followups): capabilities, validation, scope helper`.

---

### Task 2: Chain + followup service (core)

**Files:** create `src/services/billing/followup.service.ts`. Reference `encounter.service.ts` (direct-column scope), `doctor-session.service.ts` (raw INSERT + LAST_INSERT_ID).

Includes a shared `logActivity(followupId, userId, action, oldStatus, newStatus, note)` (raw INSERT into `wp_kc_followup_activity_log`, `created_at_utc = UTC_TIMESTAMP()`), and:

- Chains: `listChains`, `getChain` (with `followups: [...]`), `createChain(input, kc)` (clinic forced non-super; doctor forced for PROFESSIONAL; `created_at_utc=UTC_TIMESTAMP()`, status 'active'), `updateChain` (name/status; setting status='closed' sets `closed_at_utc`/`closed_by`). Scope predicate on `clinic_id`/`doctor_id`.
- Followups: `listFollowups`, `getFollowup`, `createFollowup(input, kc)` — **validates the chain is in scope** (`assertChainInScope`), forces clinic/doctor for non-super, inserts all NN columns (`created_at_utc`, `suggested_date_utc`, `suggested_deadline_utc` from input, `status='pending'`, `created_by=kc.wpUserId`), then `logActivity(id, kc.wpUserId, 'created', null, 'pending')`.
- `updateFollowup(id, input, kc)` — scope-check via getFollowup; if `status` changes, write `updated_at_utc`/`updated_by` and `logActivity(..., 'updated', old, new)`.
- `completeFollowup(id, note, kc)` — status→'completed', `completed_at_utc=UTC_TIMESTAMP()`, logActivity('completed', old, 'completed', note). `cancelFollowup` similarly (→'cancelled', `cancelled_at_utc`).
- `deleteFollowup(id, kc)` — scope-check then DELETE (also delete its reminders + activity rows, or rely on no FK; do explicit cleanup DELETEs to avoid orphans).
- `bulkSetFollowupStatus(ids, status, note, kc)` — resolve in-scope ids first (join), UPDATE, logActivity per row.
- `listDueFollowups(kc)` — `status IN ('pending','scheduled') AND suggested_deadline_utc <= UTC_TIMESTAMP()`, scoped, ordered by deadline asc.
- `listActivity(followupId, kc)` — scope-check parent, return activity rows.

All values bound `?`. `getFollowup(id, scope)` = scope WHERE + `AND id = ?` (404 out-of-scope). Provide full code following the established service style (mapRow helpers per entity; `scopeClause(scope, alias)` returning `{sql,args}`).

- [ ] **Step 1:** write the service. **Step 2:** `npx tsc --noEmit | grep followup.service` → clean. **Step 3:** commit `feat(followups): chain + followup service (CRUD, complete/cancel, bulk, due, activity log)`.

---

### Task 3: Reminder service + immediate email send

**Files:** modify `followup.service.ts` (or new `followup-reminder.service.ts`). Reuse `sendEmail` from `@/lib/email` and read the followup's patient email (join `wp_users pt ON f.patient_id = pt.ID`).

- `listReminders(followupId, kc)` — scope-check parent followup, return its reminder rows.
- `createReminder(followupId, input, kc)` — scope-check parent; INSERT (`reminder_type`, `offset_days`, `channel`); `action_id`/`processed_at` null. Return `{ id }`.
- `deleteReminder(reminderId, kc)` — join to parent followup for scope-check, then DELETE.
- `sendReminderNow(followupId, kc)` — scope-check; load followup + patient email + clinic name; for each `channel='email'` reminder (or a single immediate email if none), call `sendEmail({ to: patientEmail, subject, html, text, template:'followup_reminder' })`; set `processed_at=UTC_TIMESTAMP()` on sent email reminders; `logActivity(followupId, kc.wpUserId, 'reminder_sent', null, null, note)`. For `channel` in ('sms','push'), throw `KcError('SMS/push reminder delivery is not yet configured', 501)`. If the followup has no email reminder rule, still send one immediate email (reason: manual send) — or return a clear message; pick one and document. Return `{ sent: n, channelsSkipped: [...] }`.

> IMPLEMENTER: `sendEmail` never throws and dev-logs when `RESEND_API_KEY` is unset — safe in any env. Do NOT block on its result beyond recording `processed_at` when `ok`.

- [ ] **Step 1:** write. **Step 2:** tsc clean. **Step 3:** commit `feat(followups): reminder rule CRUD + immediate email send (sms/push 501)`.

---

### Task 4: Chain + followup routes

**Files (base `src/app/api/v1/`):**
- `followup-chains/route.ts` (GET list `followup_read`, POST create `followup_manage`)
- `followup-chains/[id]/route.ts` (GET read, PUT manage)
- `followups/route.ts` (GET list, POST create)
- `followups/[id]/route.ts` (GET read, PUT manage, DELETE manage)
- `followups/[id]/complete/route.ts` (POST manage), `followups/[id]/cancel/route.ts` (POST manage)
- `followups/bulk/status/route.ts` (POST manage, `followupBulkStatusSchema`)
- `followups/due/route.ts` (GET read)
- `followups/[id]/activity/route.ts` (GET read)

All: `withAuth` + `kcHandle` + `assertCan` + `resolveKcActor` + `followupScopeFor(kc)`, mirroring prior routes. Lists return `{ chains, pagination }` / `{ followups, pagination }`. complete/cancel parse `followupStatusSchema` (note optional). Note the static `due/` and `bulk/` segments vs dynamic `[id]/` — Next.js resolves static first, so `/followups/due` and `/followups/bulk/status` are safe.

- [ ] **Step 1:** create routes. **Step 2:** `npx tsc --noEmit | grep -E "followups/|followup-chains/"` → clean. **Step 3:** commit `feat(followups): chain + followup REST routes`.

---

### Task 5: Reminder + activity routes

**Files:**
- `followups/[id]/reminders/route.ts` (GET list `followup_read`, POST create `followup_manage`)
- `followup-reminders/[id]/route.ts` (DELETE `followup_manage`)
- `followups/[id]/send-reminder/route.ts` (POST `followup_manage`)

All standard wiring + `followupScopeFor`. send-reminder returns the `sendReminderNow` result (or 501 if only sms/push).

- [ ] **Step 1:** create. **Step 2:** tsc clean. **Step 3:** commit `feat(followups): reminder + send-reminder routes`.

---

### Task 6: Tests + close-out

**Files:** extend `tests/billing/fixtures.ts` (`seedFollowupChain`, `seedFollowup`, TEST_MARKER, cleanup for all 4 tables); create `tests/billing/followup.service.test.ts` (DB-backed) + `tests/billing/followup-routes.integration.test.ts` (DB-free auth matrix).

**DB SAFETY:** only the live DB — do NOT run DB-backed tests / repoint DATABASE_URL / weaken assertTestDb. Only run `npx vitest run tests/billing/kc-permissions.test.ts`, the DB-free route auth-matrix test, and `npx tsc --noEmit`.

- [ ] **Step 1:** fixtures (raw INSERTs, TEST_MARKER ids; cleanup deletes activity→reminders→followups→chains order).
- [ ] **Step 2:** service test (DB-backed, written not run): create chain → create followup in it (assert `chain_id` required + in-scope enforced) → list/get scoped → complete (status + completed_at + activity row) → bulk-status → due list → reminder create + `sendReminderNow` (email → dev-log ok, processed_at set; assert an sms reminder send throws 501) → scope isolation (other clinic can't see).
- [ ] **Step 3:** route auth-matrix (DB-free): POST `/followups` and `/followup-chains` → 401 (no token) + 403 (RECEPTIONIST — followup_manage excludes; or CLIENT excluded entirely from read too).
- [ ] **Step 4:** safe checks: `npx vitest run tests/billing/kc-permissions.test.ts <route-matrix>` pass; `npx tsc --noEmit | grep -iE "followup"` clean.
- [ ] **Step 5:** commit `test(followups): service + route tests (DB-guarded)`.

---

## Self-Review

**Spec coverage:** chains (4), followups (10: list/create/get/update/delete/complete/cancel/bulk-status/due/activity), reminders (4: list/create/delete/send). Capabilities `followup_read`/`followup_manage` (Task 1). Reminder dispatch: email immediate via `sendEmail`; sms/push + scheduled → 501 (per decision).

**Type consistency:** `FollowupScope`/`followupScopeFor` used across services + routes. `logActivity` shared. Chain create → followups reference it via `chain_id` (NOT NULL enforced by `assertChainInScope`). Lists return `{ chains }` / `{ followups }`. Column names match the introspected schema; all datetimes via `UTC_TIMESTAMP()` into `*_utc` columns; enums validated by Zod against the DB enums.

**Security notes for reviewers:** all raw SQL parameterized `?` (scope, filters, LIMIT/OFFSET, id, bulk `IN`, all INSERT/UPDATE values). Scope enforced on every list/get/update/delete/complete/cancel/bulk/due/activity path and on create (clinic forced non-super, PROFESSIONAL doctor self-only, `assertChainInScope`). Reminders + activity scope via parent-followup join. `send-reminder` reuses the safe `sendEmail` (dev-logs without an API key, never throws); sms/push explicitly 501. CLIENT excluded from both capabilities.
