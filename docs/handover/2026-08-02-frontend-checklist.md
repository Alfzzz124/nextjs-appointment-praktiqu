# Front-end update checklist

Companion to `2026-07-31-frontend-breaking-changes.md`, which explains *why* each change
happened. This one is just the work, in the order that surfaces bugs earliest.

**Everything below is live on `staging2.praktiqu.com` as of 2026-08-02.** There is no
compatibility shim: the old shapes are gone, not deprecated.

**Tools:**
- Postman collection **"PraktiQU API v1 (KiviCare migration, 2026-08-02)"** — 260
  requests, foldered by tag, base URL already set to staging2.
- `docs/api/openapi.yaml` is the authoritative reference. It is generated from the same
  Zod schemas the routes validate with, so it cannot quietly disagree with the code.
  Regenerate the collection with `npm run postman` after any spec change.

---

## Step 1 — Clear stored ids first (5 minutes, prevents a day of confusion)

Every id the API returns changed from a cuid to an integer. Any id currently sitting in
a session, cache, cookie, hidden form field or saved URL points at a row nothing reads
any more.

Clear them before the first run. A stale cuid now produces a clean `404`, which looks
like a missing record rather than a stale cache — and that is a genuinely confusing hour
to spend.

---

## Step 2 — `user.id` vs `user.wpUserId` ⚠️ highest risk

The login response did **not** change shape, which is exactly why this bites.

```
user.id        → "cmrhxo22l0006usokhbjug1fe"   auth id, still a cuid
user.wpUserId  → 204                            ← what every resource is keyed on
```

**Grep for `user.id` used to build a URL or a filter.** Anywhere the app does
`/clients/{user.id}`, `/professionals/{user.id}`, or sends `clientId: user.id`, it must
become `user.wpUserId`.

This throws no type error. It returns 200 with the wrong data, or 404. Nothing will tell
you — you have to look.

Rule: **authenticate with `user.id`, address resources with `user.wpUserId`.**

---

## Step 3 — Mechanical replacements

| Where | Old | New |
|---|---|---|
| Session status maps, badges, filters | `COMPLETED` | `CHECK_OUT` |
| Same | `REJECTED` | `CANCELLED` |
| Session note create/update body | `soap: {subjective, objective, assessment, plan}` | `content` and/or `entries: [{type, title}]` |
| Plan list query | `?cursor=` | `?page=` |
| Plan list response | `nextCursor` | `total`, `page`, `limit` |
| Slot lookup | `?date=` alone | `?date=&serviceId=` — **serviceId now required** |
| Custom field list query | `?clinicId=` | `?doctorId=` |

A status filter still asking for `COMPLETED` returns an empty list rather than an error,
so it fails silently. Worth grepping for both old values explicitly.

`entries[].type` must be `problem`, `observation` or `note` — KiviCare's own vocabulary.
Anything else is a 422.

---

## Step 4 — New states to handle in the UI

These are not bugs; they are real conditions the old code never had to render.

- **`durationDays: null` on a recommendation, even when a duration was set.** KiviCare
  stores duration as free text ("30 hari", "2 minggu"); only a plain number survives the
  round trip. Render null as "not specified" — **not** as `0`.
- **`sessionId: ""` on a session note.** 191 of the 319 encounters on staging were
  created directly in KiviCare and have no appointment attached. Guard any "go to
  session" link against the empty string.
- **`nextAvailable: null` on a professional.** Means no working hours in the next 14
  days. The field is now an object `{date, startTime}` when present, and it reports the
  next day they *work* — not a free slot. Call the slots endpoint for bookable times.
- **`409 email_conflict` on public booking.** The email belongs to an existing
  non-patient account. Show "email already registered, please sign in", not a generic
  failure.
- **An empty intervention plan reports `status: "ACTIVE"`**, not `COMPLETED`. There is
  nothing in it to have finished.

---

## Step 5 — Verify

Log in, then check three things in order. Each one failing points somewhere different:

1. `GET /api/v1/clients` returns **752** total → the WordPress read path works.
2. `GET /api/v1/session-notes` returns **319** total → encounters are wired up.
3. Open any screen that shows the logged-in user's own record → catches the
   `user.id` / `user.wpUserId` mistake from Step 2, which nothing else will.

---

## Step 6 — Documents on the encounter screen (added 2026-08-24)

`GET /api/v1/encounters/{id}/documents` returns two lists plus a `pagination` block
for the second one:

