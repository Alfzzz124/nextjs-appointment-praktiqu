# Configurable Redirect Rules (Laravel FE) — Design

**Date:** 2026-10-13
**Status:** Approved in conversation (user, 2026-10-13). Awaiting review of this written spec.
**Repo:** `raakanaka/laravel-praktiqu` (the Laravel front-end on `appointment.praktiqu.com`).
No change to this Next.js backend or to WordPress.

## Problem

`appointment.praktiqu.com` used to be the WordPress site. Each psychologist had a KiviCare
booking page there, `/appointment-<name>`, and those links were shared with patients. Since the
domain moved to the Laravel FE, every one of them answers **404**:

- `https://appointment.praktiqu.com/appointment-azanidianda-com` → 404
- `https://appointment.praktiqu.com/azanidianda-com` → 200 (the new booking page)

WordPress (now `api-appointment.praktiqu.com`) still has **23 such pages** (26 slugs starting
with `appointment`, minus `appointment`, `appointment-2`, `appointment-4`). Stripping the
`appointment-` prefix only works for 6 of the 21 psychologist pages checked on 2026-10-13; the
rest have a different slug on the FE (`appointment-psikolog-agitya-yanifa` →
`/psikolog-agitya-yanifa` is still 404). So one pattern rule cannot fix them. Most need a
per-URL rule.

The product wants a **super-admin-only setting** to create redirect rules from the dashboard,
as flexible as is safe.

## Decisions (made by the user, 2026-10-13)

| # | Question | Decision |
|---|---|---|
| 1 | Matching | Exact paths, plus a single `*` wildcard (`/appointment-*` → `/*`). No user-written regex |
| 2 | Scope | Rules fire **only for URLs that would otherwise 404**. A live page can never be shadowed |
| 3 | Destination | An internal path or an external `http`/`https` URL |
| 4 | Status code | Chosen per rule, 302 or 301. Default **302** |
| 5 | Legacy WP links | Pre-filled by a data migration, mapped to each page's current FE URL. Unmappable ones are listed for the user to decide |

## Approach

The rules are checked in the **404 exception renderer** in `bootstrap/app.php`, next to the
existing 419 handler. This is the one place that sees both kinds of 404:

- a URL that matches no route, and
- `abort(404)` from `BookingController::show` when the `/{tenant}` catch-all receives a slug that
  `resolveTenant()` does not know. `/appointment-azanidianda-com` is this kind, because it fits
  the catch-all's `[a-z0-9-]+` pattern.

Rejected alternatives:

- **Global middleware that inspects 404 responses.** Same result, but it renders the 404 page
  and then throws it away.
- **Rules written into `.htaccess`.** The app would have to write server config on Hostinger,
  and one bad line 500s the whole site.

Requests that do not 404 never touch the rules table.

## Data

New table `redirect_rules` in the FE's own database (the same one that holds
`custom_sessions`, `feature_requests` and so on):

| Column | Type | Notes |
|---|---|---|
| `id` | bigint PK | |
| `source` | string(255), unique | Stored normalized (see Matching) |
| `destination` | string(2048) | Internal path or absolute `http(s)` URL |
| `status_code` | unsigned smallint, default 302 | 301 or 302 only |
| `active` | boolean, default true | |
| `note` | string(255), nullable | Free text for the admin |
| `hits` | unsigned int, default 0 | Shows which old links are still in use |
| `last_hit_at` | timestamp, nullable | |
| `updated_by` | string(255), nullable | Email of the super admin who last saved it |
| `created_at`, `updated_at` | timestamps | |

Model: `App\Models\RedirectRule`.

## Matching — `App\Services\RedirectMatcher`

A pure class. Input: a request path and the active rules. Output: the matching rule and the final
`Location`, or `null`. It has no database or HTTP access, so it is unit-tested directly.

**Normalization**, applied to both the stored `source` and the incoming path:

- percent-decoded, lowercased;
- a trailing `/` removed (except for `/` itself);
- must start with `/`.

The incoming query string is not part of matching.

