# Janji Manual Outside the Schedule (Laravel FE) — Design

**Date:** 2026-10-28
**Status:** Approved in conversation (user, 2026-10-28). Awaiting review of this written spec.
**Repo:** `raakanaka/laravel-praktiqu` (the Laravel front-end). New branch off `main`.
No change to this Next.js backend or to WordPress.

## Problem

Staff create appointments for clients through **Janji Manual** (`ManualAppointmentController`,
modal in `resources/views/dashboard.blade.php`). The time can only be picked from slot buttons.
Those slots come from the professional's working schedule (backend `fetchSlots`) plus the start
times of **Sesi Dadakan / Custom** rows for that professional and date (`jamCustom()`). The
`startTime` input is hidden, so a time cannot be typed.

To book outside the schedule today, staff must:

1. open the Sesi Dadakan menu and create a session at that time, with a duration that fits the
   service;
2. go back to Janji Manual and pick the new time.

The user wants this to be one step. In Janji Manual, staff pick "a time outside the schedule",
and the system creates the Sesi Dadakan and books the appointment together.

### What already holds (checked on `main` 2026-10-28)

- The backend does **not** check working hours on any booking path. `public-booking.service.ts`
  (used by Janji Manual through hold + `POST /public/appointments`) checks the booking window
  (`isTooSoon`), that the service is offered, appointment clashes and Google Calendar busy
  blocks. The plugin's `Schedule_Write::assertFree` checks clashes only. So a time outside the
  schedule is accepted as long as it is free.
- Sesi Dadakan live only in the FE table `custom_sessions`. The backend never sees them. This is
  deliberate (product decision 2026-09-30: custom sessions stay manual-only, no backend
  availability endpoint). This design keeps that.
- `CustomSessionController::store` enforces who may create a session:
  - psikolog: only for themselves; the clinic comes from their profile;
  - admin: clinic forced from the profile, the professional must be on that clinic's roster,
    and owner mode (`pemilik`) is re-checked against the backend;
  - super: anyone;
  - anyone else: 403.

  The FE has only three roles. `AuthController::roleOf` folds `CLINIC_ADMIN` **and
  `RECEPTIONIST`** into `admin`, so receptionists already create Sesi Dadakan today, with the
  admin rules. A psikolog in owner mode (`pemilik`) also acts as `admin`.

  It also rejects overlap with another Sesi Dadakan for the same professional and date.

## Decisions (made by the user, 2026-10-28)

| # | Question | Decision |
|---|---|---|
| 1 | Who may book outside the schedule | **Same as Sesi Dadakan**: psikolog for themselves, admin (which includes receptionists, see above) for professionals at their clinic, super for anyone. Corrected 2026-10-28: the user first picked this believing receptionists were excluded; told that they are folded into `admin`, the user chose to keep them allowed, with no new role |
| 2 | Safeguard for the professional | Admin (incl. receptionist and owner mode) and super must tick **"Sudah dikonfirmasi dengan psikolog"** before booking. A psikolog booking for themselves does not |
| 3 | Orchestration | One request. The server creates the session and books; if booking fails the session is deleted (approach A below) |

## Approaches considered

- **A — server-side, one request (chosen).** `store()` takes a `luarJadwal` flag, creates the
  Sesi Dadakan, then books, and deletes the session if booking fails. No orphan sessions, and
  the permission rules stay in one place.
- **B — browser orchestration.** Alpine calls `POST /dashboard/custom-sessions`, then the manual
  `store`. Less code, but a failed second call leaves a session with no appointment, and two
  requests mean two permission checks that can disagree.
- **C — backend schedule exceptions.** Teach the Next.js API about one-off availability.
  Rejected: it contradicts the 2026-09-30 decision, and the backend does not need it, since it
  does not enforce working hours.

## Design

### 1. Shared Sesi Dadakan rules

Move the rules out of `CustomSessionController::store` into a small service, e.g.
`App\Services\SesiDadakan`. Both the Sesi Dadakan menu and Janji Manual call it:

- `periksaPembuat(array $profile, int $doctorId, ?int $clinicId): array{tolak: ?JsonResponse, clinicId: ?int}`
  - Runs the role checks above.
  - `tolak` is set on rejection, with the same messages and statuses as today.
  - Otherwise `tolak` is null and `clinicId` is the clinic the row must carry. It can be null
    for super, as today.
  - The `periksaModePemilik` and `rosterKlinik` helpers move with it.