```json
{
  "status": true,
  "message": "Encounter documents retrieved successfully",
  "data": {
    "sessionDocuments": [ /* EncounterDocument[] */ ],
    "patientDocuments": [ /* EncounterDocument[] */ ],
    "pagination": { "page": 1, "perPage": 20, "total": 7 }
  }
}
```

Render `sessionDocuments` under "Dokumen sesi ini" and `patientDocuments` under
"Arsip pasien". `pagination` describes `patientDocuments` only — the archive can
grow without bound, the session's own set does not. Query with `page` and
`perPage` (default 20, capped at 100 server-side regardless of what you send).

Each item's `source` tells you where it came from: `booking` is a file the client
attached when booking the appointment (from `wp_kc_appointments.appointment_report`);
`report` is a document a clinician uploaded or linked, from the patient's medical
report archive. An `EncounterDocument` looks like:

```json
{
  "id": 12,
  "source": "report",
  "name": "Resume sesi konseling",
  "filename": "Resume sesi konseling",
  "mimeType": null,
  "date": "2026-08-20",
  "contentPath": "/api/v1/patient-medical-reports/12/content",
  "canManage": true,
  "missing": false
}
```

`id` is the patient-medical-report id for `source: "report"`, but the raw
WordPress attachment id for `source: "booking"` — the two id spaces are not
interchangeable, so do not use `id` to build a URL yourself; always follow
`contentPath` instead. `mimeType` is only known for `booking` items (KiviCare
recorded it at upload); it is always `null` for `report` items. `date` is
`YYYY-MM-DD` or `null` when KiviCare stored none — do not render `null` as today's
date.

**Opening a document needs a fetch, not an `<img src>`.** `contentPath` requires
the Bearer header, which a browser will not attach to a plain `src`. Check
`res.ok` before touching the body — a 401/403/404 still comes back with a body,
just not a file — and revoke the object URL once the viewer is done with it: an
object URL pins its blob in memory until you call `revokeObjectURL`, so a viewer
that opens many documents in a session will leak one blob per open if you skip it.

```js
async function openDocument(doc, token) {
  const res = await fetch(doc.contentPath, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    // e.g. 404 — missing/deleted file, or a scope check that isn't yours to read.
    throw new Error(`Could not open document (${res.status})`);
  }

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  return url; // use as <iframe src> or <img src>
}

// Caller — REQUIRED: revoke when the *viewer* closes, or this blob leaks for
// the rest of the page's life. Wire it to whatever "closed" means for your
// viewer (a modal's onClose, an iframe unmounting) — not a try/finally around
// the call below, since the viewer is usually still displaying the URL after
// this line returns.
const url = await openDocument(doc, token);
showInViewer(url, {
  onClose: () => URL.revokeObjectURL(url),
});
```

**Do not offer rename or delete unless `canManage` is true.** It is always `false`
for `booking` documents — that column (`appointment_report`) is written by
KiviCare at booking time and is never written by this API, so a rename/delete
control on one of those items would be a control that cannot work.

**Show `missing: true` items as unavailable, do not hide them.** It only ever
appears on `booking` documents, when the WordPress attachment behind them has
been deleted out from under the appointment. The client attached something and
it is gone; a silently shorter list is worse than a visible gap. `contentPath`
on a missing item will 404 if you fetch it — grey it out instead of trying to
open it.

**Upload:** `POST /api/v1/encounters/{id}/documents`, multipart, fields `file`
(binary, required) and `name` (optional label — falls back to the filename).
Accepted types: jpg, jpeg, png, webp, gif, pdf, up to 10 MB, checked by content
(magic bytes), not by extension — a mismatched extension is rejected even if the
bytes are a supported type. Staff only (`patient_report_manage`); a client
calling this gets `403`. `400` for a malformed request — either the body isn't
`multipart/form-data`, or the form has no `file` field. Response:

```json
{ "status": true, "message": "Document uploaded successfully",
  "data": { "id": 41, "mediaId": 987, "linked": true } }
```

A `linked: false` means the file reached the patient archive (it is a real
`patient-medical-report` row, `data.id`) but the write that ties it to *this*
encounter failed. The `message` will read "...but could not be linked to this
encounter" in that case. Treat it as a partial success: show it in the archive
section, and let the user retry attaching it to the encounter rather than
re-uploading the file.

