# Google Calendar availability sync — design

**Date**: 2026-08-28
**Status**: Approved, ready for planning
**Related**: `src/services/professional/availability.service.ts` (slot generation), `docs/deploy/FINAL-MIGRATION-CHECKLIST.md` (staging constraints)

## Problem

A professional's real life does not live in PraktiQU. They have a dentist appointment at
14:00, a school run at 16:00, a supervision session on Thursdays — all of it in their
personal Google Calendar. Today PraktiQU knows nothing about any of it and will happily
offer those hours to a patient.

We want the slots we show to reflect the professional's actual availability, so a patient
never books an hour the professional has already given away.

KiviCare Pro appears to offer this already — there is a toggle for it in settings. It does not
work; see "Prior art: KiviCare Pro" below. Nothing is being replaced here, only built.

## Decisions

| Decision | Choice |
|---|---|
| Direction | **One-way, Google → PraktiQU.** We read availability. We do not write our appointments into their calendar. |
| Google account type | **Personal Gmail**, varying per professional. Rules out service accounts and domain-wide delegation. |
| API used | **`freebusy.query`**, not `events.list` |
| OAuth scope | **`calendar.freebusy`** — the narrowest scope that exists |
| Freshness | Minutes, not overnight. Checked at slot-listing time and again immediately before write. |
| Push notifications | **Not in v1.** See "Why no webhook in v1". |
| Backward conflicts | **Warn the professional only.** Never auto-cancel. A PraktiQU booking stays the source of truth. |
| Google unreachable | **Fail open** — slots are still generated and bookings still succeed, flagged as unverified |
| Prerequisite | Unify the duplicated slot generators first, as its own change |

### Why `freebusy`, not `events.list`

`freebusy.query` returns opaque busy intervals — no titles, no descriptions, no attendees.
`events.list` returns everything.

A psychologist's personal calendar plausibly contains the names of clients seen outside
PraktiQU, therapy appointments of their own, medical appointments. Pulling that into a
health application's database is a liability we gain nothing from: to decide whether a slot
is bookable, "busy 14:00–15:00" is the entire answer.

Choosing `freebusy` makes the privacy guarantee structural rather than a promise about what
we remember not to read. It also lets us request `calendar.freebusy` instead of
`calendar.readonly`, which is a materially easier scope to justify during OAuth review.

The cost is that `freebusy` has no `syncToken` and no `watch` support. Given the decision
below, we do not need either.

### Why no webhook in v1

Google Calendar does support push notifications (`events.watch`), but they are a poor fit
for what actually protects us here:

- The notification has **no body**. It says "something changed", not what. We would still
  have to call the API afterwards.
- Delivery is **best-effort**; Google's own docs say to expect a small percentage of
  messages to be dropped. A webhook can therefore never be the only guard — a reconciliation
  path is required regardless.
- Channels **expire and do not auto-renew**, so a renewal cron is required too.

Meanwhile the moment that actually matters is the instant a patient submits a booking, and
a live `freebusy` call at that instant is strictly more correct than any notification that
arrived earlier. So the webhook buys latency on *warnings*, not correctness on *bookings*.

It is also the only part of the feature that has to fight the staging WAF (see
"External constraints"). Deferring it removes that fight from the critical path. Phase 6
adds it once the rest is proven.

## External constraints discovered during research

These are properties of Google and of our hosting, not choices we made. They shape the plan.

**OAuth app verification is required and is the long pole.** Calendar scopes are classified
sensitive. A production app serving arbitrary Gmail users must pass Google's OAuth
verification: privacy policy, homepage on a verified domain, a demo video, and a written
justification per scope. Google quotes ~10 days for a complete submission; real timelines
run longer with back-and-forth.

**Whether `calendar.freebusy` specifically is sensitive is not documented anywhere public.**
The "sensitive" badge is only visible in the Cloud Console scope picker. Phase 0 resolves
this by looking. Until then we plan for the pessimistic case.

**Refresh tokens die every 7 days while the app is in Testing.** With publishing status
Testing and user type External, Google revokes refresh tokens after 7 days. Every test
professional must re-consent weekly until the app reaches Production. This is expected
behaviour, not a bug — it must be written down before someone spends a day debugging it.

