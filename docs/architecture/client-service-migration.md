# Phase 3.1 — Migrating `client.service.ts` off the `clients` table

**Date:** 2026-07-26
**Status:** Design complete, execution blocked on one decision (§3)
**Parent:** [shadow-tables-audit.md](./shadow-tables-audit.md)

This is the flagship case: *"client itu harusnya diambil dari `wp_users` dengan role
patient"*. The repositories to do it exist ([`patients.repo.ts`](../../src/repositories/wp/patients.repo.ts),
[`patients.write.ts`](../../src/repositories/wp/patients.write.ts)); this is about
switching the service and its 10 routes over.

---

## 1. Why this cannot be done incrementally

`client.service.ts` exports 13 functions across 10 routes. **A partial conversion is
worse than none.** If `createClient` still writes the `clients` table while
`listClients` reads `wp_users`, every newly created client becomes invisible
immediately — a data-loss-shaped bug that looks like a UI failure.

So this migrates in one commit, or not at all.

## 2. Function-by-function mapping

| Function | Today | After | Notes |
|---|---|---|---|
| `createClient` | `prisma.client.create` | `createPatient()` → plugin REST | Fires `kc_patient_save` (welcome email) |
| `getClient` | `prisma.client.findUnique` | `findPatientById()` | direct SQL |
| `listClients` | `prisma.client.findMany` | `listPatients()` | search already supported |
| `updateClient` | `prisma.client.update` | `updatePatient()` → plugin REST | merges `basic_data` |
| `enforceClientReadAccess` | in-memory on `practiceId` | needs `wp_kc_patient_clinic_mappings` | **§4** |
| `setStatus` | `status` column | ??? | **BLOCKED — §3** |
| `archiveClient` | `status = ARCHIVED` | ??? | **BLOCKED — §3** |
| `bulkArchiveClients` | ids: `string[]` | ids: `number[]` | signature change |
| `bulkSetClientStatus` | ids: `string[]` | ids: `number[]` | signature change |
| `exportClients` | `prisma.client` | `listPatients()` | |
| `getClientStatistics` | joins shadow tables | `listAppointments({patientId})` | |
| `ClientServiceError` | — | unchanged | |
| `InvalidStatusTransitionError` | — | unchanged | |

Type changes that ripple outward: `Client.id` and every `clientId` become `number`
(WP user ID) instead of a cuid `string`. Per **D2** this breaks the API contract in one
release with no compat shim, so `openapi.yaml`, the Postman collection and the Laravel
front-end move together.

---

## 3. ⚠️ BLOCKER — client status has no clean home in WordPress

Our model has **three** states (`ACTIVE` / `INACTIVE` / `ARCHIVED`). WordPress offers
one integer column, `wp_users.user_status`, and **KiviCare's own use of it is
self-contradictory**:

- `KCPatient::initSchema` maps `status` → `user_status` with **`'default' => 1`**
  (`KCPatient.php:83-88`).
- `KCWPUser::updateStatus` maps the string `'active'` → **`0`**, and the integer
  `1` → **`1`** (`KCWPUser.php:163-165`). So under that function, `0` means active.
- `PatientController` never encodes a convention at all — it passes the caller's value
  straight into `WHERE p.user_status = ?` (line 934).

So `user_status = 1` means *inactive* to one code path and *active* (the schema
default) to another. **Neither local database has a single `wp_users` row**, so there is
nothing to disambiguate against empirically. Only staging/production data can settle it.

This is the same shape as the appointment-status trap that previously caused cancelled
appointments to be marked BOOKED — an inverted ordinal that fails silently. It must not
be guessed at.

And regardless of how `ACTIVE`/`INACTIVE` resolve, **`ARCHIVED` has no home**: a binary
column cannot carry a third state.

### Options

| | Approach | Pros | Cons |
|---|---|---|---|
| **A** *(recommended)* | Status lives entirely in `wp_usermeta.praktiqu_client_status` (`ACTIVE`/`INACTIVE`/`ARCHIVED`); `user_status` untouched | Unambiguous, supports all 3 states, no guessing, no risk of inverting KiviCare's meaning | KiviCare's own admin UI won't reflect our status changes |
| **B** | Map `ACTIVE`/`INACTIVE` → `user_status`, `ARCHIVED` → a separate meta flag | Status visible to KiviCare | Requires resolving the 0/1 contradiction first; split-brain across two fields |
| **C** | Drop `ARCHIVED`, use `user_status` only | Simplest storage | Loses soft-delete; historical sessions lose their stable FK, which is the reason ARCHIVED exists |

**Recommendation: A.** It is the only option that cannot silently invert a meaning, and
the KiviCare admin UI is not the system of record for PraktiQU client lifecycle.

---

## 4. Clinic scoping

`enforceClientReadAccess` currently scopes on `Client.practiceId`. The WP equivalent is
`wp_kc_patient_clinic_mappings` — which was **missing from both local databases** until
the provisioning script added it to the test DB (audit §3a). It is still absent from the
dev database, so this access-control path cannot be exercised there.

`patients.repo.ts` needs a `clinicIds` filter (a join or `EXISTS` on that table) before
`enforceClientReadAccess` can be ported faithfully. Not blocked — just not yet written.

---

## 5. Execution order, once §3 is decided

1. Add `clinicIds` filtering to `patients.repo.ts` (+ contract tests).
2. Add status read/write to `patients.repo.ts` / `patients.write.ts` per the §3 decision.
3. Rewrite all 13 `client.service.ts` functions in one commit; keep the exported names
   so the 10 routes change only in ID types.
4. Update `src/types/client.ts`: `id: string` → `number`.
5. Regenerate `openapi.yaml`; refresh Postman; coordinate the Laravel front-end (D2).
6. Delete the `Client` model from `schema.prisma` and drop the `clients` table
   (Phase 4 — still gated on the staging row-count check).

**Estimate:** ~2 days after the decision, excluding front-end work.
