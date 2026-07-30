# Shadow Tables Audit — Duplicating KiviCare Data

**Date:** 2026-07-25
**Status:** Analysis complete, remediation plan proposed
**Trigger:** We created app-native tables (`clients`, `professionals`, `sessions_booking`, …)
that duplicate data KiviCare already owns in `wp_users` / `wp_usermeta` / `wp_kc_*`.

---

## 1. Executive summary

The codebase contains **two disjoint data stacks over the same MySQL database**:

| | Stack A — KiviCare-native (correct) | Stack B — shadow tables (wrong) |
|---|---|---|
| Location | `src/services/billing/*` (15 services) | `src/services/{client,professional,session,auth,practice,public,…}` |
| Access | raw SQL on `wp_kc_*`, `wp_users`, `wp_usermeta` | Prisma models on non-prefixed tables |
| ID space | WP `BIGINT` IDs | Prisma `cuid()` strings |
| Tables | 19 mapped `Kc*` models | **57 non-`wp_` tables** |

Stack B was generated wholesale by commit `621d65a` ("implement all 18 specs"), which
created a full parallel schema instead of reading KiviCare's existing tables.

### Two facts that make this worse than it looks

1. **The schema was never migrated — it was pushed.**
   There is **no `_prisma_migrations` table** in the database. All 57 shadow tables exist
   because someone ran `prisma db push` against the WordPress database. The four dirs in
   `prisma/migrations/` (`add_client_management`, `add_session_management`,
   `add_session_notes`, `add_intervention_plan`) are decorative — they were never applied.
   *This is exactly the hazard recorded in memory: `DATABASE_URL` **is** the WP DB.*

2. **The ID spaces do not join.**
   `Client.userId` is a `String` with a comment `// WordPress user link`, but it holds a
   cuid from the shadow `users` table, not `wp_users.ID`. Only `User.wpUserId BigInt?`
   carries the real WP ID. Every downstream FK (`sessions_booking.clientId`,
   `intervention_plans.clientId`, `session_notes.professionalId`) is keyed on cuid, so
   nothing in Stack B can be joined to `wp_kc_appointments` without a two-hop lookup.

---

## 2. Complete inventory: the 57 shadow tables

### 2a. Duplicates of KiviCare data — **must be removed and re-pointed**

| Shadow table | Canonical KiviCare source |
|---|---|
| `clients` | `wp_users` role `kiviCare_patient` + `wp_usermeta` (`basic_data` JSON, `patient_unique_id`, `first_name`, `last_name`) |
| `patients` | same as above |
| `patient_clinic_mappings` | `wp_kc_patient_clinic_mappings` |
| `doctors` | `wp_users` role `kiviCare_doctor` + `wp_usermeta` |
| `professionals` | `wp_users` role `kiviCare_doctor` + `wp_usermeta` |
| `doctor_clinic_mappings` | `wp_kc_doctor_clinic_mappings` |
| `doctor_sessions` | `wp_kc_clinic_sessions` |
| `professional_availability` | `wp_kc_clinic_sessions` |
| `professional_off_days` | `wp_kc_clinic_schedule` (holiday rows) |
| `professional_service_assignments` | `wp_kc_service_doctor_mapping` |
| `doctor_service_mappings` | `wp_kc_service_doctor_mapping` |
| `receptionists` | `wp_users` role `kiviCare_receptionist` |
| `receptionist_clinic_mappings` | `wp_kc_receptionist_clinic_mappings` |
| `clinics` | `wp_kc_clinics` |
| `services` | `wp_kc_services` |
| `clinic_service_prices` | `wp_kc_service_doctor_mapping.charges` |
| `specialties`, `_DoctorToSpecialty` | `wp_kc_static_data` type `specialization` |
| `appointments` | `wp_kc_appointments` |
| `sessions_booking` | `wp_kc_appointments` |
| `appointment_service_mappings` | `wp_kc_appointment_service_mapping` |
| `appointment_reminders` | `wp_kc_appointment_reminder_mapping` |
| `clinic_schedules`, `clinic_sessions` | `wp_kc_clinic_sessions` / `wp_kc_clinic_schedule` |
| `holiday_list` | `wp_kc_clinic_schedule` |
| `bills` | `wp_kc_bills` |
| `bill_items` | `wp_kc_bill_items` |
| `payments`, `payment_appointment_mappings` | `wp_kc_payments_appointment_mappings` |
| `taxes` | `wp_kc_taxes` |
| `patient_encounters` | `wp_kc_patient_encounters` |
| `encounter_templates` | `wp_kc_patient_encounters_template` |
| `prescriptions` | `wp_kc_prescription` |
| `medical_history` | `wp_kc_medical_history` |
| `medical_problems` | `wp_kc_medical_problems` |
| `custom_fields` | `wp_kc_custom_fields` |
| `custom_field_data` | `wp_kc_custom_field_data` |
| `static_data` | `wp_kc_static_data` |
| `settings` | `wp_options` |
| `email_templates` | `wp_options` (KiviCare `DefaultEmailTemplates` migration) |
| `media` | `wp_posts` attachments |
| `users` | `wp_users` + `wp_usermeta` |

