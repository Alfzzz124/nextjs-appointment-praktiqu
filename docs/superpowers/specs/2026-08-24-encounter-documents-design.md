# Encounter documents — design

**Date:** 2026-08-24
**Status:** Approved (design), pending implementation plan
**Depends on:** the encounter migration (`docs/architecture/encounter-migration-plan.md`, E0–E5 done)

## Problem

A clinician opening an encounter cannot see, open, or attach a single document. The
session-note DTO carries `description` plus typed `medical_history` entries and nothing
else — no attachments field exists anywhere in the API.

The gap was raised as user feedback:

> Catatan dan file laporan / isian untuk klien perlu bisa di klik / diakses di akun
> psikolog (entah donlot ulang atau bentuk pop up box langsung ke isinya)

Most of the plumbing already exists. `POST /api/v1/custom-fields/file-upload` is
implemented (authenticated, magic-byte validated, sideloaded through the plugin), and
`/api/v1/patient-medical-reports` has list/get/create/delete/bulk/export. What is missing
is the wiring: nothing joins documents to an encounter, and nothing can serve the bytes.

## What KiviCare actually does

Two findings reshaped this design, both contrary to the obvious reading.

**1. KiviCare's own "Uploaded Reports" panel on the encounter screen is not
encounter-scoped.** It reads `wp_kc_patient_medical_report` filtered by `patient_id`
alone (`KCProPatientMedicalReportController.php:638`). No table in KiviCare carries an
`encounter_id` for reports. The panel shows every document the patient has, on whichever
encounter you open — it merely looks session-scoped when the patient has one document.

**2. There are two stores, and they differ by *when*, not by *who*.**

| Store | Scope | Written by |
|---|---|---|
| `wp_kc_patient_medical_report` | patient | anyone — `patient_report_add` is granted to patient, doctor, receptionist, clinic_admin and admin (`KCPermissions.php:37,79,250,337`) |
| `wp_kc_appointments.appointment_report` | one appointment | exactly one line in the whole plugin: `AppointmentsController.php:3155`, at appointment **create**, from `appointmentFileId` |

So `appointment_report` is a booking-time attachment — written once, never updated, never
touched by the encounter screen. `patient_medical_report` is a running archive either side
can add to. "Patient report" means *about* the patient, not *from* the patient.

Our API is stricter than KiviCare's: `patient_report_manage` excludes CLIENT
(`kc-permissions.ts:56`), the `medical-report` upload context is staff-only, and public
booking has no file field at all. Today **no client can upload anything**. That stays true
— see D2.

**3. The attachment URL is unopenable.** KiviCare's migration
`2026_03_26_MoveExistingMediaToKivicareFolder.php` writes `.htaccess` = `Deny from all`
into `uploads/kivicare-reports/`, where our `medical-report` context uploads. So
`resolveReportFile()` returns a `guid` the browser gets 403 on:
`GET /api/v1/patient-medical-reports/{id}/file` currently hands the front-end a dead link.
KiviCare works around its own wall with `viewReport` → an AES+HMAC key → `fetch?key=`,
an endpoint that validates the HMAC and performs **no permission check whatsoever**. We do
not copy that.

Note the inverse hazard: `uploads/kivicare-uploads/` (the `custom-field` context) has no
protection at all. Clinical documents must never be routed there.

## Decisions

| # | Decision |
| --- | --- |
| D1 | Both sources are shown, labelled — booking attachments for the session, plus the patient archive |
| D2 | Staff upload only; CLIENT reads its own documents and nothing else |
| D3 | Bytes stream through an authenticated endpoint; no signed URLs, no long-lived keys |
| D4 | The encounter link lives in `wp_kc_custom_fields_data`, one row per (encounter, document) |
| D5 | A dedicated documents endpoint; the session-note and encounter DTOs do not change |
| D6 | Operations: upload, rename, delete |
| D7 | Existing row scopes are inherited unchanged, and the asymmetry is recorded, not silently fixed |

### D2 — why staff-only

The feedback is about the clinician's account. Letting clients upload adds permissions,
quota and rate limits, and a moderation question nobody has answered: a client-supplied
file lands in the clinical archive without the psychologist agreeing to it. Turning on the
booking-step upload is worse — that is unauthenticated upload into the WordPress media
library, which `2026-07-15-file-upload-design.md` already rejected on reasoning that still
holds. Clients keep read access to their own documents, which costs nothing:
`patient_report_read` already includes CLIENT.

### D3 — why streaming, not signed URLs

