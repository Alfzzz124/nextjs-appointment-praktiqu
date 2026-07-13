# Endpoint Audit — 12 July 2026

**Created:** 2026-07-12  ·  **Author:** automated audit pass  ·  **Predecessor:** [2026-07-06 handover](../handover/2026-07-06-staging-endpoint-testing.md)
**Target:** `https://staging2.praktiqu.com/api/v1` (staging, Cloudflare, HTTP/2)
**Scope:** all **259 operations** / 186 route paths / 30 resource groups.

---

## ★★★ CODE-FIX — 2026-07-13 (public booking funnel, verified locally) ★★★

Local functional test of all 14 `/public/*` routes against a schema-correct DB (fresh `prisma db push` + seed) found the funnel broken **at the code level**, independent of the staging DB state:

1. **`POST /public/appointments` always 500** — `createPublicAppointment` was a verbatim KiviCare-era port: `parseInt(professionalId)` on the catalog's **cuid** ids → `NaN` → interpolated into raw `wp_kc_*` SQL → `Unknown column 'NaN'`. The audit never caught this because only empty-body probes (422) were sent. **Fixed:** rewritten onto the Prisma app tables, bridging Professional → Doctor by `userId` (the feature-002 `getBookedRanges` pattern); token now carries the appointment cuid. Lookup/cancel/rating follow the same store.
2. **`/public/professionals/{id}/slots` never blocked booked slots** — it filtered `appointment.doctorId` by the *Professional* id (appointments are keyed by *Doctor* id). Fixed with the same bridge; also now 404s on unknown/inactive professionals and uses canonical `durationMinutes` (was legacy `duration`, so slot length contradicted what `/services` advertised).
3. **Silent 500s** — several public routes swallowed or rethrew errors without logging (why F3 was undiagnosable from responses). All public routes now log and return problem-details 500s.

Verified locally: full E2E hold → create (201) → slot blocked → token lookup → cancel (200/409 on repeat) → slot restored; double-booking → 409; tsc, vitest public-booking suites (26/26), and production build all green. **Staging re-verify pending:** workstation IP is currently edge-blocked (HTTP 403→timeout, SSH drop), so the fix could not be deployed/tested against wp314 yet — the remaining `/public/professionals/{id}/slots` 500 recorded in RE-TEST #2 may additionally involve wp314 column drift on `appointments`; the new logging will surface the exact Prisma error once deployed.

---

## ★★ RE-TEST #2 — 2026-07-12 (against the new staging DB `praktiqu_wp314`) ★★

The DB was switched off the accidental **production** copy (`wp580`, which lacked the app tables) to a proper staging DB **`praktiqu_wp314`** (275 tables incl. the full app schema + 44 `wp_kc_*`; `patient_clinic_mappings` present). Re-ran the full sweep from the server.

