# Handover — Public Endpoints: Commit, Deploy & Postman Test

**Created:** 2026-07-13
**For:** the next session
**Goal of next session:** (1) commit the public-endpoint fixes, (2) deploy the build to staging2, (3) verify the whole `/public/*` funnel live with `curl -4`, (4) generate a Postman collection from the OpenAPI spec and run it via the Postman MCP.

---

## 1. TL;DR / Where we are

- **All 14 `/api/v1/public/*` endpoints are fixed and verified locally, but the changes are UNCOMMITTED and NOT deployed.** Staging still runs the old (broken-create) code.
- Branch: `fix/auth-hardening-and-wp-plugin` (HEAD `55ea50e`). Working tree has 13 modified files + 1 new test file (see §3).
- Staging is **up and healthy** — earlier "blocked/000" scares were client-side (VPN + broken IPv6). Rule: **VPN off, always `curl -4`**.
- **Postman MCP is installed and verified working** (API key, `local` scope). The Postman workspace is empty — a collection must be generated from `docs/api/openapi.yaml` before tests can run.

## 2. What was fixed this session (public funnel, F3 residual + worse)

Audit F3 was mostly resolved earlier by the DB switch to `wp314`, but functional testing found deeper code bugs the audit never hit (it only sent empty bodies):

1. **`POST /public/appointments` could never succeed**: create path was raw KiviCare-era SQL doing `parseInt(professionalId)` on cuid ids → `NaN` interpolated into `wp_kc_*` SQL → 500 on every real booking.
2. **Slots never excluded booked appointments**: route filtered `appointment.doctorId` by `Professional.id`, but appointments key on `Doctor.id` (bridge is `Professional.userId → Doctor.userId`, the feature-002 pattern).
3. **Slot duration used legacy `duration` (30) instead of `durationMinutes` (60)** advertised by `/services`.
4. **Silent 500s**: several routes swallowed errors with no logging.

**Fixes applied:**
- [src/services/public/public-booking.service.ts](../../src/services/public/public-booking.service.ts) rewritten onto app tables (Prisma): create → `Appointment` via the Doctor bridge; client get-or-create as `User`+`Patient`; conflict-check + insert in one transaction; lookup/cancel/rating moved off raw `wp_kc_*` SQL; token now carries a cuid.
- [slots route](../../src/app/api/v1/public/professionals/[id]/slots/route.ts): Doctor bridge (bookings now actually block slots), `durationMinutes`, 404 for unknown/inactive professional.
- All public routes: problem-details error handling + logging.
- Audit doc got a "CODE-FIX 2026-07-13" addendum.

## 3. Uncommitted changes (commit these first)

```
M docs/audit/12 July 2026 Audit Endpoint.md        (addendum)
M src/app/api/v1/public/appointments/[token]/cancel/route.ts
M src/app/api/v1/public/appointments/[token]/route.ts
M src/app/api/v1/public/appointments/route.ts
M src/app/api/v1/public/practices/[id]/route.ts
M src/app/api/v1/public/practices/route.ts
M src/app/api/v1/public/professionals/[id]/services/route.ts
M src/app/api/v1/public/professionals/[id]/slots/route.ts
M src/app/api/v1/public/professionals/route.ts
M src/app/api/v1/public/rating/[id]/route.ts
M src/app/api/v1/public/static-data/route.ts
M src/services/public/public-booking.service.ts    (biggest: ~474 lines changed)
M tests/public-booking/cancel.test.ts
?? tests/public-booking/create.test.ts              (new — includes NaN regression test)
```

`.claude/worktrees/` is session tooling — do not commit.

## 4. Verification already done (local)

- `tsc` clean; production build succeeds.
- `tests/public-booking/` **26/26 pass** (incl. new NaN regression test).
- E2E flow on local dev server: hold → create **201** → slot disappears → lookup **200** → rating prompt **200** → cancel **200** → re-cancel **409** → slot returns; double-booking → **409**.
- 8 failing billing tests are **pre-existing** (local test DB lacks legacy `wp_kc_*` tables outside the Prisma schema) — not this work.

## 5. Environment gotchas (short version — details in auto-memory)

- **Local curl to staging:** VPN off + `curl -4`, otherwise `000`/resolve timeouts that look like server-down. Browser works either way (IPv4 fallback). A `403 openresty` earlier was transient WAF; also beware the known hammering→415 edge block.
- **Local MySQL:** project compose container `praktiqu-mysql` now hosts **fresh** `wordpress-praktiqu` + `wordpress-praktiqu-test` DBs. The old `Hombar-Dev_dev_db` container has the original data but fails to start and **conflicts on port 3306** if both run.
- **Deploy:** per memory `staging-deploy-mechanics` — build locally (`NEXT_PUBLIC_APP_URL=https://staging2.praktiqu.com`), tar `.next` (exclude cache), base64 over `plink`, swap on server, `mkdir .next/cache`, Passenger restart. Env lives in `.htaccess` `SetEnv`.

## 6. Postman MCP — ready to use

- Server `postman` (stdio, `npx -y @postman/postman-mcp-server`) registered at **`local` scope** with `POSTMAN_API_KEY` env — key deliberately kept out of committed `.mcp.json`. Verified via `getAuthenticatedUser`: account *Ahmad Luthfi (Alfzzz)*, team 17882718, free plan.
- The **plugin** server `plugin:postman:postman` separately asks for OAuth — **not needed**; the plugin skills (`/postman:test` etc.) work against the stdio server's `mcp__postman__*` tools.
- If the server ever fails to connect with `MODULE_NOT_FOUND: ajv`: the npx cache got corrupted → `rm -rf ~/.npm/_npx/<hash>` and rerun `npx` uninterrupted (first download is big).
- Workspace is **empty**. To run `/postman:test`, first create a collection — either `mcp__postman__createSpec`/`generateCollection` from [docs/api/openapi.yaml](../../docs/api/openapi.yaml) (259 endpoints — consider starting with just the `/public/*` subset) or `/postman:sync`.
- Optional hygiene: the API key was pasted in chat once; rotate it at postman.com → Settings → API keys when convenient.

## 7. Recommended order for next session

1. **Commit** the §3 changes on `fix/auth-hardening-and-wp-plugin` (suggested: `fix(public): rewrite public booking onto app tables; fix NaN-SQL create, slot conflicts, durations; add error handling`).
2. **Build + deploy** to staging2 (§5 deploy mechanics).
3. **Live sweep** of all 14 `/public/*` endpoints with `curl -4` — reuse the E2E sequence from §4 against `https://staging2.praktiqu.com/api/v1`. New logging will surface any residual `wp314` schema drift immediately (slots was the suspect).
4. **Postman**: generate a `/public/*` collection from the OpenAPI spec, add an environment with `baseUrl=https://staging2.praktiqu.com/api/v1`, run it via `runCollection` (`OWNER_ID-UUID` uid format), fix/iterate.
5. If all green, consider PR toward `main` (branch also carries the earlier auth-hardening commit `55ea50e`).

## 8. Open items / parking lot

- `/public/professionals/{id}/slots` on staging vs `wp314` drift — unconfirmed until step 3.
- Authenticated `professionals/{id}/services` CRUD still never tested with a valid JWT (audit "NEEDS-AUTH-DATA") — natural follow-up once a login token flow exists in Postman.
- Old `Hombar-Dev_dev_db` container: decide whether to migrate its data or retire it (port 3306 conflict).
- 8 pre-existing billing test failures (missing legacy `wp_kc_*` tables in test DB) — separate workstream.