- `bentrok(int $doctorId, string $date, int $startMin, int $endMin): ?CustomSession`
  - Returns the overlapping Sesi Dadakan, if any.
- `penampung(int $doctorId, ?int $clinicId, string $date, int $startMin, int $endMin): ?CustomSession`
  - Returns a Sesi Dadakan that fully contains the range, if any. Its clinic must be null or
    `$clinicId`, the same filter `jamCustom()` applies.
- `periksaModePemilik(array $profile): ?JsonResponse` is public, because the menu's `destroy`
  still needs it.

`CustomSessionController::store` keeps its own request validation, its response messages and its
behaviour. Only the bodies move. `tests/Feature/CustomSessionTest.php` must pass unchanged.

### 2. Server: `ManualAppointmentController::store`

New optional request fields:

| Field | Rule |
|---|---|
| `luarJadwal` | `boolean` |
| `konfirmasiPsikolog` | `boolean` |

When `luarJadwal` is false or missing, `store()` behaves exactly as today.

When it is true, after the existing `tolakPsikologDiLuarCakupan` and `klinikPesanan` steps:

1. **Who.** Call `SesiDadakan::periksaPembuat` and return its rejection unchanged. For an
   admin this asks for the clinic roster a second time (`tolakPsikologDiLuarCakupan` already
   did). That is accepted: it only happens on this path.
2. **Confirmation.** For every role except `psikolog`, `konfirmasiPsikolog` must be true. Otherwise
   422 *"Centang konfirmasi bahwa jam ini sudah disepakati dengan psikolog."*
3. **Time.**
   - `startTime` must be `HH:MM` on a 5-minute step.
   - Date + time must be in the future in Asia/Jakarta.
   - Start + service duration must not pass midnight.
   - The duration comes from `BookingApi::fetchServices` for that professional and clinic, the
     same source `jamCustom()` uses.
   - If that call fails, answer `self::UPSTREAM_REJECTED` (424, as the other upstream failures
     in this controller) *"Durasi layanan gagal dimuat. Coba lagi."*.
   - If the service is not in the list, answer 422 *"Layanan ini tidak dibuka psikolog
     tersebut."*. (`mapServices` defaults a missing duration to 60, so a listed service always
     has one.)
   - Nothing is written in any of these cases.
4. **Session.**
   - If `penampung()` finds a Sesi Dadakan that already covers the whole range, use it and
     create nothing.
   - Else, if `bentrok()` finds a partial overlap, answer 422 *"Bentrok dengan Sesi Dadakan lain
     pada jam yang sama."*
   - Else create a `CustomSession`, right before booking (after the client has been read, so
     a client error such as a missing phone number never leaves a row), with:

     | Column | Value |
     |---|---|
     | `kind` | `dadakan` |
     | `duration` | the service duration |
     | `clinic_id` | from step 1 |
     | `note` | `Otomatis dari Janji Manual` |
     | `created_by_role`, `created_by_id` | as in the menu |

     Remember that this request created it.
5. **Book.** Call `submitBooking` as today. If it throws anything, and step 4 created the row,
   delete that row, then let the existing error mapping answer.
   - Conflict and expired hold become 409 *"Jam ini baru saja terisi…"*.
   - Other errors keep their current mapping.

   Use `try`/`catch (\Throwable)` + rethrow so `ModePemilikBerakhirException` and unexpected
   errors also roll back.
6. **Success message.** Append *" Sesi Dadakan HH:MM–HH:MM dibuat otomatis."* when step 4
   created a row. A reused row adds nothing.

`luarJadwal` with a time that is already in the professional's slot list for that date needs
no special case on the server. The UI never sends it (see §3). If a caller does send it, the
worst case is an extra Sesi Dadakan row over working hours. That is harmless.

### 3. UI: "3 · Tanggal & Jam" in the Janji Manual modal

New Alpine state:
- `manualLuarJadwal` (bool);
- `manualJamLain` (`HH:MM`);
- `manualKonfirmasi` (bool).

Reset all three wherever `manualForm.startTime` is reset today: professional, service or date
change, and modal open.

