# Encounter migration — retiring `session_notes`, `intervention_plans`, `recommendation_items`

**Status:** planned, not started
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

**D1 — Completion state lives in `wp_kc_custom_field_data`.**
`module_type = 'prescription'`, `module_id` = the prescription id, `fields_data` a JSON
blob holding `{status, completedAt}`. This is KiviCare's own extension point, so it adds
no table, touches no clinical column, and survives plugin updates. Rejected: a small
PraktiQU side table (adds a table while we are removing them), and encoding into
`instruction` (corrupts a clinical field).

**D2 — Endpoint paths stay, payloads change.**
`/api/v1/session-notes` and `/api/v1/intervention-plans` keep their URLs. Bodies become
encounter-shaped: `soap` disappears, `entries[]` with `type` appears. The Laravel
front-end changes fields, not flows. Rejected: folding into `/api/v1/encounters` (forces
a flow rewrite) and running both surfaces (defers the break and doubles the code).

**D3 — Data migration is decided after counting, not before.**
The local database is empty (`wp_users` = 0, and 8 of the `wp_kc_*` tables are absent),
so it answers nothing. Staging holds the real rows. Step 0 counts them.

## 4. Blockers to clear first

These are verification gates, not tasks — each can change the plan.

1. **Does `wp_kc_custom_field_data` exist on staging?** It is missing locally. D1 is
   built on it. If KiviCare's migration never ran there, D1 falls back to the side table.
2. **How many rows in `session_notes` / `intervention_plans` / `recommendation_items` on
   staging?** Zero means no migration script at all.
3. **Do any of those rows reference sessions that no longer exist?** Their `sessionId` is
   an unconstrained string that used to hold an `appointments` cuid. Rows pointing at
   the old shadow table cannot be mapped to an encounter and must be reported, not
   silently dropped.

## 5. A defect this work has to fix

`createEncounter` and `updateEncounter` in `src/services/billing/encounter.service.ts`
write with Prisma directly, so they fire none of KiviCare's encounter hooks —
`kc_encounter_save`, `kc_encounter_update`, `kc_encounter_closed`. The last one has a
registered listener (`KCEncounterNotificationListener`), which means **closing an
encounter today sends no notification.** Session-note close maps onto encounter close,
so this stops being a latent bug the moment clinicians use it. Encounter writes move to
the plugin as part of this work — the same D1 rule as patients and appointments.

## 6. Phases

**Phase E0 — Count (blocking).**
Read-only queries against staging for the three gates in §4. Output: row counts, a
sample of unmappable rows, and a yes/no on `wp_kc_custom_field_data`. No code.

**Phase E1 — Plugin write routes.**
Add `praktiqu-endpoint` routes for encounters, medical history and prescriptions, each
firing the hooks KiviCare declares. Mirrors the existing patient/appointment
controllers. Includes moving the existing `createEncounter`/`updateEncounter` onto them
(§5).

**Phase E2 — Repositories.**
`src/repositories/wp/medical-history.repo.ts` and `prescriptions.repo.ts` — reads direct
SQL, writes via E1 — plus contract tests in the 7.8M–8.9M id range like the others.
`encounters` already has a service; it gains a repo only if E1 forces the split.

**Phase E3 — Session notes onto the encounter.**
Rewrite `src/services/session-notes/service.ts`: a note becomes an encounter plus its
`medical_history` children. `summary` is derived on read rather than stored. SOAP
formatting and its validation schema are deleted, not deprecated. Authorship and the
lock rules already read the WP session (done in Phase 3.8) and carry over unchanged.

**Phase E4 — Intervention plans onto the encounter.**
Rewrite `src/services/intervention-plan/service.ts`: the plan *is* the encounter, items
become prescriptions, completion state goes to custom field data per D1. Item
completion stays a PraktiQU-only endpoint — KiviCare has no concept of it.

**Phase E5 — Contract + front-end.**
Regenerate `openapi.yaml`, update the Postman collection, and hand the Laravel team the
field-level diff. Ships together with E3/E4 — there is no interim release where both
shapes are valid.

**Phase E6 — Data migration (only if E0 says so).**
A dry-run-first script: read the old rows, write encounters/history/prescriptions
through the plugin, report anything unmappable. Never deletes the source rows — the old
tables stay until the whole shadow-table DROP happens.

## 7. Not in scope

- Dropping any table. The user asked explicitly to leave them standing until staging is
  verified working. They cost disk and confusion, nothing else.
- `wp_kc_medical_problems` and goal tracking.
- `payment_orders`, the auth mirror, audit logs — those stay ours by design.
