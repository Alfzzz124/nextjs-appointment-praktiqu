# Front-end breaking changes — the KiviCare id migration

There is no compatibility shim and no version header. The break is deliberate and
happens once (decision D2). Everything here is mechanical — field types and one
vocabulary — none of it changes a flow.

**Two states, so read the section headers.** §1–§4 are **live on
`staging2.praktiqu.com`** and were sampled from that deployment rather than from the
source, so they are what the API returns there today. **§4a and §4b are merged but NOT
yet deployed** — they land with the next staging build. Test against them only after
that deploy; until then staging still speaks the old session-note and plan payloads.

`docs/api/openapi.yaml` is generated from the same Zod schemas the routes validate
with, so it is the authoritative reference for every shape below.

---

## 1. Resource ids are integers, not cuids

Every id the API returns for a *domain resource* is now a WordPress / KiviCare integer.

| Resource | Before | Now | Source of the id |
|---|---|---|---|
| client | `"clx7fa…"` | `17` | `wp_users.ID` |
| professional | `"clx9k2…"` | `151` | `wp_users.ID` |
| session | `"clxa11…"` | `34` | `wp_kc_appointments.id` |
| practice / clinic | `"clxb03…"` | `4` | `wp_kc_clinics.id` |
| service | `"clxc55…"` | `472` | `wp_kc_services.id` |

This applies to nested references too — `clinicId`, `professionalId`, `clientId`,
`serviceId` in every request body and response.

```jsonc
// GET /api/v1/sessions  →  data[0]
{ "id": 34, "clinicId": 4, "professionalId": 33, "clientId": 39,
  "professionalName": "Debi Amelia Rachmawati", "slotDate": "2023-09-13",
  "startTime": "19:00:00", "endTime": "20:00:00" }
```

**If you store ids anywhere — session, cache, hidden form field, URL — the old values
are dead.** They refer to rows in tables nothing reads any more. Clear them rather than
migrating them.

**Non-numeric ids now fail loudly.** `/api/v1/clients/abc` returns 400/404 instead of
being passed to the database. That is deliberate: the old code turned it into `NaN` and
produced `Unknown column 'NaN'` 500s. If any screen builds a URL from a stale cuid, you
will see a clean 404 — that is the new behaviour working, not a regression.

---

## 2. ⚠️ `user.id` is NOT a resource id — the trap most likely to bite

The login response did **not** change shape, and that is exactly the danger:

```jsonc
// POST /api/v1/auth/login
{
  "user": {
    "id": "cmrhxo22l0006usokhbjug1fe",   // ← auth id. STILL a cuid. Not a client id.
    "email": "ahmad.luthfi124@gmail.com",
    "role": "SUPER_ADMIN",
    "wpUserId": 204                       // ← THIS is the id resources are keyed on
  },
  "accessToken": "eyJhbGciOi…",
  "accessTokenExpiresAt": "2026-07-31T03:48:50.000Z",
  "refreshToken": "2s2oOfY-…",
  "refreshTokenExpiresAt": "2026-08-07T03:33:50.197Z"
}
```

`user.id` identifies the JWT subject in our auth mirror and stays a cuid. `user.wpUserId`
is the WordPress user id, and that is what `/clients/{id}`, `/professionals/{id}` and
every `clientId` / `professionalId` field mean.

**Rule: authenticate with `user.id`, address resources with `user.wpUserId`.**

Anywhere the front-end currently does `/api/v1/clients/{{ user.id }}` — a client viewing
their own profile, a professional viewing their own schedule — it must become
`{{ user.wpUserId }}`. This will not throw a type error; it will just 404, which is why
it is worth grepping for deliberately.

---

## 3. Session status: seven values became five

KiviCare stores five. We had invented two more, and they are gone.

| Removed | Send / expect instead |
|---|---|
| `COMPLETED` | `CHECK_OUT` |
| `REJECTED` | `CANCELLED` |

Remaining: `CANCELLED`, `PENDING`, `BOOKED`, `CHECK_IN`, `CHECK_OUT`.

Any status filter, badge label, colour map or `switch` carrying the two old values needs
updating. A filter still asking for `COMPLETED` returns nothing rather than erroring.

`CHECK_OUT` is now terminal — nothing transitions out of it.

---

## 4. Public endpoints

**`GET /public/professionals`** — `nextAvailable` changed from a bare time string to an
object, and is honest about what it means:

```jsonc
{ "items": [ {
    "id": 25, "fullName": "Hira Yuki Molira",
    "specialties": ["Psikolog", "Dewasa"],
    "nextAvailable": { "date": "2026-07-31", "startTime": "09:00:00" }  // or null
} ] }
```

It reports the next day the professional has **working hours** — not a free slot. Call
the slots endpoint for bookable times. (The old field claimed a bookable slot while
ignoring existing bookings, so it could name a time that was already taken.)

Accepts an optional `?clinicId=` (integer).

**`GET /public/professionals/{id}/slots`** — **`serviceId` is now required.** Without it:
`400 invalid_service`. There is no default, because the slot length is the professional's
own duration for that service; the old 60-minute fallback could advertise unbookable
slots. Slots now subtract real bookings and off days.

```
GET /public/professionals/29/slots?date=2026-08-03&serviceId=472
→ { "date": "2026-08-03",
    "slots": [ { "date": "2026-08-03", "startTime": "08:30:00", "endTime": "09:30:00" }, … ] }
```

**`POST /public/appointments`** — `professionalId` and `serviceId` are integers. Strings
of digits (`"29"`) are still accepted and coerced, so an HTML form needs no change; a
cuid is rejected with 422.

New failure to handle: **`409 email_conflict`** — the email belongs to an existing
non-patient account (a doctor or admin). Show "email already registered, please sign in",
not a generic error.

---

## 4a. Session notes — SOAP is gone

`POST /api/v1/session-notes` and `PATCH /api/v1/session-notes/{id}` no longer accept
`soap`. A note is a KiviCare encounter now, and its body is typed entries using
KiviCare's own vocabulary — which is what makes the note visible in KiviCare's encounter
view, templates and print output. The four SOAP sections were ours alone and no KiviCare
screen could render them.

```jsonc
// before
{ "sessionId": "5150", "soap": { "subjective": "…", "objective": "…", "assessment": "…", "plan": "…" } }

// now
{
  "sessionId": "5150",
  "content": "Sesi berjalan lancar",              // optional free text → encounter description
  "entries": [                                     // optional, repeatable, typed
    { "type": "problem",     "title": "Kecemasan sosial" },
    { "type": "observation", "title": "Kontak mata membaik" },
    { "type": "note",        "title": "Klien lebih terbuka" }
  ]
}
```

At least one of `content` or `entries` is required. `type` must be one of
`problem` / `observation` / `note` — anything else is a 422.

The response gains `entries` and keeps `content` and `summary`, both now **derived** from
the encounter rather than stored. **The note `id` is an integer** (the encounter id), and
`PATCH` replaces entries rather than appending, so a retry cannot duplicate them.

Closing a note (`POST /{id}/close`) now actually emails the patient their notes and
prescription — that listener existed in KiviCare but nothing had ever triggered it.

## 4b. Intervention plans — page-based, and ids are integers

```jsonc
// GET /api/v1/intervention-plans
// before: { "plans": [...], "nextCursor": "clx…" }
// now:    { "plans": [...], "total": 42, "page": 1, "limit": 20 }
```

Send `?page=` instead of `?cursor=`. Encounters have no stable cursor, and the old one
was an `intervention_plans` cuid that no longer exists.

Plan and item ids are integers. Two field-level notes:

- **`durationDays` can be `null` even when a duration was set.** KiviCare stores it as
  free text ("30 hari", "2 minggu"); only a plain number round-trips. Render the null as
  "not specified" rather than 0.
- **`status` is derived from the items**, not stored. An empty plan is `ACTIVE` — there
  is nothing in it to have finished.

One behaviour change worth knowing: creating a plan for a session that already has a
session note now **succeeds and reuses that record**, because a plan and a note are two
views of the same encounter. A `409` means the plan already carries recommendations.

## 5. What has NOT changed

- Auth flow, token lifetimes, refresh, all `/auth/*` paths and shapes.
- Response envelopes: `{ data, pagination }` for lists, RFC-7807 `problem+json` for errors.
- Every endpoint path. No route was renamed, added or removed for this migration.
- Pagination parameters and shape.

---

## 6. Suggested order

1. Grep for `user.id` used as a resource id → `user.wpUserId` (§2). Highest risk, silent.
2. Replace the `soap` payload with `entries` (§4a), and `?cursor=` with `?page=` (§4b).
3. Drop `COMPLETED` / `REJECTED` from every session-status map (§3).
4. Loosen id types from string to int, or keep them opaque — but stop *generating* or
   *validating* them as cuids (§1).
5. Add `serviceId` to slot lookups (§4).
6. Clear any persisted ids before first run against the new staging.