`<img src>` and `<iframe src>` cannot carry a Bearer header, so a signed URL is the
tempting shortcut. Rejected: for the few minutes it lives, that URL is a bearer token for
a clinical document, and URLs get pasted into chats and written to access logs. The
front-end fetches with its existing Bearer token and wraps the response in a blob URL —
a handful of lines, once.

### D4 — why one row per pair

The D1 rule from the encounter migration applies unchanged: a namespaced `module_type` of
our own, and `field_id = NULL`. Every KiviCare read and the delete in
`KCPatientControllerFilters.php:170` are scoped by `module_type`, and
`KCCustomField::getData()` — the one query not so scoped — matches on `field_id` alone,
which a NULL never matches.

- `module_type = 'praktiqu_report_encounter'`
- `module_id = <encounter_id>`
- `fields_data = <report_id>` (JSON)
- `field_id = NULL`

One row per pair, deliberately **not** one row holding an array. An array means
read-modify-write on a longtext blob in a MyISAM table with no transactions, so two
concurrent uploads can silently drop one another. One row per pair makes attach a pure
INSERT and detach a pure DELETE, and nothing can be lost.

The same reasoning rejects appending to `appointment_report`: same lost-update hazard,
plus it would mix the clinician's work into a column KiviCare labels "Appointment Extra
Data" from the booking flow.

### D5 — why a separate endpoint

The session-note DTO changed shape substantially in E3 and the front-end has only just
absorbed it. Adding `documents[]` would change it again and make every note read pull
attachments it usually does not need. A separate endpoint costs the front-end one call
when the panel opens.

### D7 — the scope asymmetry, stated plainly

The helpers disagree, and this feature inherits the disagreement rather than papering over
it:

| Endpoint | Helper | PROFESSIONAL sees |
|---|---|---|
| `/encounters/{id}/documents` | `encounterScopeFor` | own encounters (`doctorId`) |
| `/patient-medical-reports/{id}/*` | `medReportScopeFor` | every patient in the clinic (`clinicId`) |
| `/sessions/{id}/attachments/…` | `assertCanRead` (`session.service.ts:175`) | own sessions |

So psychologist A cannot open psychologist B's encounter, yet can reach that patient's
documents through the reports endpoints. This predates the feature — list, get and delete
already behave this way and are live on staging. What changes is the consequence: once an
endpoint streams the file **contents**, clinic-wide visibility stops being "can see a
filename" and becomes "can read a clinical document".

Decision: inherit the existing scopes. Tightening them mid-feature would silently change
endpoints the front-end already calls. Tightening them is a legitimate follow-up, but it
must be its own deliberate change, announced to the front-end team.

## Architecture

```
FE  →  Next.js /api/v1/…                     withAuth + row scope
    →  plugin GET /praktiqu/v1/media/{id}    X-PraktiQU-Service-Token
    →  get_attached_file() → byte stream
    →  Next pipes the body to the response
```

Next.js has no filesystem access to `wp-content/uploads` and never gains any — every
existing WordPress interaction goes over HTTP with a service token (`src/lib/wp-endpoint.ts`).
The only new plugin surface is one read route. No new table, no new column.

## Components

### 1. Plugin — `GET /praktiqu/v1/media/{id}`

Mirrors `class-praktiqu-endpoint-media.php` and the route-registration pattern in
`class-praktiqu-endpoint-rest-controller.php`. Service-token authenticated. Returns the
bytes with the attachment's real `Content-Type` and filename, or 404 when
`get_attached_file()` finds nothing on disk.

Authorisation is **not** the plugin's job here — it happens in Next.js, which is the only
layer that knows who the caller is. The service token is the trust boundary, exactly as it
is for upload.

### 2. Repository — `src/repositories/wp/encounter-documents.repo.ts`

Narrow, encounter-shaped reads and writes, in the style of `clinical-records.repo.ts`:

- `listEncounterDocuments(encounterId)` — linked reports for one encounter
- `listPatientDocuments(patientId, excludeIds)` — the rest of the archive
- `listAppointmentAttachments(appointmentId)` — parse `appointment_report`, resolve each id
  to `{ mediaId, filename, mimeType, missing }`
- `linkReportToEncounter(encounterId, reportId)` / `unlinkReport(reportId)` — the link is
  keyed on `module_id = encounterId` with the report id in `fields_data`, so unlinking by
  report id scans the rows carrying our `module_type`. That set is small by construction
  and invisible to KiviCare, which is the point of D4.
- `attachmentBelongsToAppointment(appointmentId, mediaId)` — the guard for D3

Batching helpers where a list would otherwise run one query per row.