**Count: 40 tables that should not exist.**

Note: `appointments` **and** `sessions_booking` **and** `wp_kc_appointments` are three
parallel stores of the same booking — this matches the already-recorded issue.

### 2b. Genuinely app-native — **keep**, but must be re-keyed to `wp_users.ID` / `wp_kc_*.id`

| Table | Why it stays |
|---|---|
| `sessions` (auth), `refresh_tokens`, `password_reset_tokens`, `google_identities` | JWT/refresh-token store; WP has no equivalent |
| `audit_logs`, `log_entries`, `wordpress_webhook_events` | Our own observability |
| `intervention_plans`, `recommendation_items` | Praktiqu-specific clinical feature |
| `session_notes` | Praktiqu SOAP notes (KiviCare encounters are a different shape) |
| `consent_forms`, `consent_signatures` | Praktiqu informed-consent feature |
| `note_templates` | Praktiqu feature |
| `goals`, `goal_milestones` | Praktiqu progress tracking |
| `payment_orders` | Xendit hand-off state |

**Count: 17 tables that legitimately stay.**

### 2c. Special case — the `users` mirror

`users` is not a pure duplicate: it is a **sync mirror** populated by
`prisma.user.upsert()` on login (`src/services/auth/service.ts:202`), carrying
`wpUserId BigInt? @unique` back to `wp_users.ID`.

This is defensible *as an auth anchor* — but it is the root cause of the ID split,
because every other model FKs to `users.id` (cuid) rather than `wpUserId`. See §4.

---

## 3. Blast radius in code

Classification by service (raw-SQL `wp_*` hits vs `prisma.<shadow model>` hits):

**Stack A — already correct, no change needed (15 services):**
`billing/bill`, `billing/bill-document`, `billing/clinic-schedule`, `billing/dashboard`,
`billing/doctor-session`, `billing/encounter`, `billing/followup`, `billing/gdpr`,
`billing/medical-history`, `billing/patient-medical-report`, `billing/prescription`,
`billing/rating`, `billing/receptionist`, `billing/tax`

**Stack B — must be rewritten (13 services, ~4,500 LOC):**

| Service | LOC | Shadow refs | Target |
|---|---|---|---|
| `session/session.service.ts` | 876 | 16 | `wp_kc_appointments` |
| `client/client.service.ts` | 729 | 26 | `wp_users` + `wp_usermeta` |
| `professional/professional.service.ts` | 376 | 12 | `wp_users` + `wp_usermeta` |
| `public/public-booking.service.ts` | 349 | 9 | `wp_kc_appointments` |
| `auth/service.ts` | — | 14 | keep mirror, re-key (§4) |
| `practice/service.ts` | — | 5 | `wp_kc_clinics` |
| `professional/availability.service.ts` | — | 4 | `wp_kc_clinic_sessions` |
| `session-notes/service.ts` | — | 4 | keep table, re-key FKs |
| `auth/admin-auth.service.ts` | — | 4 | keep mirror |
| `public/public-catalog.service.ts` | — | 3 | `wp_kc_services` |
| `payments/payment.service.ts` | — | 3 | `wp_kc_bills` + `payment_orders` |
| `professional/service-assignment.service.ts` | — | 2 | `wp_kc_service_doctor_mapping` |
| `progress/service.ts` | — | 1 | keep table, re-key FKs |

