# File Upload — Design

**Date:** 2026-07-15
**Status:** Approved (design), pending implementation plan

## Problem

`POST /api/v1/custom-fields/file-upload` is a bare 501 stub with no auth wrapper
(`src/app/api/v1/custom-fields/file-upload/route.ts`). Every consumer in the app already
knows how to read a WordPress media attachment **by id**:

- `src/services/billing/patient-medical-report.service.ts` → `resolveReportFile()` (id → URL via `guid` / `_wp_attached_file`)
- `src/services/billing/mappers.ts` → `attachmentUrl(id)`
- `src/services/billing/validation.ts:189` → `uploadReport: z.string()` — an *existing* WP media id

The only missing link is an endpoint that accepts bytes and returns a media id. This spec
covers that endpoint and the WP-side route it depends on.

Out of scope: the payment feature (code-complete, awaiting `payment_orders` table +
`PAYMENT_WEBHOOK_SECRET`). Do not mix the two.

## Decisions

| Decision | Choice |
| --- | --- |
| Upload surface | Both authed staff **and** guest (public booking widget) |
| Guest authorization | Live `holdKey` from `slotHoldService` |
| Allowed types | jpg, jpeg, png, webp, gif, pdf |
| Max size | 10 MB per file |
| Multiplicity | Multiple files per request |
| Partial failure | Best-effort → `207` with per-file results |
| Subfolder | `kivicare-reports` for medical reports; `kivicare-uploads` for custom-field/booking files |

## Architecture

Next.js never writes the WordPress media library directly. Doing so would bypass WP's own
MIME checks, thumbnail generation, and upload-dir filters. Instead the flow mirrors the
existing payment bridge:

```
FE → POST /api/v1/custom-fields/file-upload  (Next.js, multipart)
   → validate (auth/type/size/MIME sniff)
   → POST /praktiqu/v1/media                 (plugin, X-PraktiQU-Service-Token)
   → wp_handle_upload / media_handle_sideload → kivicare-* subfolder
   → { mediaId, url, name }
   → Next.js aggregates → FE
```

This reuses `Plugin::verify_service_token` and the route-registration pattern already
established in `class-praktiqu-endpoint-rest-controller.php`, and the fetch-with-service-token
pattern in `src/lib/wp-endpoint.ts`.

## Components

### 1. Validation module (pure, no I/O)

A pure `validateUpload(file)` unit, testable in isolation:

- **Type allowlist:** jpg, jpeg, png, webp, gif, pdf.
- **MIME sniffing:** the type is decided by the file's magic bytes, and the sniffed type must
  also agree with the extension. A `.php` or `.svg` renamed to `.png` is rejected. Extension
  alone is never trusted.
- **Size:** ≤ 10 MB per file.
- Returns a typed result. The route maps failures to a clean `422` — never a leaked `500`.

### 2. Next.js route — `POST /api/v1/custom-fields/file-upload`

Replaces the 501 stub. Accepts `multipart/form-data`.

**Request**

- One or more `file` parts.
- Optional `context`: `"medical-report" | "custom-field"` (default `custom-field`). Selects the
  WP subfolder only.
- Guest only: `holdKey`, sent as header `X-Booking-Hold` or a form field.

**Auth** — one of:

- **Authed staff:** the existing `withAuth` wrapper, consistent with sibling routes.
- **Guest:** a live `holdKey`. The route calls `slotHoldService.get(key)`; if the hold is absent
  or expired, respond `401`.

Rationale: in the public booking flow the guest holds a slot (`POST /api/v1/public/booking/hold`
→ `holdKey`, 15-min TTL), *then* fills custom fields including file uploads, and only afterwards
creates the appointment (`POST /api/v1/public/booking` → `signAppointmentToken(created.id)`).
At upload time no appointment id exists yet, so the signed appointment token in
`src/lib/public/appointment-token.ts` cannot be used. The `holdKey` is the only capability the
guest holds at that moment; requiring it ties every guest upload to an in-progress booking and
bounds abuse to the 15-minute hold window without new token infrastructure.

Known constraint: slot holds are in-memory (single instance) and are lost on restart. Acceptable
for the current single-instance staging/production topology; revisit if the app is horizontally
scaled.

**Response**

- All succeed → `201 { files: [{ name, mediaId: number, url: string }, ...] }`
- Mixed → `207 { files: [ { name, mediaId, url } | { name, error } ] }`
- Any file fails validation → `422`, **before anything is written**
- Missing/expired holdKey and not authed → `401`

**Order of operations:** validate *every* file first; only if all pass, sideload each. This
guarantees a validation error never leaves orphaned media behind. A `207` can therefore only
arise from a plugin/WP failure part-way through a batch, not from bad input.

