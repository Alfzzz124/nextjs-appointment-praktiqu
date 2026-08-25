# Encounter documents — front-end handover

**For:** the Laravel front-end team
**Date:** 2026-08-25
**API base:** `https://staging2.praktiqu.com/api/v1`
**Spec:** `docs/api/openapi.yaml` — generated from the same schemas the routes validate with

A clinician opening an encounter can now see, open, upload, rename and delete the
documents attached to it. This document is the work, in the order that surfaces
problems earliest.

---

## 1. The one thing that will cost you a day if you skip it

**`contentPath` cannot be used as an `<img>` or `<iframe>` src.**

It needs the `Authorization: Bearer` header, and a browser will not attach one to a
plain `src`. Fetch it, then wrap the response in a blob URL:

```js
async function openDocument(doc, token) {
  const res = await fetch(doc.contentPath, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    // 404 = not yours, or the file is gone. 502 = the document store is unreachable.
    throw new Error(`Could not open document (${res.status})`);
  }
  const url = URL.createObjectURL(await res.blob());
  return {
    url,
    release: () => URL.revokeObjectURL(url),   // call this when the popup closes
  };
}
```

Call `release()` when the viewer closes. Every blob URL you do not revoke holds its
file in memory for the life of the tab.

---

## 2. Listing the documents

```
GET /api/v1/encounters/{encounterId}/documents?page=1&perPage=20
```

Returns the KiviCare envelope (`{ status, message, data }`). `data` is:

```json
{
  "sessionDocuments": [ … ],
  "patientDocuments": [ … ],
  "pagination": { "page": 1, "perPage": 20, "total": 42 }
}
```

**Two sections, and the split is the point.**

| Section | What is in it |
|---|---|
| `sessionDocuments` | Files the client attached when booking **this** appointment, plus documents a clinician linked to this encounter. Returned whole — not paginated. |
| `patientDocuments` | The rest of the patient's archive. **This is what `pagination` describes** — the counts do not include the session section. |

Each document:

```json
{
  "id": 12,
  "source": "report",
  "name": "Resume sesi konseling",
  "filename": "resume.pdf",
  "mimeType": "application/pdf",
  "date": "2026-08-24",
  "contentPath": "/api/v1/patient-medical-reports/12/content",
  "canManage": true,
  "missing": false
}
```

- **`source`** is `"booking"` or `"report"`. Show the difference — "dikirim klien saat
  booking" reads very differently from "diunggah psikolog".
- **`id`** is a report id when `source` is `"report"`, and a WordPress attachment id
  when it is `"booking"`. They are different id spaces. Do not use one to call an
  endpoint meant for the other — use `contentPath`, which is already correct for both.
- **`date`** can be `null`; KiviCare did not always store one.
- **`mimeType`** can be `null` for a booking attachment whose file is gone.

### `canManage`

**Always `false` for `source: "booking"`, for every role.** That column is written by
KiviCare when the appointment is created and never by this API, so a rename or delete
control on one would be a button that cannot work. Only show manage controls when
`canManage` is `true`.

### `missing: true`

The attachment row is gone from WordPress. **Show these as unavailable — do not filter
them out.** The client attached something and it is no longer there; a list that is
silently shorter is more misleading than a visible gap.

### Pagination bounds

`perPage` is clamped to `[1, 100]`. `perPage=0` and negatives resolve to `1`; a value
that does not parse, or an absent one, gives the default `20`; anything above `100`
gives `100`.

---

## 3. Uploading

```
POST /api/v1/encounters/{encounterId}/documents
Content-Type: multipart/form-data
```

| Field | |
|---|---|
| `file` | required — jpg, jpeg, png, webp, gif or pdf, max 10 MB |
| `name` | optional label; falls back to the filename |

**Staff only.** A CLIENT gets 403.

Response `data`:

```json
{ "id": 88, "mediaId": 4242, "linked": true }
```

**Handle `linked: false`.** It means the file was saved to the patient's archive but its
tie to this encounter could not be written. The document is real and reachable — it will
appear in `patientDocuments`, not `sessionDocuments`. Tell the user that and let them
retry the link; do not present it as a failed upload, because the file is not lost.

Errors: `400` for a malformed multipart body or a missing `file` field, `422` when the
file fails type or size validation, `403` for a CLIENT, `404` when the encounter is not
one the caller may see.

---

## 4. Renaming

```
PATCH /api/v1/patient-medical-reports/{id}
{ "name": "Resume sesi konseling" }
```

Touches the label only — never the file. Blank or whitespace-only names are refused with
`400`. Staff only. Applies to `source: "report"` documents; `canManage` already tells you
which those are.

---

## 5. Deleting

```
DELETE /api/v1/patient-medical-reports/{id}
```

Removes the document and its link to the encounter together. Staff only.

Bulk delete (`POST /api/v1/patient-medical-reports/bulk/delete`) now **caps a request at
100 ids**. Over that you get `400 "Invalid input"`. The same cap applies to every bulk
endpoint in the API — encounters, prescriptions, receptionists, taxes, doctor-sessions.

---

## 6. Booking attachments have their own content route

For `source: "booking"`, `contentPath` points at:

```
GET /api/v1/sessions/{sessionId}/attachments/{mediaId}/content
```

You should never need to build this yourself — use `contentPath`. Note its status codes
differ from the reports route on purpose:

- **403** — the session is not yours to read.
- **404** — the media id does not belong to that session, *or* the file is gone.

The 404 is deliberate: a 403 there would confirm that someone else's file exists.

---

## 7. What changed that you may already depend on

### `GET /patient-medical-reports/{id}/file` no longer returns `fileUrl`

It returns `contentPath` instead. The old `fileUrl` was a WordPress URL that **always
answered 403** — the directory carries `Deny from all` — so anything reading it was
already broken, it just failed in a way that looked like a permissions problem.

```json
{ "reportId": 12, "name": "…", "mediaId": "4242",
  "contentPath": "/api/v1/patient-medical-reports/12/content" }
```

### `GET /patient-medical-reports/{id}/preview` is gone

It was a `501` stub. Use `/content`.

### `POST /api/v1/patient-medical-reports` now answers `501`

It used to accept a WordPress media id in the body. That let a caller create a document
row pointing at **any** file in the media library and then read its bytes — including
other clinics' clinical documents. The field is gone and the endpoint is retired.

**Create documents with `POST /api/v1/encounters/{id}/documents`**, which uploads the
bytes itself and therefore knows the file belongs to that patient.

### `POST /api/v1/bills/{id}/email`

A CLIENT can no longer choose the recipient — the invoice goes to the address registered
on their own account. Staff can still direct it, for bills within their own scope. If you
were sending `to` from a client-side form, remove it for client users.

---

## 8. Suggested order

1. Wire the list endpoint and render both sections with the `source` labels.
2. Wire opening a document (§1). Do this second — it is where the Bearer/blob detail
   bites, and everything else is easier once one document actually opens.
3. Add upload, then rename and delete behind `canManage`.
4. Sweep for `fileUrl`, `/preview`, and `POST /patient-medical-reports`, per §7.

---

## 9. Open questions for the API owner, not for you

Recorded so you are not surprised if answers change:

- Whether `POST /api/v1/patient-medical-reports` is retired outright rather than left
  at `501`.
- The `medical-report` context of `POST /api/v1/custom-fields/file-upload` currently has
  no consumer — a file uploaded there cannot be attached to anything.

If either of these is part of a flow you are building, ask before you build on it.