**API surface:** 187 routes. Route handlers are thin RBAC+validation wrappers, so the
rewrite is contained in the service layer — but response DTOs change ID type
(`string` cuid → numeric WP ID), which is a **breaking API change** for the Laravel
front-end and any Postman collections.

**Also to delete:** `src/services/billing/import/` (11 files) — the `wp-provision.ts` +
`adapters/{clinics,doctors,patients,services,taxes,appointments,encounters,
prescriptions,medical-history}.ts` importer exists solely to copy WP data *into* the
shadow tables. Its entire reason for existing disappears.

---

## 4. Root cause

Three compounding decisions:

1. **Spec-driven generation without a data-source constraint.** The 18 specs in `/specs/`
   described features, not the fact that KiviCare already owns the schema. Generation
   produced a greenfield schema.
2. **`prisma db push` against the production WordPress database.** No migration history,
   no review gate, 57 tables materialised silently.
3. **cuid primary keys.** Choosing `@default(cuid())` made it structurally impossible to
   join Stack B to Stack A, which forced the importer to exist, which entrenched the
   duplication.

---

## 5. Remediation plan

### Guiding rule

> **WordPress owns identity and clinical data. Praktiqu owns only what KiviCare has no
> table for — and keys it on `wp_users.ID` / `wp_kc_*.id` (BIGINT).**

### Phase 0 — Stop the bleeding (do first, ~half a day)

- [ ] **0.1** Verify staging/production row counts for all 40 duplicate tables before
      touching anything. Local dev DB shows `clients=0, patients=3, professionals=1,
      doctors=1, users=4, appointments=2` — near-empty, but **staging must be confirmed
      independently.** This determines whether we need data migration at all.
- [x] **0.2** ~~Add a guard so `prisma db push` / `migrate dev` cannot run against
      `DATABASE_URL`.~~ **Done.** Two layers, both verified:
      - `scripts/guard-db.mjs` — probes `information_schema` for `wp_users` /
        `wp_usermeta` / `wp_options` and exits non-zero if found. Uses `PrismaClient`
        rather than the `mysql` CLI (the CLI is absent on this host — MySQL runs in
        Docker — and a guard that cannot run is a guard that gets bypassed).
        Wired to `npm run db:push` / `db:migrate` / `db:reset`.
        Escape hatch: `ALLOW_WP_SCHEMA_WRITE=i-have-a-backup`.
      - `scripts/block-unguarded-prisma.sh` — `PreToolUse(Bash)` hook registered in
        `.claude/settings.json`, blocking bare `prisma db push` / `migrate dev` /
        `migrate reset`. npm scripts alone don't cover the actual failure mode, which
        was an agent typing the raw command.
- [ ] **0.3** Freeze new writes to shadow tables — no new features on Stack B.

### Phase 1R — WP read layer, direct SQL (~2 days)

- [x] **1R.1a** `src/repositories/wp/patients.repo.ts` — **done.** `findPatientById`
      + `listPatients`, filtering on the `kiviCare_patient` capability. 7 contract
      tests in `tests/repositories/wp-patients.repo.test.ts`.
- [x] **1R.1b** `doctors.repo.ts` — **done.** `findDoctorById` + `listDoctors` on the
      `kiviCare_doctor` capability. Shared mechanics extracted to `wp-user.ts`
      (role slugs, capability EXISTS, meta joins, `basic_data` decoding, LIKE
      escaping, pagination). 7 tests, incl. asserting `temp_password` never leaks.
- [x] **1R.1c** `clinics.repo.ts` + `services.repo.ts` — **done.** Typed Prisma client
      (these are plain tables with mapped models), normalising `status` → `isActive`
      and decoding the `specialties` LongText JSON. `listServicesForDoctor` resolves
      the per-doctor `charges`/`duration` that override the base price. 11 tests.