- **Entry point.**
  - A link **"+ Jam lain (di luar jadwal)"** under the slot buttons.
  - No role check: every FE role (`super`, `admin`, `psikolog`) may use it, and the server
    enforces the scope.
  - It is shown when:
    - a professional, a service and a date are chosen;
    - the slot status is `ada` or `kosong`, not `idle`, `memuat`, `lampau` or `tidak-dilayani`.
  - The link sits after the slot list and the `kosong` box, so it also shows right under "Tidak
    ada jam kosong". There is no second button inside the box.
- **Input.**
  - Clicking the link sets `manualLuarJadwal = true`, clears any picked slot, and shows
    `<input type="time" step="300">`.
  - Next to the input, a preview: *"10:15–11:15 · 60 menit (sesuai layanan)"*.
  - Under it, a note: *"Jam ini di luar jadwal praktik. Sesi Dadakan akan dibuat otomatis."*
  - A "Batal" link returns to the slot list.
  - Picking a slot button also leaves this mode.
- **Same as an existing slot.** If the typed time is in `manualSlots`, select that slot
  instead: `manualLuarJadwal = false`, `manualForm.startTime = t`. Show no out-of-schedule
  note.
- **Confirmation.** For every `peranUi` except `psikolog`, show the checkbox **"Sudah dikonfirmasi dengan
  psikolog"**. The Pesan button is disabled until it is ticked. Psikolog do not see it.
- **Submit.**
  - `manualForm.startTime = manualJamLain`.
  - The body adds `luarJadwal: true` and `konfirmasiPsikolog`.
  - Client-side checks mirror the server, for a quick message: time present, in the future,
    not past midnight.
  - The server stays the authority.
- The next time slots are loaded for that professional, service and date, the time shows as a
  normal slot, because `jamCustom()` now returns it.

### 4. After the appointment

The Sesi Dadakan is **not** removed when the appointment is later cancelled or rescheduled. The
time stays bookable through Janji Manual, and the session can be deleted from the Sesi Dadakan
menu. No link column between session and appointment is added (YAGNI).

### 5. What does not change

- The backend booking window (`isTooSoon`), clash checks and Google Calendar busy blocks still
  apply, as for every Janji Manual booking today.
- Patients still never see Sesi Dadakan on the public booking page.
- The Sesi Dadakan menu itself.

## Error handling summary

| Case | Status | Session row |
|---|---|---|
| Professional outside the actor's scope | 403 | none created |
| Admin (incl. receptionist) or super without confirmation | 422 | none created |
| Time invalid, in the past, or past midnight | 422 | none created |
| Service list fails to load | 424 (`UPSTREAM_REJECTED`) | none created |
| Service not offered by the professional | 422 | none created |
| Partial overlap with another Sesi Dadakan | 422 | none created |
| Booking rejected (clash, too soon, email conflict, upstream error) | as today | created row deleted |
| Success | 201 | created, or existing one reused |

## Testing

- **`tests/Feature/ManualAppointmentTest.php`** (Http fakes as the existing tests use):
  - psikolog books outside the schedule for themselves → 201, one `dadakan` row with the
    service duration;
  - psikolog for another professional → 403, no row;
  - admin without `konfirmasiPsikolog` → 422, no row; with it → 201;
  - time not on a 5-minute step, or past midnight → 422, no row;
  - booking upstream answers slot conflict → 409 and the created row is gone;
  - an existing Sesi Dadakan covers the range → 201 and no second row;
  - a partial overlap → 422, no row;
  - past time → 422;
  - `luarJadwal` absent → request and behaviour identical to today (regression).
- **`tests/Feature/CustomSessionTest.php`**: existing tests pass unchanged after the extraction; one new test pins the overlap rejection, which nothing covered before.
- **JS:** extend `tests/js/janji-manual-jam.test.mjs` for:
  - when the link shows, per slot status;
  - typed time equal to a slot switches to that slot;
  - the button stays disabled without confirmation for every role except psikolog, and not for psikolog.

  Run the full JS test loop before the PR. CI does not run these tests.
- **Browser smoke test** with the local stub setup:
  - as admin: open Janji Manual, pick a date with no slots, add a time, tick, book;
  - check the row appears in the Sesi Dadakan list;
  - check the time now shows as a slot.