**Wildcard.** A source may hold at most one `*`. It matches **one or more** characters, `/`
included, so `/appointment-*` does not match the bare `/appointment-`. Internally the source is
`preg_quote`d and `\*` becomes a single `(.+)`. There is no other regex syntax, so ReDoS is not
possible. A destination may contain `*` only if its source does; it is replaced by the captured
text.

**Priority** (first match wins):

1. exact rules (no `*`);
2. wildcard rules, longest literal part first (source length minus the `*`);
3. ties broken by lowest `id`.

**Query string.** The visitor's query string is carried over to the destination, so that
`?utm_source=ig` survives:

- if the destination has no `?`, append `?<query>`;
- otherwise append `&<query>`;
- if the destination has a `#fragment`, the query goes in before it.

## The 404 hook

In `bootstrap/app.php`, inside `withExceptions`:

```php
$exceptions->render(function (NotFoundHttpException $e, Request $request) {
    return app(RedirectResolver::class)->redirectFor($request); // RedirectResponse or null
});
```

`App\Services\RedirectResolver` does the following:

1. Return `null` unless the method is GET or HEAD and `! $request->expectsJson()`. POSTs and the
   dashboard's or booking page's `fetch()` calls keep their normal 404.
2. Load the active rules and run `RedirectMatcher`. No match → `null`.
3. Increment the hit count with a single `UPDATE … SET hits = hits + 1, last_hit_at = now()`.
4. Return `redirect()->away($location, $rule->status_code)`.

Returning `null` lets Laravel render its normal 404.

**Failure.** Steps 2–4 are wrapped in `try/catch (\Throwable)`. A failure is logged as
`logger()->warning('[redirect] …')` and the resolver returns `null`, so a broken rules table
turns into a plain 404, never a 500. If only the hit-count update fails, the redirect still
happens.

**Backend outage.** When the backend API is down, `BookingController::show` answers **503**, not
404, so rules do not fire. That is correct: the hook cannot know whether the slug really is gone.

## Validation on save

**Source:**

- required;
- starts with `/`;
- no `?`, no `#`, no scheme or host;
- at most one `*`;
- unique after normalization.

**System pages.** An exact source that matches a route other than the `/{tenant}` catch-all is
rejected, because the rule could never fire. The check runs
`Route::getRoutes()->match(Request::create($source))`. Example message:
"`/staff/login` adalah halaman sistem; aturan ini tidak akan pernah dipakai."

**Destination:** required, and either:

- an internal path starting with a single `/` (`//host` is rejected), or
- an absolute `http://` or `https://` URL with a host.

Whitespace, control characters and any other scheme (`javascript:`, `data:`, …) are rejected.

**Status code:** 301 or 302.

**Loops:**

- A destination that matches its own rule's source is rejected.
- Chains are followed: starting from the destination, run `RedirectMatcher` over the rule set
  as it would be after the save. Follow internal destinations for up to 5 hops.
- Returning to a path already visited → "loop".
- More than 5 hops → "rantai terlalu panjang".

This is conservative: it does not know whether a page in the middle is live.

## Super admin UI and endpoints