- [x] **1R.1d** `appointments.repo.ts` — **done.** Replaces *both* shadow copies
      (`appointments` and `sessions_booking`). `findAppointmentById`,
      `listAppointments`, `findConflictingAppointments`. 14 tests.
      Status ordinals verified against `KCAppointment.php:41-45` and pinned by test:
      `CANCELLED=0, BOOKED=1, PENDING=2, CHECK_OUT=3, CHECK_IN=4`; slot-blocking set
      is `[1,2,4]` (`KCAppointment.php:493`) — CHECK_OUT does not block.
      ⚠️ **Trap found here:** binding a JS `Date` to a MySQL `TIME` comparison matches
      nothing (MySQL promotes TIME using the *current* date), so every overlap check
      silently returned "no conflict" — a double-booking bug. Time comparisons must
      use raw SQL with `'HH:MM:SS'` string params. It also passed the tests at first
      because all but one conflict test asserted an empty result and so passed
      vacuously — **always assert one non-empty case when testing a filter.**
- [x] **1R.1e** `clinic-sessions.repo.ts` — **done.** Replaces *three* shadow tables
      (`professional_availability`, `doctor_sessions`, `clinic_sessions`).
      `listClinicSessions` + `getWeeklyAvailability`. An unknown day slug throws
      rather than returning `[]`, which would read as "never works". 10 tests.
- [x] **1R.1f** `static-data.repo.ts` — **done.** Backs `specialties` /
      `_DoctorToSpecialty`. Adds the missing `KcStaticData` Prisma mapping. 8 tests.
      *(Was blocked on §3a; unblocked by the provisioning script below.)*

**Phase 1R is complete — 6 repositories, 57 contract tests.**

### ✅ 3a. The local databases were a partial mirror — RESOLVED

Both `wordpress-praktiqu` and `wordpress-praktiqu-test` contained **16 of KiviCare's 30
tables**. Fifteen were missing outright:

`static_data`, `custom_fields`, `custom_field_data`, `patient_clinic_mappings`,
`clinic_schedule`, `appointment_service_mapping`, `appointment_reminder_mapping`,
`appointment_reminder_mapping_data`, `patient_encounters_template`,
`patient_encounters_template_mapping`, `prescription_enconter_template`,
`medical_problems`, `payments_appointment_mappings`, `gcal_appointment_mapping`,
`custom_notifications`.

**Why this matters for the remediation:**
- Contract tests can only cover the half of KiviCare that exists locally. Phase 1R is
  verified against a partial schema — treat staging as the real gate.
- `patient_clinic_mappings` is among the missing, and clinic-scoped patient access
  control depends on it. That is a security-relevant gap, not just a convenience one.
- `clinic_schedule` (holidays) is queried by `billing/clinic-schedule.service.ts`,
  which therefore cannot be exercised locally.

**Resolved** by `scripts/provision-kivicare-test-schema.mjs`, which extracts the DDL
from the plugin's own migrations rather than hand-writing it. It refuses any database
whose name lacks "test" and only issues `CREATE TABLE IF NOT EXISTS`. The test database
now has all 30 tables.

```bash
node scripts/provision-kivicare-test-schema.mjs
```

**What this uncovered.** `tests/billing/fixtures.ts` cleans up with *unbounded*
`id >= 9_000_000` deletes across `wp_kc_appointments`, `wp_kc_clinic_sessions` and
others. That cleanup had been silently **aborting partway**, because it deletes from
`wp_kc_patient_clinic_mappings` and `wp_kc_clinic_schedule` first and those tables did
not exist. Completing the schema made the cleanup run to completion — which then wiped
the repository suites' fixtures. Two consequences:

1. The repository suites had only been surviving by accident. Their fixtures moved to
   8.4M–8.8M, below the billing blast radius.
2. **Open follow-up:** billing's cleanup should bound its deletes the way the
   repository suites do (`[BASE, BASE + 100_000)`). Left alone for now — it touches 15
   billing suites and buys nothing immediate.

Net effect on the baseline: **679 → 736 tests, still 9 failures.** The 57 extra passing
tests are billing suites that could not run before. The 9 failures are unchanged, so
the missing tables were never their cause.

⚠️ The *dev* database (`wordpress-praktiqu`) is still a 16-table partial mirror. The
script deliberately refuses to touch it.
- [x] **1R.2** ~~`wp_usermeta` read helpers.~~ **Done for patients** — `basic_data` is a
      JSON blob decoded in `patients.repo.ts`; malformed/absent JSON yields nulls.
      Extract into a shared helper when the second repo needs it.
