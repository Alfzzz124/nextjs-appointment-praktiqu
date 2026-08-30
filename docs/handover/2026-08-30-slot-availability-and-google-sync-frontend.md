# Slot availability changes, and the Google Calendar settings page — front-end handover

**For:** the Laravel front-end team
**Date:** 2026-08-30
**API base:** `https://staging2.praktiqu.com/api/v1`
**Spec:** `docs/api/openapi.yaml`

This document has two halves, and they are **not** the same kind of thing:

- **Part A is shipped.** It is on `main` as of today. One response contract changed and
  several things silently got more correct. Read this one first — something you already
  depend on has changed.
- **Part B is not built.** It is the Google Calendar sync settings page, and no endpoint
  behind it exists yet. It is here so you can plan and raise objections while the API is
  still being designed. **Do not start coding against Part B without confirming the
  contract first** — see the note at the top of that section.

---

# Part A — Slot availability (shipped)

## Background, briefly

The system had three separate implementations of "which time slots are bookable", and they
disagreed with each other. They are now one. In consolidating them, several real bugs came
out. Most of the changes below are those bugs being fixed, which means **the API is now
returning different data than it did last week — and the old data was wrong.**

## A1. Past slots are no longer returned — the one contract change

`GET /public/professionals/{id}/slots` no longer returns slots on today's date whose start
time has already passed.

Before, at 16:00 the endpoint would happily return `09:00:00` for today. A patient could
select it, fill in the whole booking form, and only then be rejected by the write path.

```
GET /public/professionals/42/slots?serviceId=7&date=2026-08-30

{
  "date": "2026-08-30",
  "slots": [
    { "date": "2026-08-30", "startTime": "17:00:00", "endTime": "18:00:00" }
  ]
}
```

**What this means for you:** a day can now come back with an empty `slots` array where it
previously had entries. That is not an error and not an empty state for "professional does
not work today" — it means *there is nothing left today*. If your UI currently assumes a
working day always has slots, that assumption is now wrong for the current day, every day,
from the first slot onwards.

The rule is: a slot is hidden when its **start** is at or before now, compared in local
clinic time. A slot starting exactly now is hidden. Only today is affected; future dates
are untouched.

**The authenticated staff endpoint deliberately still returns past slots.** A receptionist
recording a walk-in that happened this morning needs them. If you share slot-rendering code
between the patient-facing and staff-facing screens, they now behave differently on purpose
— do not "fix" the staff one to match.

## A2. Always send `date` explicitly

The endpoint's `date` parameter is optional, and its default is derived in UTC. On a server
running ahead of UTC — which ours is — that default names **yesterday** for part of the day.

```
GET /public/professionals/42/slots?serviceId=7            ← don't
GET /public/professionals/42/slots?serviceId=7&date=2026-08-30   ← do
```

This is a known defect on our side and it is logged. Until it is fixed, passing `date`
explicitly sidesteps it entirely. There is no downside to always sending it.

## A3. `serviceId` is required, and there is no fallback

`serviceId` is mandatory. Omitting it returns `400 invalid_service`.

This is not new, but it is worth restating because the reason matters: slot length is the
professional's own duration for that specific service. The old route defaulted to 60
minutes when `serviceId` was missing, and therefore advertised slots that could not
actually be booked. There is no honest default, so there is no default.

## A4. Slot start times may shift for some professionals

Where a professional's per-service duration differs from the clinic session's grid size
(`time_slot`), the **service duration now wins** on the public path. It already won on the
staff calendar; the public path was the odd one out.

A doctor with a 90-minute service on a 30-minute grid used to show slots at 09:00, 09:30,
10:00…; they now show 09:00, 10:30, 12:00.

**This is a correctness fix, but clinics will read it as a bug.** If you have any cached or
screenshotted slot data, or any test fixture with hard-coded times, expect it to differ.
Worth warning your clinic contacts before they notice on their own.

## A5. `nextAvailable` now names the right day

`PublicProfessional.nextAvailable.date` in the professionals directory was computed with a
UTC conversion applied to a local date, so between 00:00 and 07:00 local it named the
previous day. Fixed. If you had a workaround for this — adding a day, or suppressing the
field during early hours — remove it.

## A6. Unpublished services now actually disappear

`is_public` on the service-to-professional mapping is now honoured in more places than it
was. A service an admin has deliberately un-published will stop appearing where it
previously still showed.

If a service vanishes from a listing and someone reports it as a bug, check
`wp_kc_service_doctor_mapping.is_public` before escalating — it is far more likely that the
flag is doing its job for the first time.

## A7. What has NOT changed

- Slot times are still `HH:MM:SS` strings in **local clinic time**. No timezone conversion
  is applied and none is expected from you.
- The response envelope is still `{ "date": "...", "slots": [...] }`.
- `404 professional_not_found` still means both "no such active professional" and "that
  professional does not offer that service publicly". Those remain deliberately
  indistinguishable to the public.
- Booking, holding and confirming are untouched.

## A8. Suggested order

1. Handle the empty-`slots`-today case (A1). This is the one that will produce a visible
   defect if you skip it.
2. Add `date` to every slots request (A2). Two minutes, removes a whole class of bug.
3. Drop any `nextAvailable` workaround (A5).
4. Warn clinic contacts about shifted slot times (A4) before they find out themselves.

---

# Part B — Google Calendar sync settings page (NOT BUILT — design input wanted)