**The staging host sits behind a WAF that answers server-to-server callers with a JS
bot-check**, and applies a per-IP rate limit (`docs/deploy/2026-08-06-public-self-registration-deploy.md:37`).
An inbound POST from Google runs no JavaScript. Any future webhook endpoint needs a WAF
allowlist before it can work at all.

**Quota is not a constraint.** Calendar API allows 1,000,000 requests/day per project,
10,000/min per project, 600/min per user. `freebusy.query` covers an entire date range in a
single request, so a 14-day view costs one call, not fourteen. With a 60-second cache the
worst case is roughly 720 calls per professional per day; 50 professionals is ~3.6% of the
daily quota.

## Prior art: KiviCare Pro

KiviCare Pro ships a Google Calendar integration at
`Wordpress-Plugin/kivicare-pro/app/controllers/api/GoogleCalendarIntegration.php` (1577 lines).
Because decoupling from KiviCare is the wider goal, what it does — and does not — do matters.

| Capability | State |
|---|---|
| OAuth connect / disconnect | Works |
| Appointment -> Google event (create/update/delete) | Works |
| Google busy -> blocked slots | **Dead code**, see below |
| Push channels, webhook, daily renewal cron | Present |
| Google event moved -> appointment auto-rescheduled | Present |

### The read direction never runs

`GoogleCalendarIntegration.php:68` reads the per-doctor toggle with
`get_user_meta($doctorId, 'kc_google_calendar_sync_events', false)`. The third argument is
`$single`; passing `false` returns an **array**, so the `=== 'yes'` and `=== ''` comparisons
that follow can never be true and the fetch is never reached. The filter stays registered,
runs on every slot generation, and returns `$busySlots` untouched.

The writer at `ProSettings.php:1170` stores a correct `'yes'`/`'no'` scalar, so the defect is
only the missing `true`. The same pattern repeats at `ProSettings.php:1146`, which makes the
settings API report the toggle as off no matter what is stored.

Two consequences:

1. **Nothing is lost by rebuilding the read direction from scratch.** It has never worked.
2. **There is a live risk today, independent of this feature.** A professional who switched
   the toggle on believes their personal commitments block bookings. They do not. Worth
   communicating separately from this work.

Had the bug been fixed, three further problems would surface, all of which this design avoids:
it uses `events.list` rather than `freebusy` (deliberately, to read event titles, which it
stores as the busy slot's `name`); `maxResults: 250` with no pagination silently truncates a
busy calendar; and all-day events map to `00:00:00Z`-`23:59:59Z`, blocking the whole day.

It requests `https://www.googleapis.com/auth/calendar` — the broadest Calendar scope there is,
including permanent deletion of any calendar the user can access.

### Tokens cannot be migrated

Refresh tokens are bound to the OAuth client that issued them; KiviCare's came from KiviCare's
client. Every professional must re-consent through ours. This is how OAuth works rather than a
choice we are making, and it should be planned for as a communication task.

## Architecture

### Read path — what the patient sees

`generateSlots` builds its `blocked[]` array as it does today (off-days, then active
appointments). If the professional has an active Google connection, busy intervals are
merged into that same array. Nothing downstream changes.

The cache is **stale-while-revalidate**:

| Cache state | Behaviour |
|---|---|
| Fresh (< 60s) | Serve it |
| Stale | Serve it immediately, refresh in the background |
| Empty | One synchronous fetch, hard 2s timeout, then fall through to no-Google |

The page never waits on Google for longer than that timeout.

### Write path — the booking guard

Immediately before an appointment row is written, one live `freebusy` call covering just
that slot's range.

- Conflict → reject with "this slot was just taken", refresh the listing.
- Google error or timeout → **the booking proceeds**, and the appointment is marked as
  having an unverified availability check.

Failing open is deliberate. A Google outage must not stop a practice from taking bookings.
The residual risk is an occasional double-booking, which is handled by the warning path
rather than by blocking revenue.

### Warning path — backward conflicts

A daily cron walks each active connection, fetches `freebusy` over the window covering
upcoming appointments, and notifies the professional about any overlap with an existing
PraktiQU booking. Nothing is cancelled or rescheduled automatically.

## Data

Two new tables. Created with **targeted SQL, not `prisma migrate dev`** — `DATABASE_URL`
points at the live WordPress database and the schema mixes app tables with `wp_` tables.

### `GoogleCalendarConnection`

One row per professional.

| Column | Notes |
|---|---|
| `professionalId` | The `wp_users.ID` of the professional — the same value `generateSlots` takes as `doctorId`. Unique. |
| `googleAccountEmail` | Shown in settings so they can tell which account is linked |
| `refreshTokenEncrypted` | AES-256-GCM, key from env |
| `scopeGranted` | Recorded so a later scope change is detectable |
| `calendarIds` | JSON; defaults to `["primary"]` |
| `status` | `active` \| `revoked` \| `error` |
| `lastCheckedAt`, `lastErrorAt`, `lastErrorMessage` | Surfaced on the settings page |

### `GoogleBusyCache`

Busy intervals per (professional, date range), stored as a JSON array of UTC instants with
a `fetchedAt`. Unique on `(professionalId, rangeStart, rangeEnd)`.

Deliberately in the database rather than in process memory: Passenger may run several
processes, an in-process cache would be cold after every restart, and the warning cron can
reuse the same rows.

**What is never stored**: event titles, descriptions, attendees. `freebusy` does not return
them, so this is a structural guarantee.

## Integration point

One place: the `blocked` array at `src/services/professional/availability.service.ts:305`.

Once the slot generators are unified (Phase 1), that single change covers the public booking
page, the public catalog, and the staff calendar together.

### Timezone is the sharp edge

`blocked[]` uses minutes-from-midnight in the practice's local time. Google returns UTC
instants. Converting between them requires the practice timezone, which currently lives
inside the clinic's `extra` JSON blob (the settings form defaults to `Asia/Makassar`;
`DEFAULT_TIMEZONE` in env is `Asia/Jakarta`). It must be read, never assumed.