**Partial-failure semantics:** best-effort. Media that succeeded is kept and reported; failures
are reported per file. An abandoned booking already orphans media (upload, then never submit),
so orphans are an accepted property of the system, and discarding good uploads because one
sideload failed would be a worse trade.

### 3. WP-side bridge

**Next.js:** a new `uploadMedia` function in `src/lib/wp-endpoint.ts`, following the existing
`createWcOrder` / `getWcOrderStatus` pattern: forward the file with the
`X-PraktiQU-Service-Token` header, using `WORDPRESS_SERVICE_TOKEN`.

**Plugin:** a new route `POST /praktiqu/v1/media` registered in
`class-praktiqu-endpoint-rest-controller.php` with
`'permission_callback' => [Plugin::class, 'verify_service_token']`.

The handler runs `wp_handle_upload` / `media_handle_sideload` so WordPress performs its own MIME
validation, thumbnail generation, and attachment bookkeeping, then returns
`{ mediaId, url, name }`.

**The plugin route must apply its own `upload_dir` filter** for the duration of the sideload, and
remove it afterwards. It must *not* rely on `KCMediaHandler::modify_upload_dir`: that filter only
fires when `userHasKivicareRole()` is true and a report/encounter context is detected from the
`X-KC-View-Path` header, the referer, or the `kc_upload_report` action. Our route authenticates
with a service token and has no logged-in KiviCare user in the request — for guest booking uploads
there is no WP user at all — so the filter would silently not fire and files would land in the
default year/month folder. The route sets the target directory itself, based on `context`, and
ensures the directory exists.

Plugin version goes **1.2.0 → 1.3.0**, redeployed as an mu-plugin the documented way (`php -l`
in a temp dir on the server, back up the old directory, then swap).

### 4. Subfolder convention

- `context=medical-report` → `uploads/kivicare-reports/` — the flat, non-year/month folder that
  `KCMediaHandler::modify_upload_dir` already routes reports into, protected by a `Deny from all`
  `.htaccess`.
- `context=custom-field` (default) → sibling `uploads/kivicare-uploads/`.

Keeping both under a `kivicare-*` prefix keeps downloads and any future media migration uniform
with the existing `2026_03_26_MoveExistingMediaToKivicareFolder` convention.

## Error handling

| Case | Response |
| --- | --- |
| Not authed, no/expired holdKey | `401` |
| Disallowed type, MIME/extension mismatch, oversized | `422` (nothing written) |
| Plugin/WP failure on some files | `207` with per-file errors |
| Plugin/WP failure on all files | mapped `4xx`/`5xx`, never a leaked `500` |

## Testing (TDD)

Write tests first, following the payment feature's approach.

- **Unit — `validateUpload`:** allowlist accepts each permitted type; rejects `.php`, `.svg`,
  and executables; rejects a `.php` renamed to `.png` (MIME-vs-extension mismatch); rejects
  oversized files at the 10 MB boundary.
- **Route:** missing/expired holdKey and unauthenticated → `401`; authed staff → allowed;
  validation failure → `422` with nothing written; plugin error → clean `4xx`/`5xx` mapping,
  no leaked `500`.
- **Happy path:** returns a numeric media id and a URL that resolves.
- **Batch:** all-success → `201`; mid-batch sideload failure → `207` with per-file breakdown.

The 8 pre-existing billing test failures (missing `wp_kc_*` tables in the local test DB) are
unrelated to this work and should be ignored.

## Deployment risks

- **WAF 415 (highest risk).** The staging WAF blocks certain content-types, which is directly
  relevant to `multipart/form-data`. An upload that works locally can still be rejected at the
  edge. Test a real multipart POST against staging **early** — `curl -4 -F file=@...`, VPN off —
  before wiring the frontend.
- **Shared WP database.** `DATABASE_URL` points at the live WordPress database. Never run
  `prisma db push` or `migrate dev`. This feature needs no new tables — media is written through
  the plugin.
- **Deploy.** Next.js app → `staging2.praktiqu.com` (local build with
  `NEXT_PUBLIC_APP_URL=https://staging2.praktiqu.com`, `tar --exclude=.next/cache`, scp swap
  `.next`, recreate `.next/cache`, restart Passenger). Plugin →
  `appointment.praktiqu.com/wp-content/mu-plugins/praktiqu-endpoint/` (mu-plugin: live the moment
  the files land).
- `WORDPRESS_SERVICE_TOKEN` and `WORDPRESS_URL` are already set in the staging `.htaccess`; the
  media bridge reuses the same service-token auth as the other plugin routes.

## Open follow-ups (not this task)

- `openapi.yaml:8723` lists the endpoint with no request/response schema. Update it to match the
  contract above once implemented.
- Orphaned media from abandoned bookings has no reaper. Acceptable for now; worth a cleanup job
  if volume grows.