### 3. Service — `src/services/encounter-documents/service.ts`

Assembles the two sections, applies scope, and owns the write ordering. Returns DTOs; no
SQL, no HTTP.

### 4. Routes

**Read**

- `GET /api/v1/encounters/{id}/documents`

  ```json
  {
    "sessionDocuments": [
      { "id": 12, "source": "report",  "name": "Resume sesi konseling",
        "filename": "resume.pdf", "mimeType": "application/pdf",
        "date": "2026-08-24", "contentPath": "/api/v1/patient-medical-reports/12/content",
        "canManage": true, "missing": false }
    ],
    "patientDocuments": [ … ]
  }
  ```

  `sessionDocuments` = this appointment's booking attachments (`source: "booking"`) plus
  documents linked to this encounter (`source: "report"`). `patientDocuments` = the rest of
  the patient's archive, page-paginated like the encounter listings in E4 (an archive grows
  without bound; the session section does not and is returned whole).

  `canManage` is true only when the actor holds `patient_report_manage` **and**
  `source === "report"`. Booking attachments are never manageable: we never write
  `appointment_report`, so offering rename or delete on one would be a button that cannot
  work.

**Content** — two endpoints, each with an owning row to authorise against:

- `GET /api/v1/patient-medical-reports/{id}/content`
- `GET /api/v1/sessions/{id}/attachments/{mediaId}/content`

There is deliberately no generic `/{mediaId}/content`. A media id has no owner, so
authorising one means guessing, and guessing here leaks another patient's clinical
documents.

**Write**

- `POST /api/v1/encounters/{id}/documents` — one-step multipart (`file`, `name`), reusing
  `validateUpload` and `uploadMedia`
- `PATCH /api/v1/patient-medical-reports/{id}` — rename; touches `name` only. New.
- `DELETE /api/v1/patient-medical-reports/{id}` — exists; extended to drop the link row

**Repaired along the way**

- `GET /patient-medical-reports/{id}/file` stops returning the raw `guid` — a link
  guaranteed to 403 — and returns metadata plus `contentPath`
- `GET /patient-medical-reports/{id}/preview` (a 501 stub) is deleted; `/content` answers
  the pop-up requirement

### 5. Response headers on `/content`

- `Content-Type` from the **stored** mime, verified by magic-byte sniff at upload time,
  never from client input
- `X-Content-Type-Options: nosniff`
- `Content-Disposition: inline; filename*=UTF-8''…` with the filename escaped
- `Cache-Control: private, no-store`

## Error handling

Every case below follows from MyISAM's lack of transactions, or from KiviCare writing the
same tables we do.

| Case | Behaviour |
|---|---|
| Attachment id points at deleted media | listed with `missing: true`; never a 500 |
| Link row points at a deleted report | tolerated by the read and skipped. Deleting through our API unlinks first, so an orphan can only come from KiviCare deleting a report directly. No cleanup sweep on the read path: that would be a write, and a write to a MyISAM table takes a table-level lock a listing has no business holding |
| Upload write ordering | media → report row → link row. A failed link leaves the document in the patient archive: a coherent partial state, not an orphan file |
| Duplicate link rows | prevented in code — `(module_type, module_id, field_id)` has no unique index (`custom-fields.repo.ts:321`) |
| Encounter with `appointment_id = NULL` | `sessionDocuments` omits the booking section; not an error |
| `upload_report` not numeric (the column is varchar) | that document is skipped, the query still succeeds |
| Plugin answers non-200 | 502 with a generic message; upstream detail never reaches the client, as on the upload path |
| `mediaId` not in that session's `appointment_report` | 404, not 403 — a 403 confirms the id exists |

## Testing

- **Repository contract tests** against the real `wp_` tables, following
  `tests/repositories/wp-clinical-records.repo.test.ts`: list per encounter, attach/detach,
  and the missing-attachment, orphan-link and duplicate-link cases above.
