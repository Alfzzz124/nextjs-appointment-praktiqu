# Handover — Staging Endpoint Testing & Fix Planning

**Created:** 2026-07-06
**For:** the next session
**Goal of next session:** (1) Test **all** `/api/v1` endpoints against the live staging deployment, then (2) produce a **prioritized plan of recommended fixes** for every broken endpoint. This session does **not** need to apply fixes — it needs a reliable test pass + a fix plan.

---

## 1. TL;DR / Where we are

- Staging is **live and healthy**: `https://staging2.praktiqu.com` (Next.js 14 API, behind Cloudflare, HTTP/2).
- API base path: **`https://staging2.praktiqu.com/api/v1`** (the bare `/api/v1` returns 404 — that's expected, there's no index route).
- Spot-checked and confirmed working this session:
  - Public endpoints return real DB data.
  - Auth is enforced (401 on missing token).
  - Validation + errors are RFC 7807 `application/problem+json`.
  - No 500s on the DB-backed paths hit so far.
- **186 route files**, **~104 operations** (GET 43, POST 43, PATCH 10, DELETE 6, PUT 2) across **30 resource groups**.
- The endpoints were ported from the KiviCare WordPress plugin (`Wordpress-Plugin/`), documented in the OpenAPI spec.

---

## 2. Environment facts

| Item | Value |
|---|---|
| Staging root | `https://staging2.praktiqu.com` |
| API base | `https://staging2.praktiqu.com/api/v1` |
| CDN/proxy | Cloudflare (HTTP/2) |
| Error format | RFC 7807 problem+json (`type`, `title`, `status`, `code`, `detail`, `instance`) |
| Auth scheme | Bearer JWT via `Authorization: Bearer <accessToken>` |
| Local repo | `/home/ahmad/projects/nextjs-appointment-praktiqu` (branch `main`) |

### OpenAPI specs (⚠️ two of them — reconcile first)
- `openapi.yaml` (repo root) — **12,613 lines**
- `docs/api/openapi.yaml` — **7,432 lines**

These differ in size. **Before testing, decide which is canonical** (root `openapi.yaml` is newer/larger and referenced by the user as the target spec). Use it to enumerate expected paths, methods, request bodies, and expected status codes. Treat the spec as the source of truth for "what each endpoint *should* do."

---

## 3. How to authenticate (needed for protected endpoints)

Most endpoints require a Bearer token. `POST /api/v1/auth/login` returns:

```json
{
  "user": { ... },
  "accessToken": "<JWT>",
  "accessTokenExpiresAt": "ISO-8601",
  "refreshToken": "<JWT>",
  "refreshTokenExpiresAt": "ISO-8601"
}
```

Then call protected routes with `Authorization: Bearer <accessToken>`.

**⚠️ PREREQUISITE — ask the user for staging test credentials.** We do **not** have staging login credentials in this repo. To test authenticated endpoints you need at least one account per role, ideally:
- a **CLINIC_ADMIN / SUPER_ADMIN** (broad access),
- a **PROFESSIONAL** (doctor),
- a **CLIENT** (patient),
- a **RECEPTIONIST**.

Role matters: the API does role-scoped authorization (`src/services/authorization.ts`, `src/services/client/access-control.ts`), so a full test needs multiple roles to exercise 403 paths.

Login validation rules to avoid false 400s: email must be valid format; password has a minimum length (a 5-char password like `"wrong"` was rejected at validation with 400 `validation_error`, *not* 401). Use a realistic-length password.

---

## 4. Resource groups (30) to cover

```
auth  bills  clients  clinic-schedules  consent-forms  consent-signatures
custom-fields  dashboard  doctor-sessions  email-templates  encounters
followup-chains  followup-reminders  followups  gdpr  import
intervention-plans  medical-history  notes-templates  patient-medical-reports
practices  prescriptions  professionals  public  ratings  receptionists
session-notes  sessions  taxes  webhooks
```