- [ ] **1R.3** Role resolution from `wp_usermeta.wp_capabilities` (`kiviCare_patient`,
      `kiviCare_doctor`, `kiviCare_receptionist`, `kiviCare_clinic_admin`). Reuse the
      existing `src/lib/auth/role-mapping.ts`.
- [ ] **1R.4** Contract tests: for each repo, assert our reads match what the KiviCare PHP
      controller returns for the same fixture.

### Phase 1W — Write path via `praktiqu-endpoint` plugin (~3 days, per D1)

- [x] **1W.1a** `POST /patients` + `PUT /patients/{id}` — **done.**
      `class-praktiqu-endpoint-patients.php`. Writes via `wp_insert_user` +
      `set_role` + `update_user_meta`, then fires `kc_patient_save` /
      `kivicare_patient_registered` / `kc_patient_update` with KiviCare's own payload
      shape.

      **D1 justified concretely:** `kc_patient_save` has three real listeners —
      `KCPatientNotificationListener::handlePatientRegistered` (welcome email),
      `KCPatientControllerFilters::handlePatientSave`, and Pro's
      `KCPPatientControllerFilters::saveCustomFormData`. A raw INSERT skips all three.

      Edge cases handled: update *merges* into `basic_data` (a partial request must not
      blank fields); update rejects a non-patient (no editing a doctor via this route);
      clinic mapping is idempotent (no unique constraint on the table); usernames are
      de-duplicated (derived from the email local-part, so cross-domain collisions are
      real).
- [x] **1W.1b** `POST /appointments`, `PUT /appointments/{id}`,
      `POST /appointments/{id}/status` — **done.**
      `class-praktiqu-endpoint-appointments.php` + `appointments.write.ts`.

      Delegates the row to `KCAppointment::create` rather than writing SQL, because
      `KCAppointment::save` derives `appointment_start_utc` / `appointment_end_utc`.
      A raw INSERT leaves them NULL and breaks every UTC query. Returns 503 if
      KiviCare is inactive rather than writing a half-formed row.

      Behaviours copied from `AppointmentsController`, not invented:
      `kc_after_create_appointment` fires **only when status ≠ PENDING** (line 3349) —
      an unpaid booking must not send the "booked" email, surfaced as `notified` in
      the response; service ids are stored comma-joined in `visit_type` (line 3171);
      the `kivicare_appointment_data` filter is applied; and on cancel
      `kc_appointment_cancelled` fires *before* `kc_appointment_status_update`
      (lines 3887–3891), because the cancellation listener tears down telemed links
      the status listener may still read.

      Reschedule re-derives the UTC column whenever local time or timezone moves.
- [ ] **1W.1c** `POST/PUT /clinics`, `POST/PUT /services`
      (`kc_service_add` / `kc_service_update` / `kc_clinic_delete`).
- [ ] **1W.2** Multi-table writes must be **one** endpoint each — an appointment plus its
      service mapping cannot be two calls from Next.js without a partial-failure window.
- [x] **1W.3** Typed client — **done for patients.** `wpRequestJson` in
      `src/lib/wp-endpoint.ts` centralises the fetch/check/parse/rethrow the payments
      and media clients each repeated, and surfaces WordPress's
      `{code,message,data.status}` message rather than the raw body.
      `src/repositories/wp/patients.write.ts` sends flat fields and lets PHP assemble
      `basic_data` — two implementations of that layout would drift.
      *Still to add: timeouts and a retry policy.*
- [ ] **1W.4** Integration tests against a real WP instance asserting the hooks actually
      fired (notification queued, calendar event created) — that is the entire reason
      D1 chose this path, so it must be verified, not assumed.

### Phase 2 — Re-key the app-native tables (~2 days)

- [ ] **2.1** Change the 17 keeper tables' FK columns from cuid `String` to
      `BigInt` referencing `wp_users.ID` / `wp_kc_appointments.id`:
      `intervention_plans.{clientId,professionalId}`, `recommendation_items`,
      `session_notes.{sessionId,professionalId}`, `consent_signatures.userId`,
      `goals`, `goal_milestones`, `payment_orders`.