All endpoints are in the existing `staff:any` group. Each controller method rejects any role
other than `super` with a 403 JSON response, following `LogViewerController`; hiding the menu
alone is not enough. The routes are declared **before** the
`DELETE /dashboard/{resource}/{id}` and `PATCH /dashboard/{resource}/{id}/status` catch-alls.
`{id}` uses `whereNumber`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/dashboard/redirect` | List all rules (JSON) |
| POST | `/dashboard/redirect` | Create |
| PUT | `/dashboard/redirect/{id}` | Update; also used for the active toggle |
| DELETE | `/dashboard/redirect/{id}` | Delete |
| GET | `/dashboard/redirect/uji?path=` | Test a URL |

Controller: `App\Http\Controllers\RedirectRuleController`. Validation messages are in Indonesian,
like the rest of the dashboard.

**Test a URL ("Uji URL")** reports what a visitor would really get, not just what the matcher
says:

- `halaman hidup` — the path matches a non-catch-all route, or `resolveTenant()` knows the slug.
  Rules are not used here.
- `dialihkan` — no live page, and rule #id redirects it to `<location>` with code `<code>`.
- `404` — no live page and no rule.
- `tidak bisa dicek` — the backend errored while resolving the tenant.

**Dashboard** (`resources/views/dashboard.blade.php`, Alpine, same patterns as "Log sistem"):

- A new **Redirect** menu item, shown only when `role === 'super'`.
- A table of rules: source, destination, code, active toggle, hits, last used, note, and
  edit/delete actions.
- An add/edit modal with a 301/302 select (302 preselected) and a short explanation:
  "302 = sementara (disarankan), 301 = permanen dan disimpan browser".
- The "Uji URL" box above the table.

## Legacy WordPress links — data migration

The rows are inserted by a **migration**, not a seeder, because the FE deploy
(`.github/workflows/deploy.yml`) runs `migrate --force` and never runs seeders.

- File: `database/migrations/2026_10_13_100001_seed_legacy_wp_redirects.php`.
- Inserts with `insertOrIgnore`, keyed on `source`, so an existing rule is never overwritten.
- `down()` deletes only the sources it inserted.
- Rows use code 302 and the note `Link WordPress lama`.

**Mapping procedure**, done once while implementing:

1. List the WP pages whose slug starts with `appointment-` (public REST API on
   `api-appointment.praktiqu.com`).
2. Read `data-doctor-id` and `data-clinic-id` from each page's rendered KiviCare widget. For
   example, `appointment-psikolog-agitya-yanifa` has `data-doctor-id="170"` and
   `data-clinic-id="20"`.
3. Find that professional (or clinic, when there is no doctor id) in the backend's public API and
   build the FE slug the same way `BookingApi::resolveTenant()` does.
4. Verify that `GET https://appointment.praktiqu.com/<slug>` answers 200 before adding the row.

Pages that cannot be mapped are left out of the migration and listed for the user to decide.
This covers inactive psychologists, the generic `appointment-nama-professional` and
`appointment-oktober-sehat-mental`, and `appointment`, `appointment-2`, `appointment-4`.

**Known limitation:** FE slugs come from `fullName` and are not stored. If a psychologist is
renamed, a rule's destination breaks, just as their own personal link does. Numeric ids cannot be
used as destinations instead, because `/25` resolves to practice 25 before professional 25.

## Testing (PHPUnit, in-memory SQLite)

**`tests/Unit/RedirectMatcherTest.php`:**

- exact match;
- case-insensitive match, and trailing slash ignored;
- wildcard capture copied into the destination;
- the wildcard needs at least one character;
- exact beats wildcard, and the longer literal beats the shorter;
- the query string is carried over, both with and without an existing `?`, and placed before a
  `#fragment`;
- an external destination.

Inactive rules are filtered before the matcher, so they are covered in the feature tests.

**`tests/Feature/RedirectRuleTest.php`:**

- A 404 slug with a rule is redirected with its code, and `hits` goes up.
- A live tenant page with a rule for the same path is **not** redirected (backend faked with
  `Http::fake`).
- POST and `Accept: application/json` requests to a ruled path still get 404.
- An inactive rule is ignored.
- A rules table that throws gives a 404, not a 500.
- Endpoints: `admin` and `psikolog` sessions get 403, and `super` can do the full CRUD.
- Validation:
  - `javascript:` and `//evil.com` destinations;
  - two `*` in a source;
  - a self-loop and an A→B→A chain;
  - a system-page source (`/staff/login`);
  - a duplicate source differing only by case.
- "Uji URL" returns `halaman hidup`, `dialihkan` and `404` correctly.
- The legacy migration inserts its rows and does not overwrite an existing source.

## Delivery

- A branch in `/home/ahmad/projects/praktiqu-fe` (not the scratchpad), pushed to
  `raakanaka/laravel-praktiqu` as soon as its tests pass.
- The PR is opened by the user (no `gh` on this machine). Merging to `main` auto-deploys
  `appointment.praktiqu.com`, so the user or Rafiq merges.
- Commits are kept separate: table and matcher, the 404 hook, the endpoints, the dashboard UI,
  and the legacy data migration.

## Out of scope

- Regex rules, and rules that override live pages (decisions 1 and 2).
- Bulk CSV import or export of rules.
- Per-rule start and end dates.
- Redirects for any domain other than the FE's own.