Enumerate exact paths + methods from the OpenAPI spec (preferred) or from the filesystem:
```bash
find src/app/api -name route.ts        # 186 files
# methods per file:
grep -rhoE 'export (async )?function (GET|POST|PUT|PATCH|DELETE)' src/app/api --include=route.ts
```

---

## 5. Already verified this session (don't re-litigate, just re-confirm)

| Endpoint | Method | Result |
|---|---|---|
| `/api/v1/public/config` | GET | 200 — booking config |
| `/api/v1/public/static-data` | GET | 200 — enums |
| `/api/v1/public/professionals` | GET | 200 — real professionals + `nextAvailable` |
| `/api/v1/professionals` | GET | 401 (auth enforced) ✓ |
| `/api/v1/auth/me` | GET | 401 `missing_token` ✓ |
| `/api/v1/auth/login` | POST `{}` | 400 `validation_error` ✓ |
| `/api/v1/auth/login` | POST wrong creds | 401 `invalid_credentials` ✓ (DB auth path works) |

---

## 6. Recommended testing methodology

1. **Reconcile the OpenAPI spec** (§2) → build the authoritative list of `{method, path, auth-required, expected-status, sample-body}`.
2. **Get tokens** for each role (§3).
3. **Test in this order** to minimize risk:
   - **Phase A — read-only (GET) + public**: safe, no writes. Record status + body snippet for every GET.
   - **Phase B — auth matrix**: hit protected endpoints with (no token / wrong role / right role) → expect 401 / 403 / 200.
   - **Phase C — mutations (POST/PATCH/PUT/DELETE)**: ⚠️ these **write to staging's real database**. Use clearly-tagged test data, capture created IDs, and clean up (or DELETE what you POST). For destructive/irreversible ops, **ask the user before running**.
