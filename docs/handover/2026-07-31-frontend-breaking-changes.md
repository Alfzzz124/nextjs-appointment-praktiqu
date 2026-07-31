# Front-end breaking changes — the KiviCare id migration

Deployed to `staging2.praktiqu.com` on 2026-07-31. Shapes below were sampled from that
deployment, not from the source, so they are what the API actually returns today.

There is no compatibility shim and no version header. The break is deliberate and
happens once (decision D2). Everything here is mechanical — field types and one
vocabulary — none of it changes a flow.

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

## 5. What has NOT changed

- Auth flow, token lifetimes, refresh, all `/auth/*` paths and shapes.
- Response envelopes: `{ data, pagination }` for lists, RFC-7807 `problem+json` for errors.
- Every endpoint path. No route was renamed, added or removed for this migration.
- Pagination parameters and shape.

---

## 6. Suggested order

1. Grep for `user.id` used as a resource id → `user.wpUserId` (§2). Highest risk, silent.
2. Drop `COMPLETED` / `REJECTED` from every status map (§3).
3. Loosen id types from string to int, or keep them opaque — but stop *generating* or
   *validating* them as cuids (§1).
4. Add `serviceId` to slot lookups (§4).
5. Clear any persisted ids before first run against the new staging.