- [ ] **2.2** Write these as **scoped SQL migrations** (`ALTER TABLE` on our tables only) —
      never `db push`. Every statement reviewed and named explicitly.
- [ ] **2.3** Backfill existing rows via `users.wpUserId` before dropping the old columns.
- [ ] **2.4** Decide the `users` mirror's fate — recommendation: **keep it**, but demote it
      to auth-only (id, wpUserId, role, token relations) and strip the profile columns
      (`firstName`, `lastName`, `displayName`, `basicData`, `timezone`) that duplicate
      `wp_usermeta`.

### Phase 3 — Rewrite Stack B services (~5 days, one service at a time)

Order by dependency, each behind its own PR with the old path still passing tests:

- [x] **3.1** `client.service.ts` → `wp_users` + `wp_usermeta` (the flagship case)
- [x] **3.2** `professional.service.ts` + `availability` + `service-assignment`
- [x] **3.3** `practice/service.ts` → `wp_kc_clinics`
- [x] **3.5** `session.service.ts` → `wp_kc_appointments` (largest; collapses the
      three-way `appointments` / `sessions_booking` / `wp_kc_appointments` split).
      Done before 3.4/3.6 — both public services read through it.
- [x] **3.4** `public-catalog.service.ts` → `wp_kc_services`
- [x] **3.6** `public-booking.service.ts` → `wp_kc_appointments`. Retires the last of
      the booking duplicates from the guest path: a public booking now produces the
      same rows KiviCare's own form does, visible in WP admin and blocking staff slots.
      The Professional → Doctor userId bridge is gone with the split id space.
- [ ] **3.7** `payment.service.ts` → `wp_kc_bills` + keep `payment_orders`
- [x] **3.8** `session-notes`, `progress`, `consent` → tables kept, FK reads swapped to
      the WP repos:
      - `session_notes.sessionId` / `.professionalId` now hold `wp_kc_appointments.id`
        and `wp_users.ID` as text (both were already unconstrained String columns).
        CLINIC_ADMIN listing is scoped by the clinic's doctor roster instead of by an
        unbounded `IN` list of every appointment id in the clinic.
      - `progress` reads the client timeline from `wp_kc_appointments`.
      - `consent_forms.practiceId` now holds `wp_kc_clinics.id`, checked on create.
        `consent_signatures.clientId` still references `users.id` — it has a real FK,
        so repointing it is a schema change (Phase 4), not a code one.
      - `intervention-plan` needed no change: it only touches its own two tables, and
        its `sessionId` is an opaque unconstrained string that now carries the
        KiviCare id like the others.

### Phase 4 — Delete (~1 day)

- [ ] **4.1** Delete `src/services/billing/import/` entirely (11 files).
- [ ] **4.2** Remove the 40 duplicate models from `prisma/schema.prisma`.
- [ ] **4.3** Delete the 4 unapplied migration dirs; generate a clean baseline that covers
      **only** the 17 keeper tables.
- [ ] **4.4** `DROP TABLE` the 40 shadow tables via reviewed, scoped SQL — after a verified
      backup and after Phase 3 ships to staging.

### Phase 5 — API contract (~1 day, ships **with** Phase 3 per D2)

- [ ] **5.1** Regenerate `openapi.yaml`; IDs change from cuid strings to numeric.
- [ ] **5.2** Coordinate the break with the Laravel front-end — no compat shim, so the
      front-end change must land in the same release.
- [ ] **5.3** Refresh the Postman collection from the new spec.

---

## 6. Decisions

### ✅ Decided 2026-07-25

**D1 — Writes go through the `praktiqu-endpoint` plugin's REST layer.**
Not direct SQL. KiviCare's hooks (notifications, Google Calendar sync, telemed
provisioning) fire on the PHP side; writing straight to `wp_kc_*` silently skips them.

*Consequences for the plan:*
- Phase 1 splits into **1R (read)** and **1W (write)**. Reads stay direct SQL — fast,
  and consistent with the 15 `billing/*` services that already do this correctly.
- The `praktiqu-endpoint` plugin needs new REST routes for every write we perform:
  patient create/update, appointment create/reschedule/cancel, clinic + service
  mutations. This is **net-new PHP work not in the original estimate.**