4. **Classify each result**: `OK` (matches spec) / `BROKEN` (5xx, or wrong status/shape vs spec) / `NEEDS-AUTH-DATA` (couldn't test without a fixture/role) / `SKIPPED` (too destructive).
5. **For every BROKEN endpoint**, capture: path, method, request, actual status+body, expected (per spec), and a first-pass root-cause hypothesis.

A minimal probe helper (bash) used this session:
```bash
probe() { # method url [json-body]
  local out; if [ -n "$3" ]; then out=$(curl -sS -m 20 -w "\n<<%{http_code}>>" -X "$1" -H 'Content-Type: application/json' -d "$3" "$2");
  else out=$(curl -sS -m 20 -w "\n<<%{http_code}>>" -X "$1" "$2"); fi
  echo "${out%%<<*}"; echo "status=$(echo "$out" | grep -o '<<[0-9]*>>' | tr -d '<>')"; }
```
Consider driving it from the OpenAPI paths so coverage is complete (all ~104 operations), and write results to a table/JSON for the fix-plan step.

---

## 7. Known-risky areas (from the local test suite — likely staging breakage candidates)

The local vitest suite (`npx vitest run`) currently sits at **534/567 passing, 33 failing**, and **all 33 failures are DB-backed**. Many trace to the **local test DB** being structurally stale (a repo/env issue, see §8) — but the affected *services* are also the ones most likely to have real bugs on staging. Prioritize live-testing these groups:

- **billing/** services: `bills`, `taxes`, `doctor-sessions`, `clinic-schedules`, `dashboard`, `followups`/`followup-chains`, `receptionists`, `import`, `gdpr`, `medical-history`, `prescriptions`, `patient-medical-reports`. These use **raw SQL against `wp_kc_*` tables** (KiviCare tables), so they're sensitive to schema/column mismatches on the real DB.
- **intervention-plans** (create returned a spurious 409/401 locally — check idempotency + auth wiring on staging).
- **professionals create** (enum handling for `PSIKOLOG_KLINIS`, `PSIKOLOG_ANAK`, `PSIKIATER`, `KONSELOR`).
- **practices** holiday delete (`removeHoliday` returned not-found locally).

> Note: local failures ≠ staging failures (different DB). Use them as a **watchlist**, then confirm the real behavior against staging.

### Schema naming landmine to verify on staging
There is a **table-name inconsistency** worth explicitly checking:
- Raw-SQL code (billing, public-booking) uses **`wp_kc_patient_clinic_mappings`** (exists in the live/prod WP DB).
- The Prisma model `PatientClinicMapping` maps to **`patient_clinic_mappings`** (no `wp_kc_` prefix) and is used by `src/services/practice/service.ts:362` (`prisma.patientClinicMapping.findMany`).
- The live WP DB has the `wp_kc_` table but **not** `patient_clinic_mappings`.
- **Hypothesis to verify:** any endpoint hitting `prisma.patientClinicMapping.*` (e.g. parts of `practices`) may throw on staging because the table doesn't exist there. Test the practices endpoints carefully and confirm.

---

## 8. Local environment notes (context, not blockers for staging testing)

- **Two databases** live in the Docker MySQL container `Hombar-Dev_dev_db` (port 3306): `wordpress-praktiqu` (live/prod copy) and `wordpress-praktiqu-test` (isolated test DB). `mysql` CLI is not on the host — reach it via `docker exec Hombar-Dev_dev_db mysql -uroot -proot`.
- The **test DB is partially repaired** (this session created 15 missing `wp_kc_*` tables + `clinics.timezone`). Remaining local failures need further test-DB schema repair, which the user chose to **defer** ("Stop here"). Do **not** run `prisma db push` / `migrate` against the shared container — use scoped SQL only. The safety layer blocks bulk `DROP`/`db push`.
- **Unit suite is fully green (226/226)** after fixes this session (see §9).

---

## 9. Code changes already made this session (so the next session doesn't redo them)

Source fixes:
- `src/services/session/validation.ts` — `listSessionsQuerySchema.limit` now **clamps** to 100 (was `.max(100)` reject).
- `src/services/email-templates/preview.service.ts` — `htmlToText`: block closers now emit `\n\n`; entity decode moved after trim (preserves trailing `&nbsp;`).
- `src/services/booking/slot-generator.ts` — added optional `now?: Date` input for testability.
- `src/services/professional/validation.ts` — `selfUpdateProfessionalInputSchema` is now `.strict()` (rejects read-only fields like `registrationNumber` on self-edit).

Test fixes:
- `tests/unit/booking/slot-generator.test.ts` — pins `now` (was time-brittle: hardcoded past date).
- `tests/unit/professional/professional.service.test.ts` — `vi.hoisted` for the prisma mock; valid cuid `userId`.
- `tests/unit/intervention-plan/service.test.ts` — StubPrisma `plan.create` defaults `status: 'ACTIVE'`.

These are uncommitted working-tree changes on `main`.

---

## 10. Cautions for the next session

- **Staging writes are real.** POST/PATCH/DELETE mutate the staging DB. Prefer GET-first; gate destructive tests behind user confirmation; clean up created rows.
- **Never touch the live DB** (`wordpress-praktiqu` / the `.env.local` `DATABASE_URL`). Testing is via HTTP against staging only.
- **Minor bug already spotted:** problem-type base URL is inconsistent — `/auth/login` uses `staging2.praktiqu.com/problems/...` while `/auth/me` uses `praktiqu.example.com/problems/...`. Add to the fix plan (low priority, cosmetic but should be normalized).

---

## 11. Deliverables the next session should produce

1. A **coverage table**: every operation (~104) with `method | path | auth | actual status | expected | verdict`.
2. A **broken-endpoints list** with reproduction (curl), actual vs expected, and a root-cause hypothesis each.
3. A **prioritized fix plan** (severity × blast radius), grouped by root cause where issues share one (e.g. the `patient_clinic_mappings` naming, or a shared raw-SQL column drift), so fixes can be batched.
