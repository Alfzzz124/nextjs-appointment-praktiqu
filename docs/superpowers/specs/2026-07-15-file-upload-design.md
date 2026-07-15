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
| Upload surface | **Authenticated users only** (`withAuth`) |
| Allowed types | jpg, jpeg, png, webp, gif, pdf |
| Max size | 10 MB per file |
| Multiplicity | Multiple files per request |
| Partial failure | Best-effort → `207` with per-file results |
| Subfolder | `kivicare-reports` for medical reports; `kivicare-uploads` for custom-field files |

### Why authenticated-only

Guest upload was considered and rejected. It buys nothing today and costs real security surface:

- The Next.js public booking flow **has no custom fields at all**. `createPublicAppointmentSchema`
  (`src/services/public/public-booking.service.ts`) accepts only `professionalId`, `serviceId`,
  `date`, `startTime`, `clientName`, `clientEmail`, `clientMobile`, `notes`, `holdKey`. There is
  no file field, so a guest cannot attach a file to a booking even in principle.
- `file-uploads-custom` exists only as a **booking-step config in the legacy KiviCare WP plugin**
  (`WidgetSetting.php`, `KCActivate.php`, the `2026_05_01_MigrateAptBookingSteps` migration). It
  is not referenced anywhere in the Next.js app.
- The real consumer, `POST /api/v1/patient-medical-reports`, is already `withAuth`.

The rejected alternative was authorizing guests with a live `slotHoldService` `holdKey` (the only
capability a guest holds mid-booking, since the signed appointment token in
`src/lib/public/appointment-token.ts` is bound to an appointment id that does not exist until
after booking). That would have meant an unauthenticated endpoint writing into the WordPress
media library, gated only by an in-memory hold that dies on restart and does not survive
horizontal scaling — in exchange for a flow that does not exist.

If public booking ever grows custom fields with file uploads, guest upload becomes a separate
feature with its own design. Do not pre-build it.

## Architecture

Next.js never writes the WordPress media library directly. Doing so would bypass WP's own
MIME checks, thumbnail generation, and upload-dir filters. Instead the flow mirrors the
existing payment bridge:

```
FE → POST /api/v1/custom-fields/file-upload  (Next.js, multipart, authed)
   → validate (type/size/MIME sniff)
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

Replaces the 501 stub. Accepts `multipart/form-data`. Wrapped in `withAuth`, consistent with
sibling routes such as `patient-medical-reports`.

**Request**

- One or more `file` parts.
- Optional `context`: `"medical-report" | "custom-field"` (default `custom-field`). Selects the
  WP subfolder only.

**Response**

- All succeed → `201 { files: [{ name, mediaId: number, url: string }, ...] }`
- Mixed → `207 { files: [ { name, mediaId, url } | { name, error } ] }`
- Any file fails validation → `422`, **before anything is written**
- Unauthenticated → `401` (via `withAuth`)

**Order of operations:** validate *every* file first; only if all pass, sideload each. This
guarantees a validation error never leaves orphaned media behind. A `207` can therefore only
arise from a plugin/WP failure part-way through a batch, not from bad input.

**Partial-failure semantics:** best-effort. Media that succeeded is kept and reported; failures
are reported per file. Discarding good uploads because one sideload failed would be a worse
trade.

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
with a service token and has no logged-in KiviCare user in the request, so the filter would
silently not fire and files would land in the default year/month folder. The route sets the
target directory itself, based on `context`, and ensures the directory exists.

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
| Unauthenticated | `401` |
| Disallowed type, MIME/extension mismatch, oversized | `422` (nothing written) |
| Plugin/WP failure on some files | `207` with per-file errors |
| Plugin/WP failure on all files | mapped `4xx`/`5xx`, never a leaked `500` |

## Testing (TDD)

Write tests first, following the payment feature's approach.

- **Unit — `validateUpload`:** allowlist accepts each permitted type; rejects `.php`, `.svg`,
  and executables; rejects a `.php` renamed to `.png` (MIME-vs-extension mismatch); rejects
  oversized files at the 10 MB boundary.
- **Route:** unauthenticated → `401`; authed → allowed; validation failure → `422` with nothing
  written; plugin error → clean `4xx`/`5xx` mapping, no leaked `500`.
- **Happy path:** returns a numeric media id and a URL that resolves.
- **Batch:** all-success → `201`; mid-batch sideload failure → `207` with per-file breakdown.

The 8 pre-existing billing test failures (missing `wp_kc_*` tables in the local test DB) are
unrelated to this work and should be ignored.

## Deployment risks

- **WAF 415 — probed 2026-07-15, RETIRED.** The handover flagged this as the highest risk. It
  does not fire on `multipart/form-data`. Measured with `curl -4 -F`:

  | Probe | Result |
  | --- | --- |
  | JSON POST → `staging2` stub (baseline) | `501` |
  | Multipart POST → `staging2` stub | `501` (passed through) |
  | Multipart POST → WP host REST | `404 rest_no_route` (reached WP router) |
  | 10 MB multipart → `staging2` | `501`, 10,485,959 bytes uploaded |
  | 10 MB multipart → WP host | `404 rest_no_route`, full 10 MB uploaded |

  Multipart passes at both hops, at 1 byte and at the full 10 MB ceiling. The transport is sound;
  do not design around a content-type 415.

  **The 415 was mischaracterized.** It is not a content-type block. Per the
  `staging-deploy-mechanics` memory, the WAF 415 from `openresty` is a **rate-limit / IP block**:
  hammering endpoints from one IP gets that IP edge-blocked, after which *all* requests return
  415 regardless of content type (including sibling hosts). Multipart was never special.

  The residual risk is therefore real but different: **bulk upload testing from one IP can trip
  the block and 415 everything**, which looks exactly like a multipart rejection and will send
  the next person down a false trail. When testing batches, throttle, test from the server via
  `curl`, or wait for the block to clear. The app is fine when this happens.

- **PHP upload limits on the WP box — OPEN, verify when the route lands.** The probe above proves
  the *edge* accepts 10 MB; it does **not** prove PHP keeps it. When `post_max_size` is exceeded
  PHP discards the body and continues, so WP's router returns an identical `404 rest_no_route`
  whether or not the 10 MB was parsed. Confirm `post_max_size`, `upload_max_filesize`, and
  `max_file_uploads` are ≥ 10 MB / ≥ batch size before trusting the limit — either via
  `php -i` on the server, or by asserting on the first real `POST /praktiqu/v1/media` response
  (the route can report what it actually received). If PHP caps below 10 MB, the app-level 10 MB
  limit is a lie and large uploads fail confusingly, so this must be checked, not assumed.
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
- Orphaned media from abandoned flows has no reaper. Acceptable for now; worth a cleanup job if
  volume grows.