- The 15 `billing/*` services currently write direct SQL (`INSERT INTO wp_kc_bills`,
  `wp_kc_clinic_schedule`, …). Under D1 they are **also** non-compliant. Decide
  whether to migrate them now or accept the inconsistency and log it — see Q1 below.
- Every write becomes a network hop with its own auth, error mapping, and partial-failure
  mode. Transactional writes spanning several tables must be one plugin endpoint, not
  several calls from Next.js.

**D2 — Break the API contract in one go.**
No `legacyId` compat shim. Response IDs change from cuid strings to WP numeric IDs,
`openapi.yaml` is regenerated, and the Laravel front-end migrates in step.

*Consequences for the plan:*
- Phase 5 must land **with** Phase 3, not after it — there is no interim release where
  both shapes are served.
- The Laravel front-end and the Postman collection need coordinated updates. Front-end
  work must be scheduled alongside, not afterwards.
- This is only safe because the shadow tables are near-empty. **Confirm on staging
  first (Q2).** If staging holds real rows, revisit.

### ❓ Still open

1. ~~**Do the 15 `billing/*` services migrate to plugin-REST writes too?**~~
   **ANSWERED 2026-07-26 — by evidence, and the answer is "almost none of them".**

   I checked which hooks those direct writes actually bypass, and how many listeners
   each hook has, rather than reasoning from the principle:

   | Hook a direct write skips | Listeners | Does `billing/*` trigger it? |
   |---|---|---|
   | `kc_receptionist_save` | 1 — `KCReceptionistNotificationListener` (welcome email) | **YES** — `receptionist.service.ts:79` does `INSERT INTO wp_users` |
   | `kc_service_add` / `kc_service_update` | 1 each — Pro's `KCProServiceControllerFilters` | Only `import/adapters/services.ts`, **deleted in Phase 4** |
   | `kc_encounter_save` / `kc_encounter_update` | **0** | n/a — nothing listens, direct writes are fine |
   | `kc_before_delete_encounter` | 1 — Pro's `deleteTaxData` | **NO** — no encounter DELETE exists in `src/` |

   **Recommendation: migrate `receptionist.service.ts` only.** It has a confirmed,
   user-visible defect today — and on closer inspection it is worse than a missing
   email. `createReceptionist` (`receptionist.service.ts:60-100`) produces an account
   that is **completely unusable**:

   1. It never fires `kc_receptionist_save`, so
      `KCReceptionistNotificationListener::handleReceptionistRegistered` never runs —
      **no welcome email.**
   2. It writes `user_pass = '!disabled-<username>'`, which is not a valid WordPress
      hash. `Service::authenticate` checks it with `wp_check_password`
      (`class-praktiqu-endpoint-service.php:53`), which therefore always returns false
      — **the receptionist can never log in**, and no flow ever sets a real password.

   So every receptionist created through our API is locked out and never told they
   exist. `POST /praktiqu/v1/receptionists` (added 2026-07-26,
   `class-praktiqu-endpoint-receptionists.php`) fixes both: `wp_insert_user` hashes a
   real password and the hook delivers it by email.

   **DONE 2026-07-26** — `createReceptionist` now calls that endpoint, with the plugin
   mocked in tests. 4/4 pass in isolation.

### ⚠️ 3b. Sixteen billing suites were reporting green while running nothing

Found while finishing the receptionist fix. `tests/billing/fixtures.ts` `cleanup()`
deletes from 8 tables that exist only on staging — `wp_kc_patient_review`,
`wp_kc_followups(_chains/_reminders/_activity_log)`, `wp_kc_gdpr_consents`,
`wp_kc_gdpr_consent_versions`, `wp_kc_gdpr_audit_log`. **No DDL for any of them exists
anywhere in this repo.**

The first missing table threw, which aborted `beforeAll`, which made vitest report
every test in that suite as **skipped** — not failed. The suites looked green.

Separately, the test database's `wp_users` was a five-column stub created by
`prisma db push` from the `KcUser` model. It lacked `user_pass`, `user_nicename`,
`user_url`, `user_activation_key` and `user_status`, so anything writing a user the way
WordPress does failed with *Unknown column 'user_pass'*.