- **Route integration tests** covering the full authorisation matrix: PROFESSIONAL (own
  encounter vs another doctor's), CLINIC_ADMIN, RECEPTIONIST, CLIENT (own vs another
  patient's) — and the one that matters most, **a media id belonging to a different
  appointment must 404, not 200**.
- **Stream tests**: bytes out equal bytes in; headers as specified; a filename with quotes
  or non-ASCII does not corrupt `Content-Disposition`.
- `validateUpload` already has its own tests and is not re-covered.
- **Plugin**: `php -l` on every file before it reaches `mu-plugins` — a fatal in an
  mu-plugin takes down the whole WordPress site, including the live booking form.

## Not in scope

- Client-side upload, and the booking-step file field (D2)
- Tightening the `medReportScopeFor` clinic-wide scope (D7) — its own change
- Protecting `uploads/kivicare-uploads/`, used by the unrelated `custom-field` context
- Writing to `appointment_report`; we only ever read it
- Thumbnails, OCR, virus scanning, versioning

## Open questions

Left for the API owner to decide, not resolved here:

- **Should `POST /api/v1/patient-medical-reports` be retired outright, rather than left
  answering `501`?** It still occupies the path and the `patient_report_manage`
  capability check; whether that is worth keeping as a permanent tombstone versus
  removing the route entirely is a call this change does not make.
- **The `medical-report` context of `POST /api/v1/custom-fields/file-upload` now has no
  consumer.** Staff can still upload a file into the protected `medical-report` folder
  through it, but nothing in this API can attach the result to a patient or an
  encounter — `createMedReport` only accepts a `verifiedMediaId` produced by
  `POST /api/v1/encounters/{id}/documents`'s own upload step, not one obtained
  separately. Whether that context should be removed, repointed, or left as-is is open.

The `withAuth` fix on this branch (see the deploy runbook) activated row-scope checks on
39 previously-broken `[id]` routes; bills, taxes, and practices were then given scope.
A pre-merge re-review found three further tenancy gaps in that same family which were
deliberately left unfixed rather than folded into this branch. Recorded here for the
API owner to decide, not resolved:

- **`GET /api/v1/practices` (the list route) has no clinic filter for CLINIC_ADMIN.**
  `listPractices({ page, limit, includeInactive })` takes no actor, so a clinic admin's
  call to the list endpoint returns every clinic in the install, not just their own.
  Mitigating context: this is clinic directory metadata — name, email, address — not
  patient data; it was equally reachable before this branch; and fixing a list route
  means changing the repository signature and its pagination contract, a different size
  of job than the row-scope fixes already done on `/practices/{id}` and its siblings.
  Whether it is worth that change, and when, is open.
- **`POST /api/v1/taxes` is entirely unscoped, and defaults to a global tax — and `PUT
  /api/v1/taxes/{id}` reaches the same outcome without ever calling `POST`.** The
  `POST` route calls `createTax(...)` with no scope argument. `taxCreateSchema`'s
  `clinic` field defaults to `-1`, and `createTax` writes that value verbatim. A
  CLINIC_ADMIN can create a tax row naming another clinic's id, or — by simply
  omitting `clinic` — create a `clinic_id = -1` **global** tax that `listTaxes` and
  `calculateTax` then apply to every clinic in the install. This is a cross-tenant
  write into another tenant's billing configuration, and it predates this branch — as
  a collection route, it was never touched by the `withAuth` bug this branch fixed.
  `PUT /api/v1/taxes/{id}` (`updateTax`) has the identical write surface on an
  *existing* row: `taxUpdateSchema` is `taxCreateSchema.partial()`, so `clinic` is
  accepted on update, and `updateTax` only scope-checks the row it is about to
  overwrite (`assertTaxInScope(existing.clinicId, scope)`) before writing
  `clinicId: BigInt(input.clinic)` from the body with no re-check that the *target*
  clinic is in scope. A CLINIC_ADMIN who owns an in-scope tax can therefore
  `PUT { clinic: <other clinic id> }` to move it into another clinic's billing
  configuration, or `PUT { clinic: -1 }` to promote their own tax to a **global** one
  every clinic bills against — the same cross-tenant/global-write outcome as the
  unscoped `POST` above, reachable even if `POST` were fixed in isolation.
- **Global tax rows are writable and deletable by any clinic admin.** `assertTaxInScope`
  returns early when `clinicId` is `null` or `-1`, and the bulk helpers
  (`bulkSetTaxStatus`, `bulkDeleteTaxes`) include those values in their `OR`. That is
  correct for *reads* — a global tax should be visible everywhere, matching `listTaxes`'
  own semantics — but it means clinic A's admin can `PUT`, `DELETE`, or flip the status
  of a global tax that every other clinic bills against, individually or in bulk. Read
  semantics were reused for writes without the distinction being made.

The second and third items are one coherent question, not two independent bugs: who may
create and mutate a global tax at all. Answering it is a product decision about tax
tenancy — should a global tax exist as a mutable row any CLINIC_ADMIN can reach, or
should creating/editing one require SUPER_ADMIN, or something else — not merely a scope
fix to slot into the existing `assertTaxInScope`/`taxScopeFor` pattern.
