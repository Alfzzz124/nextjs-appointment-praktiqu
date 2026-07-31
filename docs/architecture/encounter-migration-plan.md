# Encounter migration — retiring `session_notes`, `intervention_plans`, `recommendation_items`

**Status:** E0–E3 done; E4 (intervention plans) and E5 (contract) open
**Decided:** 2026-07-30
**Depends on:** the Phase 3 work in `shadow-tables-audit.md` (done, commits `8520d69`…`aa7b366`)

## 1. Why

Three of the seventeen "keeper" tables turn out not to be keepers. KiviCare already
models a clinical session record — the **encounter** — and it models it better than we
guessed: not one blob, but a container with typed, repeatable children.

The decision to drop SOAP is the user's, made 2026-07-30. SOAP was our own imposition;
KiviCare's `problem` / `observation` / `note` vocabulary is what its UI, its templates
and its print/PDF views already understand. Keeping SOAP would mean our notes stay
invisible to every KiviCare screen forever.

## 2. What KiviCare actually gives us

| Ours | KiviCare | Fit |
|---|---|---|
| `session_notes` (1 per session) | `wp_kc_patient_encounters` (1 per appointment) | exact — `sessionId @unique` ≡ `appointment_id` |
| `session_notes.status` OPEN/CLOSED | `encounters.status` 1/0 | exact |
| `session_notes.content` (SOAP blob) | `encounters.description` + `wp_kc_medical_history` rows (`type` ∈ `note`, `observation`, `problem`) | better — repeatable and typed |
| `session_notes.summary` (200 char) | — | derive on read; no column needed |
| `intervention_plans` (1 per session) | the same encounter | exact — both are 1-per-session |
| `recommendation_items.description` | `wp_kc_prescription.name` | exact |
| `.frequency` / `.durationDays` / `.instructions` | `.frequency` / `.duration` / `.instruction` | exact |
| `recommendation_items.status` + `.completedAt` | — | **no column** — see D1 |

`wp_kc_medical_problems` (start_date, end_date, description, problem_type, outcome) is
a fourth child we are not using yet. Worth remembering when goal tracking comes up.

### The semantic stretch, stated plainly

`wp_kc_prescription` is labelled "Prescription" in KiviCare's UI. A psychologist's
recommendation — "journaling, 3× per week, 30 days" — will appear under that heading.
The columns fit exactly and it *is* what the clinician prescribed, so this is the right
table; but nobody should be surprised by the label later.

## 3. Decisions

**D1 — Completion state lives in `wp_kc_custom_fields_data`** (plural `fields`).
Confirmed present on staging, MyISAM, 169 live rows. KiviCare's own extension point, so
it adds no table, touches no clinical column, and survives plugin updates. Rejected: a
PraktiQU side table (adds a table while we are removing them), and encoding into
`instruction` (corrupts a clinical field).

Two constraints make it safe, both discovered by reading how KiviCare queries it:

- **`module_type` must be `praktiqu_recommendation_status`** — a namespaced value of our
  own, matching the `praktiqu_*` convention already used in `wp_usermeta`.
  **Not `prescription_module`**, even though that is a real KiviCare module type: using
  it would invite KiviCare Pro's custom-field UI to render our JSON as its own field
  values. Every KiviCare read *and* the delete in `KCPatientControllerFilters.php:170`
  are scoped by `module_type`, so a value they never use is invisible and untouchable
  to them.
- **`field_id` must be NULL.** `KCCustomField::getData()` is the one query in the plugin
  not scoped by `module_type` — it matches on `field_id` alone. A NULL never matches it,
  which closes the only leak path.

Verified against `wp_kc_custom_fields_data` module types in live use:
`appointment_module` (114) and `patient_encounter_module` (55). Neither collides.

**D2 — Endpoint paths stay, payloads change.**
`/api/v1/session-notes` and `/api/v1/intervention-plans` keep their URLs. Bodies become
encounter-shaped: `soap` disappears, `entries[]` with `type` appears. The Laravel
front-end changes fields, not flows. Rejected: folding into `/api/v1/encounters` (forces
a flow rewrite) and running both surfaces (defers the break and doubles the code).

**D3 — Data migration is decided after counting, not before.**
The local database is empty (`wp_users` = 0, and 8 of the `wp_kc_*` tables are absent),
so it answers nothing. Staging holds the real rows. Step 0 counts them.

## 4. E0 results (staging `praktiqu_wp314`, measured 2026-07-30)

| Table | Rows | Engine |
|---|---|---|
| `session_notes` | **0** | InnoDB |
| `intervention_plans` | **0** | InnoDB |
| `recommendation_items` | **0** | InnoDB |
| `wp_kc_patient_encounters` | **319** | MyISAM |
| `wp_kc_medical_history` | **1167** | MyISAM |
| `wp_kc_prescription` | **88** | MyISAM |
| `wp_kc_patient_encounters_template` | 47 | MyISAM |
| `wp_kc_patient_encounters_template_mapping` | 15 | MyISAM |
| `wp_kc_medical_problems` | 0 | MyISAM |
| `wp_kc_custom_fields` | 1 | MyISAM |

**This settles the argument.** Our three tables are empty — nobody has ever written a
SOAP note through PraktiQU. Meanwhile clinicians have recorded **319 encounters and
1167 medical-history entries** in KiviCare. The real clinical record was never in our
tables; we built a parallel feature nobody used, exactly as with `clients` vs
`wp_users`. There is no data to preserve and no user habit to break.

**Gate 2 → phase E6 is deleted.** No migration script is needed.

**Gate 3 → moot.** Nothing to re-key.