> **Read this first.** Nothing in Part B exists yet. There is no endpoint, no database
> table, no OAuth client. The endpoint shapes below are a **proposal** written so you can
> react to them before they are built. If you start coding against them today, you are
> coding against something that may change.
>
> What is genuinely useful right now is your feedback: does this flow fit how your settings
> pages work, and is anything here going to be awkward on your side? Say so now, while it
> is cheap.
>
> Design document: `docs/superpowers/specs/2026-08-28-google-calendar-sync-design.md`

## B1. What the feature does

A professional connects their personal Google Calendar. From then on, the times they are
busy in Google stop being offered as bookable slots in PraktiQU.

It is **read-only and one-way**: we read their availability, we do not write PraktiQU
appointments into their calendar. Writing appointments back is a later phase and is
explicitly out of scope for this page.

Critically, we read **free/busy only** — opaque busy intervals, no event titles, no
descriptions, no attendees. This is deliberate: a psychologist's personal calendar
plausibly contains other clients' names, and we do not want that data in a health
application. **This is worth saying on the settings page itself**, because "connect your
calendar" is a request people are right to be cautious about, and "we can see when you are
busy, never what you are doing" is the honest and reassuring answer.

## B2. Why this page is not a normal form

It is an OAuth flow, so the shape is different from your other settings pages:

1. The professional clicks **Connect**.
2. Your front-end asks our API for an authorisation URL.
3. You **redirect the browser to Google** — not a popup fetch, a real navigation.
4. Google shows its consent screen. The professional approves or denies.
5. Google redirects back to **our** callback endpoint, not yours. We exchange the code and
   store the token.
6. We redirect back to your settings page with a result indicator.

You never see the Google token. You never handle the authorisation code. Steps 4 and 5 are
entirely outside your application.

## B3. Proposed endpoints

All under the authenticated professional's own scope — a professional manages only their
own connection.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/professionals/me/google-calendar` | Current connection status |
| `POST` | `/professionals/me/google-calendar/auth-url` | Returns the URL to redirect to |
| `DELETE` | `/professionals/me/google-calendar` | Disconnect |
| `PATCH` | `/professionals/me/google-calendar` | Change which calendars are synced |

Proposed status response:

```json
{
  "status": "active",
  "googleAccountEmail": "dr.pamela@gmail.com",
  "calendarIds": ["primary"],
  "lastCheckedAt": "2026-08-30T09:12:00Z",
  "lastErrorMessage": null
}
```

`status` is one of `not_connected`, `active`, `revoked`, `error`.

## B4. The four states, and why each needs different copy

This is the part most likely to be got wrong, so it is worth being explicit.

**`not_connected`** — nothing set up. Show the value proposition and a Connect button.
This is the state where the free/busy privacy point belongs.

**`active`** — working. Show which Google account is linked (`googleAccountEmail` — people
have several, and they need to see which one they picked), which calendars are being used,
and a Disconnect button.

**`revoked`** — *this is the important one.* The professional revoked our access from their
Google account settings, or their authorisation expired. **This is not an error and must
not be presented as one.** It is a normal, expected state, and the only correct response is
an unalarming "Reconnect" prompt.

It matters more than it looks, because of this:

> While our Google app is still in **Testing** status — which it will be until Google
> completes its verification review, potentially for weeks — **Google revokes every
> authorisation after 7 days.** Every connected professional will land in `revoked` weekly,
> by design, with nothing wrong.

If your UI renders `revoked` in red with a warning icon, every tester will report a bug
every week. Treat it as "please reconnect", not "something failed".

**`error`** — something is actually wrong on our side. Show `lastErrorMessage` if present
and a support route. This state should be rare; if testers see it often, tell us.

## B5. Calendar selection

Default is the professional's primary calendar. `PATCH` lets them choose others.

One thing to build in from the start rather than retrofit: **Google's own generated
calendars — holidays and birthdays — must be excluded by default.** Google reports all-day
events as busy for the entire day, so one "Budi's birthday" entry would erase every
bookable slot that day. A professional losing a full day of income to a friend's birthday
is far worse than an all-day event going unread.

If you show a calendar picker, make it obvious which calendars are actually being used, and
do not pre-tick everything.

## B6. Redirect handling

Our callback will redirect back to your settings page with a query parameter indicating the
outcome — success, or a failure reason such as the professional denying consent.

**The exact parameter names are not decided.** If you have a convention that fits your
existing redirect handling, tell us and we will match it rather than inventing our own.
This is the cheapest possible thing to agree on now and the most annoying to change later.

## B7. What to do with this section today

Nothing, in code. What would genuinely help:

1. Tell us if the endpoint shapes in B3 fit your patterns.
2. Give us your preferred redirect-result convention (B6).
3. Flag anything in the four states (B4) that is awkward in your settings UI.

The first thing to be built on our side is a de-risking step: confirming with Google which
verification path the narrow `calendar.freebusy` permission requires. That answer changes
the timeline, so there is no point building against a UI contract before it lands.

---

## Questions for the API owner, not for you

Recorded here so they are not lost, and so you know they are known:

- The `date` default on the slots endpoint (A2) is still UTC-derived. Logged, not yet fixed.
- The write path does not yet consult Google busy times, so once Part B ships, blocking a
  slot in the UI will not by itself prevent a booking through the hold-and-confirm API.
  This must be closed before the Google feature is considered done.
- Steps 1 and 2 of the booking wizard still run their own queries with their own admission
  rules, so "one place decides bookability" is true of slot generation and not yet true of
  service visibility.