**F3 (public-endpoint crashes) — FIXED by the DB switch.** `/public/static-data`, `/public/professionals`, `/public/practices` now return **200** (they only crashed on wp580 because the app tables didn't exist there). `/public/professionals/{id}/slots` still errors (needs a real professional + date).

**Sweep on wp314:** no-token **401 = 222**, non-public 200 leaks **= 0**; authed **GET 200 = 57**, 404 = 27 (probe ids on a sparse DB), 500 = 16. **No auth regressions.**

**Remaining 500s split into two buckets (both non-auth, tracked as F5):**

1. **Auth-status gaps — ✅ FIXED (2026-07-12).** 7 routes (`clients/export`, `clients/{id}/statistics`, `clients/bulk/delete|status`, `professionals/{id}/services/export|bulk/delete|bulk/status`) enforced auth via `getActor` but their `catch` mapped `AuthError`→500 — added the `AuthError→401` branch. `consent-forms/{id}` GET+PATCH had **no gate** (only DELETE did) — added `requireAuth`/`requireRoles`. They failed *closed* (no leak); this corrects the status to 401. tsc clean, guard tests pass.

2. **Data-layer bugs — 📋 BACKLOG (post-MVP).** Not in MVP; deferred pending **payment planning** (billing/invoicing is being built on the **WooCommerce-Xendit** extension, which needs its own design pass). Documented for later:
   - **`NaN → BigInt` RangeError** in the KiviCare bill path — hits `bills/{id}`, `bills/{id}/print`, `bills/by-encounter` even with **real** data (bill 298, data clean). Crash is in a shared billing chunk; not reproducible by static reading — needs a **local wp314 dump** to trace. Impact: viewing/printing an individual invoice (the bill *list* works).
   - **Invalid Prisma `findUnique` invocations** for `consent-forms/{id}`, `custom-fields/{id}`, `notes-templates/{id}` (id type/shape mismatch) — opening a single item in these settings areas (lists work).
   - Several detail-route 500s are just **"probe id not found → crash instead of 404"** on the sparse staging DB (lower severity; would 404 with real data).

**Infra:** wp314 DB connection cap still bites Prisma under burst load (`ERROR 1226`) — recommend `?connection_limit=3` on the **`.htaccess`** `DATABASE_URL` (the `.env` one is overridden). Burst-sweep 500 counts are an upper bound.

**Net vs original audit:** F1/F2/F4 fixed & verified; **F3 fixed** (DB); F5 reduced to ~8 easy auth-status gaps + a handful of KiviCare data-layer bugs best fixed with a local staging DB dump.

---

## ★ RE-TEST — 2026-07-12 (after auth fixes deployed) ★

The auth-fix branch (F1/F2/F4) was deployed to staging and the WP `praktiqu-endpoint` plugin was installed, so login now works with a real **SUPER_ADMIN** account. Re-ran the full 259-endpoint sweep **from the server** (my workstation IP was WAF-blocked from testing volume): all 259 with no token, plus every GET with a valid SUPER_ADMIN token.

**Security findings — all fixed & verified:**

| ID | Before | After | Status |
|----|--------|-------|--------|
| **F1** header-spoof auth (sessions/session-notes/intervention-plans) | header `x-user-*` accepted | **401 without JWT** | ✅ FIXED |
| **F2** missing auth gates (custom-fields, consent-signatures, practices, email/notes-templates) | 4 endpoints returned **200 + data with no token** | **0 non-public 200 leaks**; all now 401 | ✅ FIXED |
| **F4** clients auth errors mislabeled 500 | 500 on no-token | **401** | ✅ FIXED |

- **No-token enforcement: 401 count 169 → 222** (+53). **500s 47 → 14.** **Non-public 200 leaks 4 → 0.** **46 endpoints** flipped from 500/200/400/422 → 401/403. **Zero regressions** (no new leaks, nothing that was enforced broke).
- **Authenticated layer (now testable): 52 GETs return 200** with a SUPER_ADMIN token (dashboards, bills, clients, professionals, sessions, encounters, gdpr, taxes, medical-history, prescriptions, ratings, receptionists, clinic-schedules, doctor-sessions, followups, intervention-plans…). 28 detail routes 404 on a probe id (auth passed). **0 endpoints return 401/403 with a valid token** → JWT verification, secret alignment, and RBAC are all correctly wired.
- Login → 200 with `role: SUPER_ADMIN`; the login/`me` **BigInt serialization bug** (`wpUserId`) that caused the initial 503 was fixed.

**Remaining 500s are NOT auth — they are the F3/F5 DB/data-layer workstream (out of scope for this fix):**
- 6 **public** endpoints still crash (`/public/static-data|professionals|practices|…`): Prisma `staticData.findMany()` / `clinic.findMany()` **"Invalid invocation"** — schema drift vs the live WP DB. `/public/config` works.
- A few authed detail/data endpoints: `professionals/{id}` (a `NaN → BigInt` RangeError), `practices/{id}/users`, `bills/{id}`, consent-signature detail — schema-drift / data-layer bugs.
- **NEW infra finding:** the DB user `praktiqu_wp580` is capped at **`max_user_connections = 5`**, and Prisma's default pool exceeds it under load → **transient 500s and intermittent login failures** (`ERROR 1226`). Several raw-sweep "500s" are actually **200 when tested gently** (e.g. `custom-fields`, `notes-templates`, `consent-signatures`). Fix: add `?connection_limit=3` to `DATABASE_URL` (or raise the MySQL cap). This inflates any burst-test 500 count — treat sweep 500s as an upper bound.

**Net:** the security clusters F1/F2/F4 are closed and verified end-to-end. What's left is the DB-reconciliation workstream (F3/F5) plus the connection-limit config — neither is an auth issue. The original findings and coverage table below are retained for history.

---

## 0. Executive summary

This pass tested **every one of the 259 operations** for their **unauthenticated behavior** (a full auth-enforcement matrix), plus **full functional testing of the public/no-auth endpoints**. The **authenticated business-logic layer could not be functionally tested**: staging uses a JWT signing secret that is not in the repo, `POST /auth/register` is SUPER_ADMIN-only, and no staging login credentials exist locally. Those rows are marked `AUTH-OK` (auth correctly enforced) + `NEEDS-AUTH-DATA` (logic untested).

Even without credentials, the unauthenticated sweep surfaced **three confirmed defect clusters, two of them security-critical:**

| ID | Severity | Finding | Status |
|---|---|---|---|
| **F1** | 🔴 Critical (security) | All 12 `sessions/*` routes authenticate via spoofable `x-user-id` / `x-user-role` **HTTP headers** — no JWT verification. | Confirmed in source; live exploit currently masked by F5 crashes |
| **F2** | 🔴 Critical (security) | Several routes have **no auth gate at all**. `GET /custom-fields` and `GET /consent-signatures` return **HTTP 200 + data with no token**. `GET /practices`, `/practices/{id}`, `/email-templates`, `/notes-templates`, `/consent-forms` also lack a gate (currently 500). | Confirmed live (200) + confirmed in source |
| **F3** | 🟠 High | Public booking-funnel endpoints **crash (500)**: `/public/static-data`, `/public/professionals`, `/public/professionals/{id}/services`, `/public/professionals/{id}/slots`, `/public/practices`, `/public/practices/{id}`. `/public/config` still works. Regression vs 2026-07-06 (which saw `/public/professionals` + `/public/static-data` at 200). | Confirmed live |
| **F4** | 🟡 Medium | `clients` routes return **500 for auth failures that should be 401** — `handleServiceError` only maps `ClientServiceError`, so `AuthError` falls through to the 500 branch. | Confirmed live + source |
| **F5** | 🟠 High (watchlist) | Raw-SQL / `wp_kc_*` + Prisma-schema-drift groups (`email-templates`, `notes-templates`, `practices`, and by inference `bills`/`taxes`/`doctor-sessions`/`dashboard`/etc.) **500 even before auth**. Root cause: staging DB schema drift (incl. `patient_clinic_mappings` vs `wp_kc_patient_clinic_mappings`). | Confirmed for the pre-auth ones; rest need auth to confirm |
| **F6** | ⚪ Info | **11 endpoints are 501 stubs** (payments ×5, resend-credentials ×2, custom-fields file-upload, `POST /practices`, `reset-password`, regenerate-video-conference). | Intentional / incomplete |
| **F7** | ⚪ Low | **Inconsistent error contract:** ≥4 distinct 500 body shapes (`/errors/internal`, `about:blank`, `{"error":"…"}`, `{"error":"internal_error"}`), 2 distinct 401 shapes, and problem-`type` base-URL drift (`staging2.praktiqu.com` vs `praktiqu.example.com`). | Confirmed live |

### Unauthenticated-sweep status distribution (259 ops)

| HTTP | Count | Meaning |
|---|---|---|
| 401 | 169 | auth enforced ✓ |
| 500 | 47 | crash / missing-auth (F2/F4/F5) |
| 400 | 15 | validation |
| 501 | 11 | not-implemented stub (F6) |
| 200 | 4 | success (public — or F2 leak) |
| 422 | 4 | validation |
| 403 | 4 | role-forbidden |
| 404 | 2 | not found (probe id) |
| 308 | 1 | redirect |
| 410 | 1 | gone |
| 307 | 1 | redirect |

---

## 1. Verdict legend

| Verdict | Meaning |
|---|---|
| `OK` | Behaves correctly (public data, or expected validation/redirect) |
| `AUTH-OK` | Correctly rejects unauthenticated call (401/403). Business logic **not** tested (no credentials) → `NEEDS-AUTH-DATA` |
| `BROKEN 🔴` | Security defect (missing/spoofable auth, unauth data) |
| `BROKEN 🟠` | Reliability defect (500 crash / wrong pre-auth behavior) |
| `STUB` | 501 Not Implemented (intentional) |
| `NOTE` | Redirect / needs manual follow-up |

> **Testing constraint:** no valid staging token was obtainable (secret not in repo; register is admin-only; no seeded creds). To complete Phase B/C, supply one login per role — see §5.

---

## 2. Coverage table (259 operations — unauthenticated results)

### auth (9) — ⚠️ 3 broken

| Method | Path | No-token status | Verdict | Notes |
|---|---|---|---|---|
| POST | `/api/v1/auth/change-password` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| DELETE | `/api/v1/auth/delete-account` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| POST | `/api/v1/auth/forgot-password` | 400 | BROKEN 🟠 | 400 before auth — validation runs pre-auth (no auth gate?) |
| POST | `/api/v1/auth/login` | 400 | BROKEN 🟠 | 400 before auth — validation runs pre-auth (no auth gate?) |
| POST | `/api/v1/auth/logout` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| GET | `/api/v1/auth/me` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| POST | `/api/v1/auth/refresh` | 400 | BROKEN 🟠 | 400 before auth — validation runs pre-auth (no auth gate?) |
| POST | `/api/v1/auth/register` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| POST | `/api/v1/auth/reset-password` | 501 | STUB | not implemented (F6) |

### bills (12)

| Method | Path | No-token status | Verdict | Notes |
|---|---|---|---|---|
| GET | `/api/v1/bills` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| POST | `/api/v1/bills` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| GET | `/api/v1/bills/by-encounter/{encounterId}` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| POST | `/api/v1/bills/calculate-tax` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| GET | `/api/v1/bills/encounters-without-bill` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| GET | `/api/v1/bills/export` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| DELETE | `/api/v1/bills/item/{itemId}` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| PUT | `/api/v1/bills/item/{itemId}` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| GET | `/api/v1/bills/{id}` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| PUT | `/api/v1/bills/{id}` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| POST | `/api/v1/bills/{id}/email` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| GET | `/api/v1/bills/{id}/print` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |

### clients (14) — ⚠️ 12 broken

| Method | Path | No-token status | Verdict | Notes |
|---|---|---|---|---|
| GET | `/api/v1/clients` | 500 | BROKEN 🟠 | 401 mislabeled as 500 by handleServiceError (F4); auth IS enforced |
| POST | `/api/v1/clients` | 500 | BROKEN 🟠 | 401 mislabeled as 500 by handleServiceError (F4); auth IS enforced |
| POST | `/api/v1/clients/bulk/delete` | 500 | BROKEN 🟠 | 401 mislabeled as 500 by handleServiceError (F4); auth IS enforced |
| POST | `/api/v1/clients/bulk/resend-credentials` | 501 | STUB | not implemented (F6) |
| POST | `/api/v1/clients/bulk/status` | 500 | BROKEN 🟠 | 401 mislabeled as 500 by handleServiceError (F4); auth IS enforced |
| GET | `/api/v1/clients/export` | 500 | BROKEN 🟠 | 401 mislabeled as 500 by handleServiceError (F4); auth IS enforced |
| DELETE | `/api/v1/clients/{id}` | 500 | BROKEN 🟠 | 401 mislabeled as 500 by handleServiceError (F4); auth IS enforced |
| GET | `/api/v1/clients/{id}` | 500 | BROKEN 🟠 | 401 mislabeled as 500 by handleServiceError (F4); auth IS enforced |
| PATCH | `/api/v1/clients/{id}` | 500 | BROKEN 🟠 | 401 mislabeled as 500 by handleServiceError (F4); auth IS enforced |
| GET | `/api/v1/clients/{id}/custom-fields` | 200 | BROKEN 🔴 | 200 with NO auth — verify unauth access |
| PUT | `/api/v1/clients/{id}/custom-fields` | 400 | BROKEN 🟠 | 400 before auth — validation runs pre-auth (no auth gate?) |
| POST | `/api/v1/clients/{id}/resend-credentials` | 501 | STUB | not implemented (F6) |
| GET | `/api/v1/clients/{id}/statistics` | 500 | BROKEN 🟠 | 401 mislabeled as 500 by handleServiceError (F4); auth IS enforced |
| PATCH | `/api/v1/clients/{id}/status` | 500 | BROKEN 🟠 | 401 mislabeled as 500 by handleServiceError (F4); auth IS enforced |

### clinic-schedules (7)

| Method | Path | No-token status | Verdict | Notes |
|---|---|---|---|---|
| GET | `/api/v1/clinic-schedules` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| POST | `/api/v1/clinic-schedules` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| POST | `/api/v1/clinic-schedules/get-unavailable-schedule` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| GET | `/api/v1/clinic-schedules/module` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| DELETE | `/api/v1/clinic-schedules/{id}` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| GET | `/api/v1/clinic-schedules/{id}` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| PUT | `/api/v1/clinic-schedules/{id}` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |

### consent-forms (6) — ⚠️ 3 broken

| Method | Path | No-token status | Verdict | Notes |
|---|---|---|---|---|
| GET | `/api/v1/consent-forms` | 400 | BROKEN 🟠 | 400 before auth — validation runs pre-auth (no auth gate?) |
| POST | `/api/v1/consent-forms` | 400 | BROKEN 🟠 | 400 before auth — validation runs pre-auth (no auth gate?) |
| POST | `/api/v1/consent-forms/status` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| DELETE | `/api/v1/consent-forms/{id}` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| GET | `/api/v1/consent-forms/{id}` | 404 | AUTH-OK? | 404 for probe id (auth may be bypassed) — verify |
| PATCH | `/api/v1/consent-forms/{id}` | 500 | BROKEN 🟠 | 500 on unauth request — missing auth gate and/or crash (F2/F5) |

### consent-signatures (2) — ⚠️ 2 broken

| Method | Path | No-token status | Verdict | Notes |
|---|---|---|---|---|
| GET | `/api/v1/consent-signatures` | 200 | BROKEN 🔴 | SEC: 200 with NO auth — unauthenticated data access (F2) |
| POST | `/api/v1/consent-signatures` | 400 | BROKEN 🟠 | 400 before auth — validation runs pre-auth (no auth gate?) |

### custom-fields (9) — ⚠️ 4 broken

| Method | Path | No-token status | Verdict | Notes |
|---|---|---|---|---|
| GET | `/api/v1/custom-fields` | 200 | BROKEN 🔴 | SEC: 200 with NO auth — unauthenticated data access (F2) |
| POST | `/api/v1/custom-fields` | 400 | BROKEN 🟠 | 400 before auth — validation runs pre-auth (no auth gate?) |
| POST | `/api/v1/custom-fields/file-upload` | 501 | STUB | not implemented (F6) |
| GET | `/api/v1/custom-fields/get-data` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| POST | `/api/v1/custom-fields/save-data` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| POST | `/api/v1/custom-fields/status` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| DELETE | `/api/v1/custom-fields/{id}` | 500 | BROKEN 🟠 | 500 on unauth request — missing auth gate and/or crash (F2/F5) |
| GET | `/api/v1/custom-fields/{id}` | 404 | AUTH-OK? | 404 for probe id (auth may be bypassed) — verify |
| PATCH | `/api/v1/custom-fields/{id}` | 500 | BROKEN 🟠 | 500 on unauth request — missing auth gate and/or crash (F2/F5) |

### dashboard (5)

| Method | Path | No-token status | Verdict | Notes |
|---|---|---|---|---|
| GET | `/api/v1/dashboard/recent-payments` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| GET | `/api/v1/dashboard/revenue-chart` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| GET | `/api/v1/dashboard/statistics` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| GET | `/api/v1/dashboard/top-professionals` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| GET | `/api/v1/dashboard/upcoming-sessions` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |

### doctor-sessions (8)

| Method | Path | No-token status | Verdict | Notes |
|---|---|---|---|---|
| GET | `/api/v1/doctor-sessions` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| POST | `/api/v1/doctor-sessions` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| POST | `/api/v1/doctor-sessions/bulk/delete` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| GET | `/api/v1/doctor-sessions/export` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| GET | `/api/v1/doctor-sessions/module` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| DELETE | `/api/v1/doctor-sessions/{id}` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| GET | `/api/v1/doctor-sessions/{id}` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| PUT | `/api/v1/doctor-sessions/{id}` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |

### email-templates (6) — ⚠️ 6 broken

| Method | Path | No-token status | Verdict | Notes |
|---|---|---|---|---|
| GET | `/api/v1/email-templates` | 500 | BROKEN 🟠 | 500 on unauth request — missing auth gate and/or crash (F2/F5) |
| POST | `/api/v1/email-templates` | 400 | BROKEN 🟠 | 400 before auth — validation runs pre-auth (no auth gate?) |
| DELETE | `/api/v1/email-templates/{id}` | 500 | BROKEN 🟠 | 500 on unauth request — missing auth gate and/or crash (F2/F5) |
| GET | `/api/v1/email-templates/{id}` | 500 | BROKEN 🟠 | 500 on unauth request — missing auth gate and/or crash (F2/F5) |
| PATCH | `/api/v1/email-templates/{id}` | 500 | BROKEN 🟠 | 500 on unauth request — missing auth gate and/or crash (F2/F5) |
| POST | `/api/v1/email-templates/{id}/preview` | 500 | BROKEN 🟠 | 500 on unauth request — missing auth gate and/or crash (F2/F5) |

### encounters (9)

| Method | Path | No-token status | Verdict | Notes |
|---|---|---|---|---|
| GET | `/api/v1/encounters` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| POST | `/api/v1/encounters` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| POST | `/api/v1/encounters/bulk/delete` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| POST | `/api/v1/encounters/bulk/status` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| GET | `/api/v1/encounters/export` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| DELETE | `/api/v1/encounters/{id}` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| GET | `/api/v1/encounters/{id}` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| PUT | `/api/v1/encounters/{id}` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| GET | `/api/v1/encounters/{id}/print` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |

### followup-chains (4)

| Method | Path | No-token status | Verdict | Notes |
|---|---|---|---|---|
| GET | `/api/v1/followup-chains` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| POST | `/api/v1/followup-chains` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| GET | `/api/v1/followup-chains/{id}` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| PUT | `/api/v1/followup-chains/{id}` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |

### followup-reminders (1)

| Method | Path | No-token status | Verdict | Notes |
|---|---|---|---|---|
| DELETE | `/api/v1/followup-reminders/{id}` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |

### followups (13)

| Method | Path | No-token status | Verdict | Notes |
|---|---|---|---|---|
| GET | `/api/v1/followups` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| POST | `/api/v1/followups` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| POST | `/api/v1/followups/bulk/status` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| GET | `/api/v1/followups/due` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| DELETE | `/api/v1/followups/{id}` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| GET | `/api/v1/followups/{id}` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| PUT | `/api/v1/followups/{id}` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| GET | `/api/v1/followups/{id}/activity` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| POST | `/api/v1/followups/{id}/cancel` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| POST | `/api/v1/followups/{id}/complete` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| GET | `/api/v1/followups/{id}/reminders` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| POST | `/api/v1/followups/{id}/reminders` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| POST | `/api/v1/followups/{id}/send-reminder` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |

### gdpr (11)

| Method | Path | No-token status | Verdict | Notes |
|---|---|---|---|---|
| GET | `/api/v1/gdpr/audit-log` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| GET | `/api/v1/gdpr/consent-versions` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| POST | `/api/v1/gdpr/consent-versions` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| GET | `/api/v1/gdpr/consent-versions/{id}` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| POST | `/api/v1/gdpr/consent-versions/{id}/activate` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| GET | `/api/v1/gdpr/consents` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| POST | `/api/v1/gdpr/consents` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| GET | `/api/v1/gdpr/consents/{id}` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| POST | `/api/v1/gdpr/consents/{id}/withdraw` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| POST | `/api/v1/gdpr/data-delete` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| POST | `/api/v1/gdpr/data-export` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |

### import (3)

| Method | Path | No-token status | Verdict | Notes |
|---|---|---|---|---|
| POST | `/api/v1/import` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| GET | `/api/v1/import/templates` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| POST | `/api/v1/import/validate` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |

### intervention-plans (5)

| Method | Path | No-token status | Verdict | Notes |
|---|---|---|---|---|
| GET | `/api/v1/intervention-plans` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| POST | `/api/v1/intervention-plans` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| GET | `/api/v1/intervention-plans/{id}` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| POST | `/api/v1/intervention-plans/{id}/items` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| PATCH | `/api/v1/intervention-plans/{id}/items/{itemId}/complete` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |

### medical-history (6)

| Method | Path | No-token status | Verdict | Notes |
|---|---|---|---|---|
| GET | `/api/v1/medical-history` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| POST | `/api/v1/medical-history` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| GET | `/api/v1/medical-history/export` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| DELETE | `/api/v1/medical-history/{id}` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| GET | `/api/v1/medical-history/{id}` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| PUT | `/api/v1/medical-history/{id}` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |

### notes-templates (5) — ⚠️ 5 broken

| Method | Path | No-token status | Verdict | Notes |
|---|---|---|---|---|
| GET | `/api/v1/notes-templates` | 500 | BROKEN 🟠 | 500 on unauth request — missing auth gate and/or crash (F2/F5) |
| POST | `/api/v1/notes-templates` | 400 | BROKEN 🟠 | 400 before auth — validation runs pre-auth (no auth gate?) |
| DELETE | `/api/v1/notes-templates/{id}` | 500 | BROKEN 🟠 | 500 on unauth request — missing auth gate and/or crash (F2/F5) |
| GET | `/api/v1/notes-templates/{id}` | 500 | BROKEN 🟠 | 500 on unauth request — missing auth gate and/or crash (F2/F5) |
| PATCH | `/api/v1/notes-templates/{id}` | 500 | BROKEN 🟠 | 500 on unauth request — missing auth gate and/or crash (F2/F5) |

### patient-medical-reports (10)

| Method | Path | No-token status | Verdict | Notes |
|---|---|---|---|---|
| GET | `/api/v1/patient-medical-reports` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| POST | `/api/v1/patient-medical-reports` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| POST | `/api/v1/patient-medical-reports/bulk/delete` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| GET | `/api/v1/patient-medical-reports/export` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| DELETE | `/api/v1/patient-medical-reports/{id}` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| GET | `/api/v1/patient-medical-reports/{id}` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| GET | `/api/v1/patient-medical-reports/{id}/file` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| GET | `/api/v1/patient-medical-reports/{id}/preview` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| GET | `/api/v1/patient-medical-reports/{id}/print` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| POST | `/api/v1/patient-medical-reports/{id}/send-email` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |

### practices (17) — ⚠️ 9 broken

| Method | Path | No-token status | Verdict | Notes |
|---|---|---|---|---|
| GET | `/api/v1/practices` | 500 | BROKEN 🟠 | 500 on unauth request — missing auth gate and/or crash (F2/F5) |
| POST | `/api/v1/practices` | 501 | STUB | not implemented (F6) |
| POST | `/api/v1/practices/bulk/delete` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| POST | `/api/v1/practices/bulk/resend-credentials` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| POST | `/api/v1/practices/bulk/status` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| GET | `/api/v1/practices/export` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| DELETE | `/api/v1/practices/{id}` | 500 | BROKEN 🟠 | 500 on unauth request — missing auth gate and/or crash (F2/F5) |
| GET | `/api/v1/practices/{id}` | 500 | BROKEN 🟠 | 500 on unauth request — missing auth gate and/or crash (F2/F5) |
| PATCH | `/api/v1/practices/{id}` | 500 | BROKEN 🟠 | 500 on unauth request — missing auth gate and/or crash (F2/F5) |
| POST | `/api/v1/practices/{id}/change-admin` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| DELETE | `/api/v1/practices/{id}/holidays` | 500 | BROKEN 🟠 | 500 on unauth request — missing auth gate and/or crash (F2/F5) |
| GET | `/api/v1/practices/{id}/holidays` | 500 | BROKEN 🟠 | 500 on unauth request — missing auth gate and/or crash (F2/F5) |
| POST | `/api/v1/practices/{id}/holidays` | 422 | BROKEN 🟠 | 422 before auth — validation runs pre-auth (no auth gate?) |
| POST | `/api/v1/practices/{id}/resend-credentials` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| GET | `/api/v1/practices/{id}/settings` | 500 | BROKEN 🟠 | 500 on unauth request — missing auth gate and/or crash (F2/F5) |
| PATCH | `/api/v1/practices/{id}/settings` | 500 | BROKEN 🟠 | 500 on unauth request — missing auth gate and/or crash (F2/F5) |
| GET | `/api/v1/practices/{id}/users` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |

### prescriptions (7)

| Method | Path | No-token status | Verdict | Notes |
|---|---|---|---|---|
| GET | `/api/v1/prescriptions` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| POST | `/api/v1/prescriptions` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| POST | `/api/v1/prescriptions/bulk/delete` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| GET | `/api/v1/prescriptions/export` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| DELETE | `/api/v1/prescriptions/{id}` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| GET | `/api/v1/prescriptions/{id}` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| PUT | `/api/v1/prescriptions/{id}` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |

### professionals (23) — ⚠️ 3 broken

| Method | Path | No-token status | Verdict | Notes |
|---|---|---|---|---|
| GET | `/api/v1/professionals` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| POST | `/api/v1/professionals` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| POST | `/api/v1/professionals/bulk/delete` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| POST | `/api/v1/professionals/bulk/resend-credentials` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| POST | `/api/v1/professionals/bulk/status` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| GET | `/api/v1/professionals/export` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| DELETE | `/api/v1/professionals/{id}` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| GET | `/api/v1/professionals/{id}` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| PATCH | `/api/v1/professionals/{id}` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| GET | `/api/v1/professionals/{id}/availability` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| PUT | `/api/v1/professionals/{id}/availability` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| DELETE | `/api/v1/professionals/{id}/off-days` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| GET | `/api/v1/professionals/{id}/off-days` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| POST | `/api/v1/professionals/{id}/off-days` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| POST | `/api/v1/professionals/{id}/resend-credentials` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| DELETE | `/api/v1/professionals/{id}/services` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| GET | `/api/v1/professionals/{id}/services` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| POST | `/api/v1/professionals/{id}/services` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| POST | `/api/v1/professionals/{id}/services/bulk/delete` | 500 | BROKEN 🟠 | 500 on unauth request — missing auth gate and/or crash (F2/F5) |
| POST | `/api/v1/professionals/{id}/services/bulk/status` | 500 | BROKEN 🟠 | 500 on unauth request — missing auth gate and/or crash (F2/F5) |
| GET | `/api/v1/professionals/{id}/services/export` | 500 | BROKEN 🟠 | 500 on unauth request — missing auth gate and/or crash (F2/F5) |
| GET | `/api/v1/professionals/{id}/slots` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| PATCH | `/api/v1/professionals/{id}/status` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |

### public (15) — ⚠️ 6 broken

| Method | Path | No-token status | Verdict | Notes |
|---|---|---|---|---|
| POST | `/api/v1/public/appointments` | 422 | OK | public; validation on empty/again-check body |
| GET | `/api/v1/public/appointments/{token}` | 400 | OK | public; validation on empty/again-check body |
| POST | `/api/v1/public/appointments/{token}/cancel` | 400 | OK | public; validation on empty/again-check body |
| POST | `/api/v1/public/booking` | 308 | NOTE | redirect |
| GET | `/api/v1/public/booking/hold` | 410 | OK | 410 Gone (expired/consumed token) — expected shape |
| POST | `/api/v1/public/booking/hold` | 400 | OK | public; validation on empty/again-check body |
| GET | `/api/v1/public/config` | 200 | OK | public, returns data |
| POST | `/api/v1/public/payment-verify` | 501 | STUB | not implemented (F6) |
| GET | `/api/v1/public/practices` | 500 | BROKEN 🔴 | public endpoint crashes (F3) — booking funnel down |
| GET | `/api/v1/public/practices/{id}` | 500 | BROKEN 🔴 | public endpoint crashes (F3) — booking funnel down |
| GET | `/api/v1/public/professionals` | 500 | BROKEN 🔴 | public endpoint crashes (F3) — booking funnel down |
| GET | `/api/v1/public/professionals/{id}/services` | 500 | BROKEN 🔴 | public endpoint crashes (F3) — booking funnel down |
| GET | `/api/v1/public/professionals/{id}/slots` | 500 | BROKEN 🔴 | public endpoint crashes (F3) — booking funnel down |
| GET | `/api/v1/public/rating/{id}` | 400 | OK | public; validation on empty/again-check body |
| GET | `/api/v1/public/static-data` | 500 | BROKEN 🔴 | public endpoint crashes (F3) — booking funnel down |

### ratings (5)

| Method | Path | No-token status | Verdict | Notes |
|---|---|---|---|---|
| GET | `/api/v1/ratings` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| POST | `/api/v1/ratings` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| GET | `/api/v1/ratings/stats` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| DELETE | `/api/v1/ratings/{id}` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| GET | `/api/v1/ratings/{id}` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |

### receptionists (10)

| Method | Path | No-token status | Verdict | Notes |
|---|---|---|---|---|
| GET | `/api/v1/receptionists` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| POST | `/api/v1/receptionists` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| POST | `/api/v1/receptionists/bulk/delete` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| POST | `/api/v1/receptionists/bulk/resend-credentials` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| POST | `/api/v1/receptionists/bulk/status` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| GET | `/api/v1/receptionists/export` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| DELETE | `/api/v1/receptionists/{id}` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| GET | `/api/v1/receptionists/{id}` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| PUT | `/api/v1/receptionists/{id}` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| POST | `/api/v1/receptionists/{id}/resend-credentials` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |

### session-notes (5)

| Method | Path | No-token status | Verdict | Notes |
|---|---|---|---|---|
| GET | `/api/v1/session-notes` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| POST | `/api/v1/session-notes` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| GET | `/api/v1/session-notes/{id}` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| PATCH | `/api/v1/session-notes/{id}` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| POST | `/api/v1/session-notes/{id}/close` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |

### sessions (22) — ⚠️ 15 broken

| Method | Path | No-token status | Verdict | Notes |
|---|---|---|---|---|
| GET | `/api/v1/sessions` | 500 | BROKEN 🔴 | SEC: header-spoofable auth (x-user-*), no JWT (F1). Currently 500 (service crash masks bypass). |
| POST | `/api/v1/sessions` | 422 | BROKEN 🔴 | SEC: header-spoofable auth (x-user-*), no JWT (F1).  |
| POST | `/api/v1/sessions/bulk/delete` | 403 | BROKEN 🔴 | SEC: header-spoofable auth (x-user-*), no JWT (F1).  |
| GET | `/api/v1/sessions/calendar` | 403 | BROKEN 🔴 | SEC: header-spoofable auth (x-user-*), no JWT (F1).  |
| GET | `/api/v1/sessions/export` | 403 | BROKEN 🔴 | SEC: header-spoofable auth (x-user-*), no JWT (F1).  |
| POST | `/api/v1/sessions/payment-cancel` | 501 | STUB | not implemented (F6) |
| POST | `/api/v1/sessions/payment-success` | 501 | STUB | not implemented (F6) |
| POST | `/api/v1/sessions/payment-verify` | 501 | STUB | not implemented (F6) |
| POST | `/api/v1/sessions/payment-webhook` | 501 | STUB | not implemented (F6) |
| GET | `/api/v1/sessions/pending` | 403 | BROKEN 🔴 | SEC: header-spoofable auth (x-user-*), no JWT (F1).  |
| GET | `/api/v1/sessions/{id}` | 500 | BROKEN 🔴 | SEC: header-spoofable auth (x-user-*), no JWT (F1). Currently 500 (service crash masks bypass). |
| POST | `/api/v1/sessions/{id}/approve` | 500 | BROKEN 🔴 | SEC: header-spoofable auth (x-user-*), no JWT (F1). Currently 500 (service crash masks bypass). |
| POST | `/api/v1/sessions/{id}/cancel` | 500 | BROKEN 🔴 | SEC: header-spoofable auth (x-user-*), no JWT (F1). Currently 500 (service crash masks bypass). |
| POST | `/api/v1/sessions/{id}/check-in` | 500 | BROKEN 🔴 | SEC: header-spoofable auth (x-user-*), no JWT (F1). Currently 500 (service crash masks bypass). |
| POST | `/api/v1/sessions/{id}/check-out` | 500 | BROKEN 🔴 | SEC: header-spoofable auth (x-user-*), no JWT (F1). Currently 500 (service crash masks bypass). |
| GET | `/api/v1/sessions/{id}/custom-fields` | 500 | BROKEN 🟠 | 500 on unauth request — missing auth gate and/or crash (F2/F5) |
| PUT | `/api/v1/sessions/{id}/custom-fields` | 400 | BROKEN 🟠 | 400 before auth — validation runs pre-auth (no auth gate?) |
| GET | `/api/v1/sessions/{id}/notes` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| GET | `/api/v1/sessions/{id}/print-invoice` | 307 | NOTE |  |
| POST | `/api/v1/sessions/{id}/regenerate-video-conference` | 501 | STUB | not implemented (F6) |
| POST | `/api/v1/sessions/{id}/reject` | 422 | BROKEN 🔴 | SEC: header-spoofable auth (x-user-*), no JWT (F1).  |
| GET | `/api/v1/sessions/{id}/summary` | 500 | BROKEN 🔴 | SEC: header-spoofable auth (x-user-*), no JWT (F1). Currently 500 (service crash masks bypass). |

### taxes (9)

| Method | Path | No-token status | Verdict | Notes |
|---|---|---|---|---|
| GET | `/api/v1/taxes` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| POST | `/api/v1/taxes` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| POST | `/api/v1/taxes/bulk/delete` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| PUT | `/api/v1/taxes/bulk/status` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| GET | `/api/v1/taxes/export` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| DELETE | `/api/v1/taxes/{id}` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| GET | `/api/v1/taxes/{id}` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| PUT | `/api/v1/taxes/{id}` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |
| PUT | `/api/v1/taxes/{id}/status` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |

### webhooks (1)

| Method | Path | No-token status | Verdict | Notes |
|---|---|---|---|---|
| POST | `/api/v1/webhooks/wordpress-jobs` | 401 | AUTH-OK | auth enforced; business logic NEEDS-AUTH-DATA |

---

## 3. Confirmed findings — detail & reproduction

### F1 🔴 Spoofable header auth on all `sessions/*` routes
**Files (12):** `src/app/api/v1/sessions/route.ts`, `sessions/[id]/route.ts`, `[id]/approve`, `[id]/cancel`, `[id]/check-in`, `[id]/check-out`, `[id]/reject`, `[id]/summary`, `bulk/delete`, `calendar`, `export`, `pending`.

Each defines a local placeholder instead of verifying the JWT:
```ts
/** Placeholder auth — replace with actual JWT decode (per feature 001). */
function getActor(req: NextRequest) {
  const userId = req.headers.get('x-user-id') ?? '';
  const role = (req.headers.get('x-user-role') ?? 'CLIENT') as UserRole;
  const practiceId = req.headers.get('x-practice-id') ?? null;
  return { userId, role, practiceId };
}
```
Any caller can assert any identity/role. **Repro:**
```bash
curl -H 'x-user-id: 1' -H 'x-user-role: SUPER_ADMIN' \
  https://staging2.praktiqu.com/api/v1/sessions?limit=3
# → 500 today (listSessions crashes on staging schema, see F5), NOT 401.
# The 500 masks the bypass; fixing F5 would expose full unauthenticated admin access.
```
**Fix:** replace every `sessions/*` local `getActor` with `withAuth`/the real `getActor` from `@/lib/auth`, then enforce RBAC in the service.

### F2 🔴 Missing auth gate — unauthenticated data access
`GET /custom-fields` and `GET /consent-signatures` never call `getActor`/`withAuth`. **Repro:**
```bash
curl https://staging2.praktiqu.com/api/v1/custom-fields        # → 200 {"items":[]}
curl https://staging2.praktiqu.com/api/v1/consent-signatures   # → 200
```
Same missing gate on `GET /practices`, `GET /practices/{id}`, `GET /email-templates`, `GET /notes-templates`, `GET /consent-forms` — currently 500 (crash) instead of 200, so they fail closed *by accident*, not by design. Note the gate is applied **inconsistently within a group**: e.g. `custom-fields/get-data|save-data|status` correctly 401, but the collection `GET` does not.
**Fix:** wrap all collection/detail GETs in `withAuth` + RBAC; audit every route in the §2 "no-token 200/400/422/500-without-getActor" set.

### F3 🟠 Public booking endpoints crash (500)
```bash
curl https://staging2.praktiqu.com/api/v1/public/static-data       # → 500
curl https://staging2.praktiqu.com/api/v1/public/professionals     # → 500 {"type":"about:blank",...}
curl https://staging2.praktiqu.com/api/v1/public/config            # → 200 (works)
```
`/public/professionals` runs `prisma.professional.findMany({ where:{ status:"ACTIVE", specialties:{ array_contains } }, include:{ user } })`; `/public/static-data` calls `getPublicStaticData()`. Crash cause is almost certainly staging DB **schema drift** (missing column/table or non-JSON `specialties`). These power the public booking funnel, so this is user-facing. **Confirm root cause with a staging DB inspection** (couldn't reach it: Docker Desktop down locally, staging DB is host-local).

### F4 🟡 `clients` returns 500 where it should return 401
`handleServiceError` in `src/app/api/v1/clients/route.ts` only special-cases `ClientServiceError`; the `AuthError` thrown by `getActor` hits the generic 500 branch.
```bash
curl https://staging2.praktiqu.com/api/v1/clients                      # → 500 (should be 401)
curl -H 'Authorization: Bearer garbage' .../api/v1/clients             # → 500 (should be 401)
```
Auth **is** enforced (data never returned), but the status/shape is wrong and masks the real 401. **Fix:** in `handleServiceError`, map `AuthError` → its `.status` (401).

### F5 🟠 Schema-drift 500s on raw-SQL / `wp_kc_*` groups
Pre-auth crashers observed: `email-templates` (all), `notes-templates` (all), `practices` GET/`{id}`/holidays/settings. Same family flagged in the 2026-07-06 watchlist (`bills`, `taxes`, `doctor-sessions`, `dashboard`, `followups`, etc.) but those sit behind a working 401 gate so they need a token to confirm. Known landmine: Prisma `PatientClinicMapping` → table `patient_clinic_mappings`, but staging only has `wp_kc_patient_clinic_mappings`. **Fix:** reconcile Prisma `@@map`/raw-SQL table names against the live WP schema; add a staging schema-parity check.

### F6 ⚪ 501 stubs (intentional)
`auth/reset-password`, `clients/bulk/resend-credentials`, `clients/{id}/resend-credentials`, `custom-fields/file-upload`, `POST /practices`, `public/payment-verify`, `sessions/payment-cancel|success|verify|webhook`, `sessions/{id}/regenerate-video-conference`. Track as incomplete features, not bugs.

### F7 ⚪ Inconsistent error contract
500 bodies seen: `{"type":"/errors/internal",...}`, `{"type":"about:blank","title":"Internal Server Error"}`, `{"error":"Internal server error"}`, `{"error":"internal_error"}`. 401 bodies: RFC7807 `invalid_token` (`/auth/me`) vs raw `{"error":"..."}` (`withAuth`). problem-`type` base URL: `staging2.praktiqu.com/problems/...` vs `praktiqu.example.com/problems/...`. **Fix:** route all errors through one `problem-details` helper with a single configured base URL.

---

## 4. Prioritized fix plan

| Prio | Finding | Root cause | Blast radius | Action |
|---|---|---|---|---|
| **P0** | F1 | Placeholder header auth left in `sessions/*` | 12 endpoints, full admin bypass once F5 fixed | Swap to `withAuth` + service RBAC; add a test asserting 401 on no-token for every `sessions/*` route |
| **P0** | F2 | GET handlers missing `getActor`/`withAuth` | ≥7 collection/detail GETs, unauth data | Add auth wrapper; grep every route for a `getActor`/`withAuth` call; CI check |
| **P1** | F3 | Public Prisma queries vs drifted staging schema | Entire public booking funnel | Inspect staging DB; fix column/table refs; smoke-test all `/public/*` in deploy |
| **P1** | F5 | Table-name / column drift (`patient_clinic_mappings`, `wp_kc_*`) | billing + practices + templates groups | Reconcile Prisma `@@map`/raw SQL to live schema; schema-parity gate |
| **P2** | F4 | `handleServiceError` ignores `AuthError` | clients group (and any copy of the helper) | Map `AuthError`→401; share one error handler |
| **P3** | F7 | Multiple ad-hoc error responders | All groups (cosmetic) | Centralize on `problem-details`; single base URL |
| **P4** | F6 | Unfinished integrations | 11 endpoints | Track in backlog; return consistent 501 problem+json |

**Batching:** P0×2 are independent per-route edits (do together — same "add auth wrapper" change). P1 (F3+F5) share the schema-drift root cause — fix as one DB-reconciliation workstream. P2+P3 (F4+F7) are one "unify error handling" change.

---

## 5. To finish the audit (authenticated layer)

Blocked on credentials. Provide **one login per role** (SUPER_ADMIN/CLINIC_ADMIN, PROFESSIONAL, RECEPTIONIST, CLIENT) — or the staging `AUTH_SECRET` to mint tokens — then Phase B (auth matrix: wrong-role→403) and Phase C (mutations, gated on confirmation) can run against the ~200 `AUTH-OK`/`NEEDS-AUTH-DATA` rows above. The §2 table already has the exact method+path list to drive that pass.