Getting this wrong shifts every block by hours, and the symptom is *the wrong slots being
blocked* — not a crash. It needs explicit cross-timezone tests, including an interval that
starts before local midnight and ends after it.

### Prerequisite: unify the slot generators

Two live code paths render slots to patients and only one goes through the shared service:

- `src/services/public/public-catalog.service.ts:238` → shared `generateSlots`
- `src/app/(public)/book/[professionalId]/[serviceId]/page.tsx:153` → **its own**
  `generateSlots` over raw SQL, rendering 14 days

The second is the page patients actually browse. Injecting Google blocks only into
`availability.service.ts` would leave it untouched — the exact opposite of the feature's
goal. The comment at `public-catalog.service.ts:216` already claims the public page and the
staff calendar cannot disagree about what is free; the `page.tsx` path contradicts it today.

Phase 1 deletes the local generator and routes the page through `getPublicSlots`, as a
separate reviewable change with its own regression tests.

## Failure modes

| Condition | Behaviour |
|---|---|
| `invalid_grant` (revoked, or 7-day Testing expiry) | Mark connection `revoked`, **stop calling Google entirely** for that professional, show a reconnect banner. No retries — a revoked token never recovers, and retrying only burns rate limit. |
| 403 / 429 | Truncated exponential backoff with jitter (1s, 2s, 4s … capped ~32–64s, plus up to 1s random). Serve stale cache meanwhile. |
| Timeout / 5xx | Serve stale cache; if none, generate without Google blocks and record the check as skipped. |
| Calendar 404 (deleted/unshared) | Deactivate that `calendarId` only; other calendars keep working. |
| Decryption fails (key missing or rotated) | Log at error level and mark the connection `error`, **not** `revoked`. |
| All-day events | Excluded — see below. |

### Why a decryption failure must be loud

If it were swallowed as an ordinary error, the symptom would be identical to "nobody has
connected Google yet": every slot shows, nothing is blocked, nothing looks wrong. A silent
key rotation would disable the entire feature across all professionals and no one would
notice. Hence a distinct `error` status and a noisy log.

### All-day events

`freebusy` reports all-day events as busy for the whole day, so a single "Budi's birthday"
entry would erase every slot that day. Two layers of handling:

1. Google's built-in calendars (holidays, birthdays) are not synced by default.
2. Intervals spanning the entire local practice window for that day are ignored.

The professional can still choose which calendars are synced.

