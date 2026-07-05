# PR #14 Review Findings — `docs(api): complete KiviCare API port implementation reference`

**PR:** https://github.com/Alfzzz124/nextjs-appointment-praktiqu/pull/14
**Branch:** `docs/kc-port-documentation` → `main` · **Change:** +238 / −0, 1 file (`docs/api/KIVICARE-PORT.md`)
**Reviewed:** 2026-07-04 · Docs-only PR, so the review verified **factual accuracy against the merged code** and the relationship to the two OpenAPI files.

---

## Verdict

**The document is accurate — every checkable claim matches the code.** No blocking findings. The PR is safe to merge.

However, to answer the review question directly: **no, it is not "the same as" either `openapi.yaml` — the three documents cover three different things**, and the ~160 ported endpoints the doc describes have **no OpenAPI specification anywhere** (see Finding 1).

| Document | What it actually covers |
|---|---|
| `docs/api/KIVICARE-PORT.md` (this PR) | Prose reference for the ~160 ported Next.js `/api/v1` KC endpoints (PRs #3–#13) |
| `openapi.yaml` (repo root, **untracked**, 12,613 lines) | The **WordPress plugin's own** REST API (`{baseUrl}/wp-json/kivicare/v1/...`) — the *source* that was ported, not the port |
| `docs/api/openapi.yaml` | Only the PraktiQU **sessions + professionals** features (002/005) — none of the KC modules |

---

## Findings (most severe first)

### 1. Gap: the ported `/api/v1` KC endpoints have no OpenAPI spec (informational, not a defect of this PR)

Neither OpenAPI file documents the endpoints `KIVICARE-PORT.md` describes:

- `docs/api/openapi.yaml` — zero references to encounters, prescriptions, medical-history, patient-medical-reports, receptionists, doctor-sessions, schedules, dashboard, import, ratings, followups, or gdpr.
- Root `openapi.yaml` — contains `/kivicare/v1/encounters`, `/kivicare/v1/gdpr`, etc., but those are the **WordPress plugin's** routes under `/wp-json`, not the Next.js port's `/api/v1` routes.

If machine-readable API docs are wanted for the port, that's a follow-up task (generate an OpenAPI spec for `src/app/api/v1/**`). `KIVICARE-PORT.md` itself never claims OpenAPI coverage, so this doesn't block the PR.

### 2. Pre-existing: `docs/api/openapi.yaml` is structurally invalid YAML/OpenAPI (not touched by this PR)

Discovered while comparing; worth a separate fix:

- **Lines 1–7:** Markdown text (`# OpenAPI 3.0 Specification…`, `**Version**…`, `---`) precedes `openapi: 3.0.3` → the file won't parse in any OpenAPI tool.
- **Lines 551–1039:** The `/professionals` paths (Feature 002) were appended **inside the `components:` block** (after `responses:`) instead of merged under the top-level `paths:` key.
- **Lines 1041–1200:** The professional schemas sit after those misplaced paths, also mis-nested.
- **Line 1202:** A second top-level `tags:` key duplicates line 30's.

Net effect: only the sessions half of the file is structurally valid; the professionals half is unreachable to tooling.

### 3. Minor doc nits in `KIVICARE-PORT.md` (optional polish, non-blocking)

- **Line 237** — Appendix says plans live at `docs/superpowers/plans/2026-07-*.md`. The 10 slice plans do match (5 × `2026-07-03`, 5 × `2026-07-04`), but the directory also holds the pre-existing `2026-06-28-kivicare-pro-billing-taxes.md` (Slice 0 / PR #2), which the glob excludes. Technically consistent with "one per slice", just easy to misread.
- **Line 236** — Scope helpers are listed as bare filenames (`kc-leaf-scope.ts`, `staff-scope.ts`, …) without the `src/services/billing/` prefix (given one line above, so context makes it clear).

---

## Verification detail (what was checked and confirmed ✅)

### Capability matrix (doc §3 vs `src/services/billing/kc-permissions.ts`)
- Capability count: **31 in code, 31 claimed** ✅
- All 31 capabilities × 5 roles checked individually (grouped rows expanded): **zero mismatches** ✅ — including the subtle ones (`rating_manage` excludes PROFESSIONAL but includes CLIENT; `gdpr_delete` is SUPER_ADMIN-only; `patient_bill_delete` excludes PROFESSIONAL).

### Endpoint & route counts (doc §1, line 14)
- Route files: `find src/app/api/v1 -name route.ts | wc -l` → **186** (claimed 186) ✅
- Exported HTTP handlers: **259** (claimed 259) ✅ — GET 109, POST 99, DELETE 23, PUT 16, PATCH 12.

### Module reference spot-checks (doc §4) — every listed endpoint exists as a route file with the right method
- **Encounters:** 9/9 ✅ (list/create, `[id]` GET/PUT/DELETE, bulk/delete, bulk/status, export, `[id]/print`)
- **Ratings:** 5/5 ✅ (list/create, `[id]` GET/DELETE, stats)
- **GDPR:** 11/11 ✅ (consent-versions ×4 incl. activate, consents ×4 incl. withdraw, audit-log, data-export, data-delete)
- **Import:** 3/3 ✅ (import, validate, templates)
- **Followups:** 18/18 ✅ (chains ×4, followups ×10 incl. complete/cancel/bulk-status/due/activity, reminders ×4)

### Architecture & helper claims (doc §2 + appendix)
- All 16 appendix files exist at the stated paths ✅ (`kc-response.ts`, `kc-actor.ts`, `kc-permissions.ts`, `appointment-token.ts`, `rate-limit.ts`, all 6 scope helpers, both validation files, etc.)
- `kcOk`/`kcFail`/`kcHandle`/`KcError` live in `src/lib/kc-response.ts` ✅; `resolveKcActor` returns `{ actor, wpUserId: bigint, clinicId: bigint | null }` ✅; `withAuth` in `src/lib/auth.ts` ✅; `assertCan` throws `KcError(403)` ✅.

### Testing claims (doc §7)
- `tests/billing/fixtures.ts` guards every fixture with `assertTestDb()` which throws unless `DATABASE_URL` matches `/test/i` ✅
- `kc-permissions.test.ts` (pure unit) ✅; `import.service.test.ts` with mocked adapters ✅
- Per-module pattern `<module>.service.test.ts` + `<module>-routes.integration.test.ts` confirmed for encounters, ratings, gdpr ✅

### Bug-history claims (doc §8)
- WP appointment-status mapping `CANCELLED=0, BOOKED=1, PENDING=2, CHECK_OUT=3, CHECK_IN=4` confirmed in `src/services/public/public-booking.service.ts:247-270` and the `AppointmentStatus` enum comments in `prisma/schema.prisma` ✅

---

## Recommended follow-ups (separate from this PR)

1. **Fix `docs/api/openapi.yaml`:** strip the markdown preamble, move the `/professionals` paths under `paths:`, move the professional schemas under `components.schemas`, merge the duplicate `tags:` keys.
2. **Decide the fate of the root `openapi.yaml`:** it's untracked; either commit it as the port's *source reference* (e.g. under `docs/api/kivicare-wp-plugin.openapi.yaml`) or add it to `.gitignore`.
3. **(Optional) Generate an OpenAPI spec for the ported `/api/v1` surface** so the 259-endpoint API has machine-readable docs to match this prose reference.

---

# Part 2 — Logic fidelity vs the WordPress plugin source (`Wordpress-Plugin/`)

**Reviewed:** 2026-07-05 · Five parallel comparisons of the ported TypeScript services against the PHP source in `Wordpress-Plugin/kivicare-clinic-management-system` and `kivicare-pro`. Findings marked **CONFIRMED** were re-verified by hand against the exact lines; the rest carry the comparing agent's file:line evidence.

## Verdict

**The port is faithful on data shapes, status semantics, scoping, and permissions** — tables, columns, status integers, UTC conventions, and the role matrix all line up (a few places are deliberately *more* secure than the plugin). The divergences that matter are **missing engine logic**, not wrong logic: schedule computation, session splitting, auto-close, and reminder scheduling were simplified to CRUD.

## Confirmed matches (spot-verified)

- **Appointment status integers** — `CANCELLED=0, BOOKED=1, PENDING=2, CHECK_OUT=3, CHECK_IN=4` identical on both sides (`KCAppointment.php:40-45` ↔ `prisma/schema.prisma` enum comments).
- **Permissions** — the port's 31-capability matrix agrees with `KCPermissions.php` role blocks for the overwhelming majority of capabilities. Two "escalation" claims were **REFUTED by hand**: PHP patients *do* have `prescription_list/view` and `medical_records_list/view` (`KCPermissions.php:46-50`), so CLIENT read access in the port matches the plugin.
- **Rating bounds** — 1–5 enforced on both sides (PHP model validator ↔ `validation.ts:273` `min(1).max(5)`). Table schema identical; the port even adds a stats endpoint.
- **GDPR** — consent-version/consent flow matches; single-active-version logic matches; audit-log read-only and soft-flag erasure are the documented intentional divergences.
- **Followups** — all four tables, state-transition rules (`pending→scheduled→completed/missed/cancelled`), activity logging, and UTC timestamps match.
- **Security improvements over the plugin (intentional):** prescription/medical-history `patient_id` derived from the encounter instead of trusted from the body (PHP trusts the body — exploitable there); clinic/doctor derived from the actor; HMAC guest tokens; rate limiting.

## Divergences found (most significant first)

### D1. **CONFIRMED — booking collision check uses `status IN (1, 2, 4, 5)`** · [public-booking.service.ts:95](../../src/services/public/public-booking.service.ts)
Status `5` does not exist (the range is 0–4) and `CHECK_OUT=3` is excluded. PHP blocks every non-cancelled appointment (`status != 0`, via `KCAppointmentDataService.php:112`). Practical exposure is low (CHECK_OUT appointments are normally in the past), but the stray `5` is a mapping slip — the filter was presumably meant to be `IN (1, 2, 3, 4)`. The same exclusion of `3` appears in `availability.service.ts` `getBookedRanges` (`status IN (1,2,4)`).

### D2. `get-unavailable-schedule` is a shallow port · `clinic-schedule.service.ts:120-128`
PHP's `getUnavailableSchedule()` (`ClinicScheduleController.php:312-501`, ~200 lines) computes weekday off-days from doctor sessions, parses `selected_dates` JSON for the three selection modes, excludes time-specific holidays, separates clinic vs doctor holidays, and derives fully-booked dates from slot counts. The port returns the raw schedule rows only. Any booking UI relying on this endpoint for calendar-disabling will misbehave.

### D3. Doctor-session split/break engine not ported · `doctor-session.service.ts:62-74`
PHP's `KCClinicSession::createSplitSessions()` (`KCClinicSession.php:351-454`) turns a day + breaks into multiple linked rows (`parent_id` grouping); delete removes the whole group. The port does single-row CRUD with no `parent_id` handling — sessions with lunch breaks can't be represented through the port's create, and deletes may orphan split rows created by the plugin.

### D4. No auto-close of overdue appointments
PHP runs a daily cron (`AppointmentsController.php:122-183`) cancelling past-date BOOKED appointments. The port has no equivalent, so stale `wp_kc_appointments` rows stay BOOKED forever — which also feeds D1's collision filter and dashboard counts.

### D5. Cancellation is silent · `public-booking.service.ts:325-349`
PHP fires `kc_appointment_cancelled` / `kc_appointment_status_update` hooks and syncs Google Calendar on cancel; pro addons hang email/SMS notifications off those hooks. The port just writes `status=0` — no notification path exists. (Partly architectural: there is no WP hook system in Next.js — but the functional gap is real.) The port is also stricter about *which* states can cancel (only BOOKED/PENDING; PHP allows any → CANCELLED).

### D6. Medical-history validation gaps · `medical-history.service.ts`
PHP restricts `type` to `problem|observation|note`, rejects duplicates on `(patient, encounter, type, title)` (409), and checks the module-enabled setting (`MedicalHistoryController.php:214-227, 293-302, 72-82`). The port accepts any type string and allows duplicates.

### D7. Encounter differences · `encounter.service.ts`
- Delete: PHP explicitly cascades to bills, medical history, and custom-field data (`EncounterController.php:1160-1210`); the port deletes only the encounter row (relies on DB FKs that the WP tables don't have) → potential orphan rows.
- PHP allows RECEPTIONIST and PATIENT to create encounters; the port's `encounter_manage` excludes both (more restrictive — possibly intentional, worth confirming with the product owner).
- Create default status: PHP model default `0` vs port `1` (open) — port's default is the sensible one, but flags a behavioral difference if callers omit status.

### D8. Receptionist provisioning omits `basic_data` meta · `receptionist.service.ts:77-97`
PHP stores contact/dob/address/gender as a JSON `basic_data` usermeta blob (`KCReceptionist.php:115`); the port never writes it, so the KiviCare WP admin UI will show blank profile fields for port-created receptionists. (Placeholder non-loginable password is intentional; soft-delete via `user_status=1` is the documented divergence — PHP hard-deletes.)

### D9. Import gaps vs plugin · `src/services/billing/import/`
Missing vs PHP (`KCImportController.php:62-122`): **receptionists** and **custom-fields** entities, XLSX support (CSV/JSON only), specialization auto-creation, profile-image URL download. Port adds things PHP lacks: dry-run validate, conflict strategies (`error/skip/update`), taxes/encounters/medical-history adapters.

### D10. Dashboard nits · `dashboard.service.ts`
- Recent payments ordered by `id DESC` instead of `created_at DESC` (PHP) — usually equivalent, not guaranteed.
- "Upcoming sessions" filter `status IN (1,2)` includes PENDING; PHP counts BOOKED only.
- Revenue sums all bills regardless of payment status — **same bug exists in PHP**; inherited, not introduced.

### D11. Followup reminders are data-only · `followup.service.ts`
PHP auto-queues reminders on followup create (when enabled) and schedules dispatch via Action Scheduler with channel whitelist + per-type duplicate prevention. The port stores reminder rows and supports immediate email only (documented 501 for the rest) — but also skips the channel whitelist and duplicate check on create, and does no doctor-timezone → UTC boundary calculation (dates are taken as given).

### D12. Timezone handling in collision checks
PHP compares in UTC columns with timezone conversion (`KCTimeSlotService.php:458-492`); the port compares local `appointment_start_date/time` strings directly. Fine while everything runs in one practice timezone (`Asia/Jakarta` default); a risk if multi-timezone practices ever exist.

## Verification run (2026-07-05)

- **Tests:** all DB-free KC-port suites pass — **71/71 tests across 15 files** (`kc-permissions`, `kc-actor` (mocked), `kc-response`, `mappers`, `tax-calculator`, `bill-document`, `import-engine`, and all 8 route auth-matrix suites). The DB-backed service suites were deliberately not run: this environment has only the live `wordpress-praktiqu` database and every fixture is guarded by `assertTestDb()`, exactly as the doc's §7 describes.
- **`tsc --noEmit`: 62 errors in 20 files — none in KC-port code and none from PR #14** (docs-only). All errors sit in pre-existing feature modules and their tests: `src/services/email-templates/templates.service.ts` (8), `src/services/professional/availability.service.ts` (5), `src/services/notes-templates/service.ts` (5), `src/services/professional/professional.service.ts` (4), plus progress/practice/consent/client/session/invoice-number and 9 test files. Root cause for most: code references Prisma models/enums that no longer exist in `prisma/schema.prisma` (`noteTemplate`, `goal`, `AttendanceStatus`) — schema drift predating the port. `prisma generate` was re-run and does not fix them. This means the doc's §7 claim "`tsc --noEmit` runs every slice" should be read as "no *new* errors per slice", not "the repo type-checks clean."

## Follow-up: tsc cleanup (2026-07-05, branch `fix/tsc-schema-drift`)

After merging PR #14, the 62 pre-existing `tsc` errors were fixed. **`npx tsc --noEmit` now reports 0 errors.** Summary of changes (all outside the KC-port code):

- **Schema (`prisma/schema.prisma`), `prisma generate` only — no DB migration run:** added the three models the "18 specs" code referenced but never declared (`NoteTemplate`, `Goal`, `Milestone`), added `Clinic.timezone`, and made `ConsentForm.createdById` optional (the create path never supplied it). These features need a real migration to create the tables before they work at runtime.
- **Type/logic fixes:** `AppointmentStatus.BOOKED/CHECK_OUT` (not the non-existent `Prisma.AttendanceStatus`), `Service.status === ServiceStatus.ACTIVE`, `@db.Time` Dates converted to HH:mm via `getUTCHours/Minutes` (availability) and `toISOString().slice(11,16)` (holidays), `Prisma.InputJsonValue` casts for JSON columns, email-template types imported from `@/types/email-template`, `withAuth`'s `ctx` made optional (matches how Next.js calls non-dynamic routes), `PaginatedResult<unknown>`, and a `useState` import.
- **Test fixes:** exported `SlotHoldService` and `RouteContext`, corrected stale imports (`autoCompleteOldSessions`, email-template type), `.safeParse` where `.success` was checked, expanded a Prisma mock, and fixed a `vi.hoisted` ordering bug.

**Newly-surfaced pre-existing test failures (NOT tsc issues, NOT regressions):** two test files never compiled before (so they never ran); now that they compile, they reveal stale assertions —
- `tests/unit/professional/availability.service.test.ts`: 7 `generateSlots` tests use fixtures written against an older implementation shape.
- `tests/unit/session-notes/validation.test.ts`: 4 assertions expect SOAP-only notes to validate and `formatSoapToContent` to trim empty sections — behavior the current implementation doesn't provide.

These are feature/test mismatches with runtime blast radius; left for a separate decision rather than changing behavior blind. Every previously-runnable suite still passes (88 tests / 18 files verified, zero regressions).

## Suggested priorities

1. Fix D1's status list (`IN (1,2,3,4)` or `!= 0`) in both `public-booking.service.ts` and `availability.service.ts` — one-line fixes.
2. Decide whether D2 (unavailable-schedule engine) and D3 (session splits) are needed by the consuming frontend; if yes they are the two largest genuine porting gaps.
3. Add an auto-close job (D4) — a cron hitting an internal endpoint would do.
4. Add the medical-history type enum + duplicate guard (D6) — small, prevents data quality drift between plugin-written and port-written rows.
5. Confirm with the product owner the intentionally-restrictive permission choices (patients/receptionists creating encounters, patients managing reports/followups — all allowed in PHP, denied in the port).
