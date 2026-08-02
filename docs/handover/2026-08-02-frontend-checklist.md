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

## What did NOT change

Auth flow and token lifetimes. Every endpoint path — nothing was renamed, added or
removed. Response envelopes (`{data, pagination}` for lists, RFC-7807 `problem+json` for
errors). Pagination parameter names, apart from plans moving off `cursor`.