Rationale: "a professional loses a full day of income because of a friend's birthday" is far
more damaging than "one genuine all-day block is missed". This is cheap to reverse if
experience says otherwise.

## Testing

**Unit**
- UTC instant → local minutes conversion, in `Asia/Jakarta` and `Asia/Makassar`, including
  an interval crossing local midnight
- Merge logic follows the existing half-open semantics (`b.start < end && b.end > start`)
- All-day / full-window filtering

**Integration**
- `generateSlots` with an injected fake `freebusy` client returning fixed intervals,
  asserted through **all three** consumer paths post-unification — that divergence is
  precisely what leaked before
- Cache behaviour: fresh, stale, empty
- Booking guard rejects on conflict, and proceeds on Google error

No real Google calls in tests; the `freebusy` client sits behind an injectable interface.
Uses the `wordpress-praktiqu-test` database as usual.

**Not covered by automated tests**: the OAuth round trip. Verified manually on staging.
Stated here rather than pretended otherwise.

## Phases

| Phase | Content |
|---|---|
| **0 — de-risk (~1 day)** | Create the GCP project, check the sensitive badge on `calendar.freebusy` in the scope picker, create an OAuth client, make one manual `freebusy` call locally. **This is a gate**: it determines the verification path. |
| **1 — unify slot generators** | Delete the local generator in `page.tsx`, route through `getPublicSlots`. No Google yet. Closes an existing divergence bug. |
| **2 — connection** | Tables, token encryption, OAuth flow, connect/disconnect settings page. Slots untouched. |
| **3 — read** | `freebusy` client, cache, merge into `blocked[]`, timezone handling. The core of the feature. |
| **4 — booking guard** | Live check before write. |
| **5 — warning cron** | Backward-conflict detection and notification. |
| **6 — webhook push** | Only after verification passes. Requires a WAF allowlist. |

Verification material (privacy policy, homepage on a verified domain) is prepared from
Phase 2, but **submission can only happen after Phase 3** — Google requires a demo video of
the working feature. The review wait then runs in parallel with Phases 4 and 5 instead of
blocking everything at the end.

## Out of scope

- **Writing PraktiQU appointments into the professional's Google Calendar.** Deferred, not
  rejected — this is the one KiviCare capability that genuinely works and would be lost on
  decoupling. When it is picked up, prefer the `calendar.app.created` scope: create a separate
  "PraktiQU" calendar in the professional's account and write only there. Paired with
  `calendar.freebusy`, neither scope grants read access to their personal event content —
  unlike KiviCare's `auth/calendar`. Sequenced after the read direction is proven in production.
- Calendar providers other than Google (Outlook, Apple)
- Patient-side calendar sync — the existing "Add to Google Calendar" button in
  `src/components/booking/confirmation.tsx` is unrelated and unchanged
- Automatic cancellation or rescheduling on conflict. Note that KiviCare *does* do this
  (`GoogleCalendarIntegration.php:1374`): moving a Google event reschedules the patient's
  appointment, and reverts the Google event if the new slot is taken. It contradicts the
  approved "warn, never auto-cancel" decision and is not ported unless that decision is
  revisited deliberately.

## Open questions

None blocking. Two to revisit with real usage:

1. Whether the 60-second cache TTL is the right trade between freshness and latency.
2. Whether the all-day exclusion rule holds up, or whether professionals genuinely want
   all-day events to block their day.
3. How many professionals are connected to KiviCare's integration today
   (`kc_google_calendar_token` in `wp_usermeta`). This sizes the re-consent communication.
   Unanswered so far: Docker is unreachable from this WSL distro, so the local database could
   not be queried. Needs Docker Desktop WSL integration, or a read-only query on staging.

## References

- [Get push notifications — Google Calendar](https://developers.google.com/workspace/calendar/api/guides/push)
- [Synchronize resources efficiently](https://developers.google.com/workspace/calendar/api/guides/sync)
- [Freebusy: query](https://developers.google.com/workspace/calendar/api/v3/reference/freebusy/query)
- [Usage limits](https://developers.google.com/workspace/calendar/api/guides/quota)
- [OAuth 2.0 scopes for Google APIs](https://developers.google.com/identity/protocols/oauth2/scopes)
- [Sensitive scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification)