**Rename:** `PATCH /api/v1/patient-medical-reports/{id}` with body
`{ "name": "..." }`. `400` if `name` is missing or blank. Only valid for
`source: "report"` items (gate the button on `canManage`, not on `source`
directly — they happen to coincide today, but `canManage` is the contract).

**Delete:** `DELETE /api/v1/patient-medical-reports/{id}`, no body. Same
`canManage` gating.

**`GET /api/v1/patient-medical-reports/{id}/file` changed.** It used to return
`fileUrl`, a raw WordPress URL that always answered 403 because
`uploads/kivicare-reports/` is `Deny from all`. It now returns `contentPath`
instead — the same authenticated streaming path described above. If any code
still reads `fileUrl` from this response, it was already broken and can move to
`contentPath` directly, or just call `/documents` and use the `contentPath` it
already gives you.

**`GET /api/v1/patient-medical-reports/{id}/preview` is gone.** It was a `501`
stub that never worked. Use `/content` (or the `contentPath` from `/documents`
or `/file`) instead.

**New byte-streaming routes**, both `application/octet-stream`, both requiring
the same Bearer-token-via-fetch treatment as above:

- `GET /api/v1/patient-medical-reports/{id}/content` — a `report` document's bytes.
- `GET /api/v1/sessions/{id}/attachments/{mediaId}/content` — a `booking` document's
  bytes. `id` is the session/appointment id, `mediaId` is the WP attachment id
  (i.e. the `id` field of a `sessionDocuments` entry with `source: "booking"`).

A 404 from either does not necessarily mean "does not exist" — it can also mean
"the file is gone" or, for the medical-report route, "not yours" (its scope
check answers 404, not 403, so it does not confirm the id exists). The session
route can still answer 403 if the *session itself* is not yours; only the extra
check that the media id actually belongs to that session's booking answers 404
instead of 403, so a stray attachment id doesn't confirm anything either.

---

## Step 7 — `POST /api/v1/patient-medical-reports` no longer creates anything (added 2026-08-25)

The path still exists and still requires `patient_report_manage`, but the handler now
unconditionally returns `501`:

```json
{ "type": "...", "title": "...", "status": 501,
  "detail": "Creating a report requires uploading its file first. Use POST /api/v1/encounters/{id}/documents." }
```

It used to accept a WordPress media id straight in the request body. Nothing tied that
id to `patientId`, so any caller could name another clinic's attachment, mint a report
row over it, and read the bytes back via `GET /api/v1/patient-medical-reports/{id}/content`
— that hole is why the field is gone rather than just re-validated.

**If any screen still POSTs here to create a report, switch it to
`POST /api/v1/encounters/{id}/documents`** (multipart — it uploads the bytes itself and
links the result to the encounter in one request; see Step 6). There is no other
replacement: this route will not start working again with a different body shape.

---

## Step 8 — Bulk `ids` arrays are now capped at 100 (added 2026-08-25)

Every "bulk" endpoint that takes a JSON `{ "ids": [...] }` (or `{ "ids": [...], "status": ... }`)
body now rejects more than 100 ids with a `400`. This is shared validation, not specific
to one screen — it applies to:

- `POST /api/v1/doctor-sessions/bulk/delete`
- `POST /api/v1/encounters/bulk/delete`
- `POST /api/v1/encounters/bulk/status`
- `POST /api/v1/patient-medical-reports/bulk/delete`
- `POST /api/v1/prescriptions/bulk/delete`
- `POST /api/v1/receptionists/bulk/delete`
- `POST /api/v1/receptionists/bulk/status`
- `POST /api/v1/taxes/bulk/delete`
- `PUT /api/v1/taxes/bulk/status`

If a "select all" action can gather more than 100 rows, chunk the request into batches
of 100 ids rather than sending it all in one call — a batch over the cap gets a bare
`400 "Invalid input"`, with nothing in the response naming the limit.

---

## What did NOT change

Auth flow and token lifetimes. Response envelopes (`{data, pagination}` for lists,
RFC-7807 `problem+json` for errors). Pagination parameter names, apart from plans moving
off `cursor`.

Endpoint paths are **not** all unchanged any more — see Step 6 above for what
`encounter-documents` added (`/encounters/{id}/documents`, the two new `/content`
streaming routes) and removed (`/patient-medical-reports/{id}/preview`), and Step 7
below for `POST /api/v1/patient-medical-reports`, which is still there but no longer
does anything.