Both fixed: `cleanup()` now tolerates MySQL 1146 (and only 1146), and the provisioning
script adds the missing core columns.

**The baseline got worse on purpose:**

| | before | after |
|---|---|---|
| passed | 673 | 699 |
| failed | **9** | **42** |
| skipped | 62 | 3 |

The 33 newly-failing tests were never passing — they were never *run*. 18 fail purely
because those staging-only tables are absent (verified: `rating.service` fails with
1146 on `wp_kc_patient_review`). This trades a misleading green for an accurate red.

**Follow-ups:** obtain or write DDL for the 8 staging-only tables; and bound billing's
unbounded `id >= 9_000_000` cleanup, which still contaminates suites running
concurrently.

   The other 14 services are not worth migrating: encounters and bills have no
   listeners on their write hooks, and the only service-catalogue writer is the
   importer that Phase 4 deletes outright. This drops the ~4 days that a blanket
   migration would have cost down to roughly half a day.
2. ~~**Staging data.**~~ **ANSWERED 2026-07-27.** A production copy was restored into
   the `praktiqu` database on the local `praktiqu-mysql` container. Table prefix is
   plain `wp_` (not `wp_314_`), so the repositories' assumptions hold.

   | Real KiviCare data | rows | | Shadow table | rows |
   |---|---|---|---|---|
   | `wp_users` | **843** | | `clients` | **0** |
   | └ role `kiviCare_patient` | **752** | | `patients` | **0** |
   | └ role `kiviCare_doctor` | **59** | | `sessions_booking` | **0** |
   | `wp_kc_appointments` | **2 411** | | `appointments` | **0** |
   | `wp_kc_clinics` | 22 | | `clinics` | 22 *(exact mirror)* |
   | `wp_kc_services` | 497 | | `services` | 497 *(exact mirror)* |
   | | | | `professionals` / `doctors` | 59 *(exact mirror)* |
   | | | | `users` | 60 — all have `wpUserId`, **0 orphans** |

   **Phase 4.4 is a plain `DROP`. No data migration is needed**, and **D2 is
   validated** — there are no client rows to preserve and no cuid client IDs in the
   wild. Every populated shadow table is an exact mirror of a `wp_kc_*` source with no
   rows that aren't derivable from it.

   ### 🔴 And the real consequence of the bug is now measurable

   `GET /api/v1/clients` → `listClients` → `prisma.client` → the `clients` table,
   which holds **0 rows**. Meanwhile **752 patients exist in `wp_users`**.

   **The client API has been blind to every real patient in the system.** This is not a
   latent schema-tidiness problem; it is a live, total data-visibility failure, and it
   raises Phase 3.1 from cleanup to the highest-priority fix on the list.

   Verified end-to-end read-only against the restored data — `listPatients` returns
   752 with names, emails and phone numbers correctly decoded from the `basic_data`
   blob; `listDoctors` 59; `listAppointments` 2 411; `listClinics` 20 (correctly
   excluding the 2 inactive of 22).
3. **`users` mirror.** Keep as auth anchor (recommended — JWT/refresh tokens need a
   local FK target) or eliminate and read `wp_users` on every request?
4. ~~**Provisioning a complete local KiviCare schema.**~~ **Resolved** — see §3a.

---

## 7. Estimate

| Phase | Effort | Status |
|---|---|---|
| 0 — Stop the bleeding | 0.5 day | 0.2 done; 0.1 + 0.3 open |
| 1R — WP read layer | 2 days | |
| 1W — Plugin write layer (PHP + client) | 3 days | added by D1 |
| 2 — Re-key keeper tables | 2 days | |
| 3 — Rewrite 13 services | 5 days | 3.1–3.6 done; 3.7 (payments) + 3.8 open |
| 4 — Delete duplicates | 1 day | |
| 5 — API contract | 1 day | ships with Phase 3 |
| **Total** | **~14.5 days** | was ~11.5 before D1 |

D1 (plugin-REST writes) added ~3 days of PHP work. Q1 has since been answered by
evidence: only `receptionist.service.ts` needs migrating (~0.5 day), not all 15
`billing/*` services (~4 days) — see §6 Q1.