**Gate 1 → closed, D1 holds.** The first audit queried `wp_kc_custom_field_data`; the
real KiviCare table is **`wp_kc_custom_fields_data`** (plural `fields`, per
`2025_05_04_CreateCustomFieldDataTable.php:11`). Re-measured: it exists, MyISAM, 169
rows, `module_type` ∈ {`appointment_module` 114, `patient_encounter_module` 55}. See D1
for the two constraints that keep our rows out of KiviCare's way.

### 4a. The engine finding — MyISAM changes the design

Every `wp_kc_*` table is **MyISAM**; ours are InnoDB. MyISAM has **no transactions and
no foreign keys**, which has three consequences this migration must respect:

1. **A note is not one atomic write.** An encounter plus its `medical_history` children
   cannot be committed together. A crash mid-write leaves an encounter with some of its
   entries. Writes must be ordered so the partial state is coherent — parent first,
   children after — and reads must tolerate an encounter with zero entries.
2. **`BEGIN`/`COMMIT` around these tables is theatre.** Wrapping them in
   `prisma.$transaction` compiles and runs, silently guaranteeing nothing. Any such
   wrapper is a false comfort and should be replaced by explicit ordering plus a repair
   path, not left in place looking safe.
3. **Table-level write locking.** A slow write to `wp_kc_medical_history` blocks every
   other write to that table, not just the affected rows.

Point 2 is **confirmed, and it is a live defect outside this migration.** `wp_kc_bills`,
`wp_kc_bill_items` and `wp_kc_appointments` are all MyISAM (measured 2026-07-30).
`markBillPaid` in `src/services/payments/payment.service.ts` wraps updates to the bill,
the encounter and the appointment in `prisma.$transaction` and relies on it for
atomicity that the storage engine cannot provide. A failure between those three writes
leaves a bill marked paid with the encounter or appointment untouched, and nothing
rolls back. Needs its own fix: order the writes so the earliest one is the one that can
be safely retried, and make the whole thing re-runnable — the payment path already
re-applies side effects idempotently, so the repair hook exists.

## 5. A defect this work has to fix

`createEncounter` and `updateEncounter` in `src/services/billing/encounter.service.ts`
write with Prisma directly, so they fire none of KiviCare's encounter hooks —
`kc_encounter_save`, `kc_encounter_update`, `kc_encounter_closed`. The last one has a
registered listener (`KCEncounterNotificationListener`), which means **closing an
encounter today sends no notification.** Session-note close maps onto encounter close,
so this stops being a latent bug the moment clinicians use it. Encounter writes move to
the plugin as part of this work — the same D1 rule as patients and appointments.

## 6. Phases

**Phase E0 — Count (blocking).** ✅ done 2026-07-30, except the D1 gate (§4).
Results in §4. Queries kept in `docs/deploy/encounter-E0-staging-audit.{sql,sh}`.

**Phase E1 — Plugin write routes.**
Add `praktiqu-endpoint` routes for encounters, medical history and prescriptions, each
firing the hooks KiviCare declares. Mirrors the existing patient/appointment
controllers. Includes moving the existing `createEncounter`/`updateEncounter` onto them
(§5).

**Phase E2 — Repositories. DONE.**
Smaller than planned, because E1 already shipped the writes
(`replaceEncounterHistory`, `replaceEncounterPrescriptions` in `encounters.write.ts`)
and `billing/medical-history.service.ts` already reads the table with an `encounterId`
filter. Building the two repositories as scoped would have duplicated working code.

What was actually missing was the *narrow* read: one encounter's rows, typed, in order,
with no RBAC scope object and no name joins — the encounter-shaped features authorise
through the encounter itself. That is `src/repositories/wp/clinical-records.repo.ts`,
named to match the plugin controller it pairs with, plus batching helpers so a timeline
does not run one query per encounter. 13 DB-backed contract tests.

**Phase E3 — Session notes onto the encounter. DONE.**
A note is now the encounter for the session's appointment; the note id IS the encounter
id. Body = `description` + typed `medical_history` entries. OPEN/CLOSED = status 1/0.
`summary` is derived on read — there is no column, and a stored copy would drift from
the text it summarises. SOAP and `formatSoapToContent` are deleted, not deprecated.

Two things fell out of the rewrite:

- CLINIC_ADMIN listing is scoped by `clinic_id` directly now. An encounter carries one;
  `session_notes` did not, which is why the previous version had to resolve the clinic's
  doctor roster first.
- `?search=` moved out of SQL. The text lives across `description` plus N history rows,
  so there is no single column to match on; the page is filtered after the read.

Closing a note calls `closeEncounter`, which fires `kc_encounter_closed` — the listener
that mails the patient their notes and prescription, and which nothing in KiviCare core
or Pro had ever triggered.

**Phase E4 — Intervention plans onto the encounter.**
Rewrite `src/services/intervention-plan/service.ts`: the plan *is* the encounter, items
become prescriptions, completion state goes to custom field data per D1. Item
completion stays a PraktiQU-only endpoint — KiviCare has no concept of it.

**Phase E5 — Contract + front-end.**
Regenerate `openapi.yaml`, update the Postman collection, and hand the Laravel team the
field-level diff. Ships together with E3/E4 — there is no interim release where both
shapes are valid.

**~~Phase E6 — Data migration.~~ Deleted.** E0 measured 0 rows in all three tables.
There is nothing to migrate.

## 7. Not in scope

- Dropping any table. The user asked explicitly to leave them standing until staging is
  verified working. They cost disk and confusion, nothing else.
- `wp_kc_medical_problems` and goal tracking.
- `payment_orders`, the auth mirror, audit logs — those stay ours by design.
