# KiviCare API Port — Implementation Documentation

**Status:** Complete · **Delivered:** 8 slices across 11 pull requests (PRs #3–#13, all merged to `main`)
**Scope:** ~160 new REST endpoints porting the KiviCare WordPress plugin's API surface onto the PraktiQU Next.js layer.

This document is the authoritative reference for what was built, how it works, the conventions every module follows, and the decisions taken along the way. It reflects the code as merged (verified against the route files and `kc-permissions.ts`, not from memory).

---

## 1. Overview

PraktiQU wraps the KiviCare WordPress plugin behind a typed Next.js 14 (App Router) API. The billing + taxes slice (PR #2, pre-existing) proved the pattern; this port completes the remaining endpoint groups.

- **Total v1 surface after the port:** 259 endpoints across 186 route files (this includes ~99 pre-existing endpoints — auth, sessions, professionals, clients, practices, bills, consent-forms, custom-fields, email-templates, session-notes, intervention-plans, etc.).
- **Added by this port:** ~160 endpoints across 8 slices.
- **Data source of truth:** the live WordPress MySQL database (`wordpress-praktiqu`). Most new modules read/write the real `wp_kc_*` tables via `prisma.$queryRawUnsafe` (the "KC pattern"); a few extend already-started modules using the standard Prisma/`NextResponse` pattern.

### Slice inventory

| Slice | Module | Endpoints | PR | Branch |
|-------|--------|-----------|----|--------|
| 1 | Complete in-progress (professionals, sessions, practices, clients, auth, consent/custom-fields, doctor-services) | ~45 | #3 | `feat/kc-complete-in-progress` |
| 2 | Public booking | 12 | #4 | `feat/kc-public-booking` |
| 3 | Encounters | 9 | #5 | `feat/kc-encounters` |
| 4 | Prescriptions + Medical History | 13 | #6 | `feat/kc-prescriptions-medical-history` |
| 5 | Patient Medical Reports | 10 | #7 | `feat/kc-patient-medical-reports` |
| 6 | Receptionists + Doctor Sessions | 18 | #8 | `feat/kc-receptionists-doctor-sessions` |
| 7 | Clinic Schedules + Dashboard | 12 | #9 | `feat/kc-schedules-dashboard` |
| 8d | Bulk Import | 3 (9 entities) | #10 | `feat/kc-advanced` |
| 8a | Patient Rating | 5 | #11 | `feat/kc-rating` |
| 8c | Followups | ~18 | #12 | `feat/kc-followups` |
| 8b | GDPR | 11 | #13 | `feat/kc-gdpr` |

Each slice: one design/plan doc under `docs/superpowers/plans/` → one branch → one PR → security review → merge.

---

## 2. Architecture & patterns

### 2.1 Two request patterns

The codebase has **two coexisting conventions**; new code follows whichever the target module already uses.

**KC pattern** (all Slice 3–8 modules + bills/taxes) — for endpoints backed by WordPress `wp_kc_*` tables:
```ts
export const GET = withAuth(async (req, ctx) => kcHandle(async () => {
  const { actor } = ctx as any;
  assertCan(actor, '<capability>');           // 403 if role lacks it
  const kc = await resolveKcActor(actor);      // JWT actor → { wpUserId, clinicId }
  const data = await someService(params, scopeFor(kc));
  return kcOk(data, 'message');                // { status: true, message, data }
}));
```
- `withAuth` (`src/lib/auth.ts`) verifies the JWT and supplies `401` + an `AuthContext` (`actor`, `ip`, `userAgent`).
- `kcHandle`/`kcOk`/`kcFail`/`KcError` (`src/lib/kc-response.ts`) — envelope `{ status, message, data }`; `kcHandle` catches `KcError` and maps it to the right HTTP status.
- `assertCan` (`src/services/billing/kc-permissions.ts`) — capability gate.
- `resolveKcActor` (`src/services/billing/kc-actor.ts`) — resolves the PraktiQU JWT actor to `KcActor { actor, wpUserId: bigint, clinicId: bigint | null }`.

**Standard pattern** (Slice 1 extensions to professionals/sessions/practices/clients/auth) — plain `NextResponse.json`, `getActor`/`withAuth`, and RFC-7807 problem-details (`src/lib/problem-details.ts`).

### 2.2 Data access

- **WP tables:** read via `prisma.$queryRawUnsafe` (parameterized `?` — never string interpolation of user input), or via `Kc*` Prisma models mapped to the WP tables (`KcPatientEncounter`, `KcPrescription`, `KcMedicalHistory`, `KcPatientMedicalReport`, `KcReceptionistClinicMapping`, `KcUser`, `KcUserMeta`, `KcClinicSession`, `KcBill`, `KcTax`, …). Models were added for typed writes; scoped joins use raw SQL.
- **BigInt IDs:** WP tables use `bigint`; converted with `Number()`/`BigInt()` at the boundary.
- **Amounts:** stored as `varchar`; parsed with `CAST(... AS DECIMAL)` / `Number()`.
- **UTC:** followup/GDPR tables use `*_utc` columns written via `UTC_TIMESTAMP()`/`NOW()`.

### 2.3 Role scoping

Every KC module derives a **scope** from the actor and applies it to every read/mutation. The shape varies by what the table exposes:

- **Direct columns** (encounters, doctor-sessions, dashboard, appointments): `clinic_id`/`doctor_id` filtered directly.
- **Join/EXISTS** (prescriptions, medical-history, patient-reports, ratings, schedules): the leaf table lacks `doctor_id`/`clinic_id`, so scope is derived by joining the parent encounter or `wp_kc_*_clinic_mappings`.
- **Self-scope** (GDPR consents/export, rating create): a `CLIENT` is forced to their own `wpUserId`; they cannot act on another subject.

`SUPER_ADMIN` is unscoped; `CLINIC_ADMIN`/`RECEPTIONIST` are clinic-scoped; `PROFESSIONAL` is doctor-scoped; `CLIENT` is self-scoped where applicable.

---

## 3. Capability matrix

31 capabilities gate the KC modules (from `src/services/billing/kc-permissions.ts`). ✅ = allowed.

| Capability | SUPER_ADMIN | CLINIC_ADMIN | PROFESSIONAL | RECEPTIONIST | CLIENT |
|---|:--:|:--:|:--:|:--:|:--:|
| patient_bill_list / _view | ✅ | ✅ | ✅ | ✅ | ✅ |
| patient_bill_add | ✅ | ✅ | ✅ | ✅ | |
| patient_bill_delete | ✅ | ✅ | | ✅ | |
| tax_read | ✅ | ✅ | ✅ | ✅ | |
| tax_manage | ✅ | ✅ | | | |
| encounter_read | ✅ | ✅ | ✅ | ✅ | ✅ |
| encounter_manage | ✅ | ✅ | ✅ | | |
| prescription_read | ✅ | ✅ | ✅ | ✅ | ✅ |
| prescription_manage | ✅ | ✅ | ✅ | | |
| medical_history_read | ✅ | ✅ | ✅ | ✅ | ✅ |
| medical_history_manage | ✅ | ✅ | ✅ | | |
| patient_report_read | ✅ | ✅ | ✅ | ✅ | ✅ |
| patient_report_manage | ✅ | ✅ | ✅ | ✅ | |
| receptionist_read | ✅ | ✅ | | ✅ | |
| receptionist_manage | ✅ | ✅ | | | |
| doctor_session_read | ✅ | ✅ | ✅ | ✅ | |
| doctor_session_manage | ✅ | ✅ | ✅ | | |
| schedule_read | ✅ | ✅ | ✅ | ✅ | |
| schedule_manage | ✅ | ✅ | ✅ | | |
| dashboard_read | ✅ | ✅ | ✅ | ✅ | |
| import_manage | ✅ | ✅ | | | |
| rating_read | ✅ | ✅ | ✅ | ✅ | ✅ |
| rating_manage | ✅ | ✅ | | | ✅ |
| followup_read | ✅ | ✅ | ✅ | ✅ | |
| followup_manage | ✅ | ✅ | ✅ | | |
| gdpr_read / gdpr_manage / gdpr_export | ✅ | ✅ | | | ✅ |
| gdpr_audit_read | ✅ | ✅ | | | |
| gdpr_delete | ✅ | | | | |

---

## 4. Module reference

Each module below lists its endpoints, backing table(s), capability, and notable behavior. Service code lives under `src/services/billing/`; routes under `src/app/api/v1/`.

### Slice 1 — Complete in-progress (PR #3)
Extended already-started modules with the missing bulk/export/credential/auth operations:
- **Professionals:** `POST /bulk/delete`, `POST /bulk/status`, `GET /export`, resend-credentials (single + bulk, **501 stubs**).
- **Sessions:** `POST /bulk/delete`, `GET /export`, `GET /{id}/print-invoice` (redirect), `GET /{id}/summary`, payment webhooks + `regenerate-video-conference` (**501 stubs**).
- **Practices:** `POST /bulk/delete`, `POST /bulk/status`, `GET /export`, `GET /{id}/users`, `POST /{id}/change-admin`, resend-credentials (**501**).
- **Clients:** `POST /bulk/delete`, `POST /bulk/status`, `GET /export`, `GET /{id}/statistics`, resend-credentials (**501**).
- **Auth:** `POST /register`, `POST /change-password`, `POST /reset-password` (**501**), `DELETE /delete-account`.
- **Consent forms / Custom fields:** `DELETE /consent-forms/{id}`, `POST /consent-forms/status`, `POST /custom-fields/status`, `POST /save-data`, `GET /get-data`, `POST /file-upload` (**501**).
- **Doctor services:** `POST /professionals/{id}/services/bulk/delete`, `/bulk/status`, `GET /export`.

Convention: "bulk/delete" = **soft-deactivate** (KiviCare "delete" semantics), not a hard delete.

### Slice 2 — Public booking (PR #4) — `/api/v1/public`
Unauthenticated patient-facing widget endpoints:
`GET /practices`, `GET /practices/{id}`, `GET /professionals` (pre-existing), `GET /professionals/{id}/slots`, `GET /professionals/{id}/services` (reworked WP→Prisma), `GET /static-data`, `GET /config`, **`POST /appointments`** (canonical booking, rate-limited), `GET /appointments/{token}`, `POST /appointments/{token}/cancel`, `POST /payment-verify` (**501**), `GET /rating/{id}` (rating prompt). `POST /booking` deprecated → 308 to `/appointments`.
- **Guest access = stateless HMAC token** (`src/lib/public/appointment-token.ts`): `HMAC-SHA256(appointmentId, AUTH_SECRET)`, constant-time verify, no DB column, no raw-id acceptance. Fails fast if `AUTH_SECRET` is unset in production.
- **Rate limiting** on `POST /appointments` via the existing sliding-window limiter (`src/lib/rate-limit.ts`), keyed on `(ip, email)`, 429 + `Retry-After`.

### Slice 3 — Encounters (PR #5) — `/api/v1/encounters`, `wp_kc_patient_encounters`
`GET` list, `POST`, `GET/PUT/DELETE /{id}`, `POST /bulk/delete`, `POST /bulk/status`, `GET /export`, `GET /{id}/print` (HTML view). Direct clinic/doctor scope; status `0=closed / 1=open`.

### Slice 4 — Prescriptions + Medical History (PR #6)
- **Prescriptions** (`wp_kc_prescription`): `GET`, `POST`, `GET/PUT/DELETE /{id}`, `POST /bulk/delete`, `GET /export`.
- **Medical History** (`wp_kc_medical_history`): `GET`, `POST`, `GET/PUT/DELETE /{id}`, `GET /export`.
Neither leaf table carries `doctor_id`/`clinic_id` → scope via a **JOIN to `wp_kc_patient_encounters`** (`leafScopeFor`). Create derives `patient_id` from the encounter (not the request body — data-integrity fix from review).

### Slice 5 — Patient Medical Reports (PR #7) — `/api/v1/patient-medical-reports`, `wp_kc_patient_medical_report`
`GET`, `POST`, `GET/DELETE /{id}`, `GET /export`, `POST /bulk/delete`, `GET /{id}/file` (resolves the WP media attachment). `preview`/`print`/`send-email` are **501 stubs** (this table is an upload registry, not a document generator). Clinic scope via `wp_kc_patient_clinic_mappings` EXISTS.

### Slice 6 — Receptionists + Doctor Sessions (PR #8)
- **Receptionists** (`wp_users` + `kiviCare_receptionist` capability + `wp_kc_receptionist_clinic_mappings`): `GET`, `POST` (**full WP-user provisioning** in a single interactive `$transaction`), `GET/PUT/DELETE /{id}`, `POST /bulk/delete`, `POST /bulk/status`, `GET /export`, resend-credentials (single + bulk, **501**). Soft-delete = `user_status = 1`.
- **Doctor Sessions** (`wp_kc_clinic_sessions`): `GET`, `POST`, `GET/PUT/DELETE /{id}`, `POST /bulk/delete`, `GET /export`, `GET /module`. `TIME` columns handled as `HH:mm:ss` strings. `bulk/status` intentionally omitted (no status column).
- Fixed a latent `resolveKcActor` bug: RECEPTIONIST now resolves clinic via the receptionist mapping (was reading the doctor mapping).

### Slice 7 — Clinic Schedules + Dashboard (PR #9)
- **Clinic Schedules** (`wp_kc_clinic_schedule`): `GET`, `POST`, `GET/PUT/DELETE /{id}`, `POST /get-unavailable-schedule`, `GET /module`. `module_type ∈ {clinic,doctor}`; clinic-admins also see their clinic's doctors' schedules via a mapping subquery.
- **Dashboard** (read-only aggregates over `wp_kc_appointments` + `wp_kc_bills`): `GET /statistics`, `/recent-payments`, `/top-professionals`, `/upcoming-sessions`, `/revenue-chart`. Revenue via `CAST(actual_amount AS DECIMAL)`; the `DATE_FORMAT` bucket is enum-constrained (never user input).

### Slice 8d — Bulk Import (PR #10) — `/api/v1/import`
`POST /import`, `POST /import/validate` (dry-run), `GET /import/templates`. A generic engine + 9 per-entity adapters (taxes, services, clinics, appointments, encounters, prescriptions, medical-history, doctors, patients). Real CSV (`papaparse`) + JSON, conflict strategies (`error`/`skip`/`update`), per-row error collection. Doctors/patients are WP-provisioned. **Synchronous** (design's `/jobs` endpoints omitted — no background worker). Clinic forced from the actor for non-super (a shared `clinic-scope.ts` helper).

### Slice 8a — Patient Rating (PR #11) — `/api/v1/ratings`, `wp_kc_patient_review`
`GET`, `POST`, `GET/DELETE /{id}`, `GET /stats`. A CLIENT's `patient_id` is forced to the actor (no reviews-as-another-patient). Clinic-admin scope via the doctor→clinic mapping. `rating_manage` excludes PROFESSIONAL (no self-reviews).

### Slice 8c — Followups (PR #12)
- **Chains** (`wp_kc_followup_chains`): `GET`, `POST`, `GET/PUT /{id}`.
- **Followups** (`wp_kc_followups`): `GET`, `POST`, `GET/PUT/DELETE /{id}`, `POST /{id}/complete`, `/cancel`, `POST /bulk/status`, `GET /due`, `GET /{id}/activity`. A followup **requires a chain** (`chain_id` NOT NULL); status changes write an **activity-log** row.
- **Reminders**: `GET/POST /followups/{id}/reminders`, `DELETE /followup-reminders/{id}`, `POST /followups/{id}/send-reminder` (immediate **email** via `sendEmail`; sms/push + scheduled → **501**).

### Slice 8b — GDPR (PR #13) — `/api/v1/gdpr`
- **Consent versions** (`wp_kc_gdpr_consent_versions`): `GET`, `POST` (admins), `GET /{id}`, `POST /{id}/activate` (single active per type).
- **Consents** (`wp_kc_gdpr_consents`): `GET`, `GET /{id}`, `POST` (grant; CLIENT forced to self), `POST /{id}/withdraw`.
- **Audit log** (`wp_kc_gdpr_audit_log`, 835 live rows): `GET` — **read-only** (the `checksum` chain is never written).
- **Data rights:** `POST /data-export` (profile + appointments + encounters + prescriptions + medical-history + bills; CLIENT self only), `POST /data-delete` (**reversible soft-flag** — usermeta markers + `user_status=1`, no rows deleted; **SUPER_ADMIN only**).

---

## 5. Cross-cutting conventions

- **501 stubs** for unwired integrations (WP credential email, payment gateways, video conferencing, SMS/push, custom-field file upload, medical-report generation). They authenticate first, then return `{ code: 'NOT_IMPLEMENTED', message }` / `501`.
- **Soft-delete** = deactivate (status/`user_status`), matching KiviCare's "delete" semantics; reversible.
- **WP-user provisioning** (receptionists, imported doctors/patients): `wp_users` + serialized capability meta (`a:1:{s:<len>:"kiviCare_<role>";b:1;}` — length must match) + clinic mapping, all in one interactive `$transaction` for connection-safe `LAST_INSERT_ID()`, parameterized.
- **GDPR audit log is read-only** — the tamper-evident `checksum` chain is maintained by the WP plugin; this API never writes it.
- **Export endpoints** return JSON (with `Content-Disposition: attachment` where applicable).
- **SQL safety:** every user value is a bound `?`; only static column names / placeholder lists / fixed-union identifiers are interpolated.

---

## 6. Decisions log (the genuine forks)

Choices that shaped modules, decided with the product owner where they weren't derivable from code:

1. **Public booking** — migrate `POST /booking` → canonical `POST /appointments` (308 deprecation); stateless HMAC guest token; rating implemented as a prompt read, payment-verify stubbed.
2. **Prescriptions + Medical History** — source of truth is the **WP tables** (not the vestigial Prisma-native models); scope via encounter join.
3. **Patient Medical Reports** — the table is an **upload registry**, not a generator → faithful CRUD + media resolution; generate/preview/email stubbed; clinic-scoped via patient-clinic mapping.
4. **Receptionists** — **WP tables** + **full WP-user provisioning** on create; resend-credentials stubbed.
5. **Import** — **synchronous** (no job table); real CSV+JSON; build all 9 entities fully.
6. **Followups** — reminder **rule CRUD + immediate email send**; sms/push + scheduled dispatch → 501.
7. **GDPR** — **soft-flag** erasure (reversible, SUPER_ADMIN only); export bundle = profile + appointments + encounters + prescriptions + medical-history + bills; audit log read-only.

---

## 7. Testing strategy & the DB constraint

- **Environment has only the live `wordpress-praktiqu` database** — there is no separate test DB. `tests/billing/fixtures.ts` guards every fixture with `assertTestDb()` (refuses unless `DATABASE_URL` matches `/test/i`).
- Consequently, **DB-backed suites are written but not executed in this environment** — they run where a real test DB exists. They were never run against the live DB, and the GDPR audit-log table was never written by any fixture.
- **What runs here every slice:** the pure-unit capability tests (`kc-permissions.test.ts`), the DB-free route auth-matrix tests (401/403 resolve before any DB call, since `assertCan` runs before `resolveKcActor`), the import engine unit test (mocked adapters), and `tsc --noEmit`.
- **Per-slice test files** (DB-backed unless noted): `tests/billing/<module>.service.test.ts` + `<module>-routes.integration.test.ts`.
- Every slice passed a dedicated **spec + security review** (SQL injection, scope/IDOR, capability gating, and module-specific risks) before merge.

## 8. Notable bugs caught in review

- **Inverted WP appointment-status mapping** (Slice 2): cancel would have written `BOOKED` instead of `CANCELLED` — fixed; ground-truth mapping documented (`CANCELLED=0, BOOKED=1, PENDING=2, CHECK_OUT=3, CHECK_IN=4`).
- **Missing `withAuth`** on the initial practices (Slice 1) and consent/custom-fields (Slice 1) routes — all gated before merge.
- **CLIENT self-access check** compared User id to Client row id (Slice 1 statistics) — corrected to `client.userId === actor.id`.
- **Cross-tenant import** — non-super actors could target another clinic via a row's `clinic_id` when their resolved clinic was null; normalized to actor-only resolution (Slice 8d).
- **`resolveKcActor` RECEPTIONIST** read the doctor mapping (Slice 6) — fixed to the receptionist mapping.
- **Prescription/report `patient_id`** trusted from the request body — derived from the encounter instead (Slice 4).

## 9. Known limitations / follow-ups

- **Unwired integrations** remain 501 stubs (email credential delivery, payment gateways, video conferencing, SMS/push reminders, scheduled reminder dispatch, custom-field & medical-report file handling).
- **Reminder scheduling** stores rules but has no background worker; only immediate email send is wired.
- **GDPR erasure** is a reversible soft-flag; if hard erasure is ever required it needs a separate, audited implementation.
- **DB-backed tests** need a dedicated `wordpress-praktiqu-test` database to execute in CI.
- Minor, non-blocking: clinics can be imported by a CLINIC_ADMIN (not clinic-scoped by nature); reminder email HTML is unescaped (patient's own data to their own address).

---

## Appendix — file map

- **Routes:** `src/app/api/v1/<module>/**/route.ts`
- **Services:** `src/services/billing/*.service.ts` + `src/services/billing/import/*` + `src/services/public/*`
- **Auth/permissions:** `src/lib/auth.ts`, `src/services/billing/kc-actor.ts`, `src/services/billing/kc-permissions.ts`
- **Helpers:** `src/lib/kc-response.ts`, `src/lib/problem-details.ts`, `src/lib/rate-limit.ts`, `src/lib/email.ts`, `src/lib/public/appointment-token.ts`
- **Scope helpers:** `kc-leaf-scope.ts`, `staff-scope.ts`, `schedule-scope.ts`, `followup-scope.ts`, `med-report-scope.ts`, `import/clinic-scope.ts`
- **Plans:** `docs/superpowers/plans/2026-07-*.md` (one per slice)
- **Validation:** `src/services/billing/validation.ts` + `src/services/billing/import/validation.ts`
