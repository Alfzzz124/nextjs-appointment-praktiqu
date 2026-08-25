# Encounter documents — staging deploy

Two artifacts, in this order: the plugin, then the app. The plugin is additive —
staging keeps working without it — while the app's new routes are useless until the
plugin exists. Deploy the plugin, verify it standalone, then deploy the app.

`prisma generate` is **not** required for this change: `schema.prisma` is untouched
by encounter documents. Do not skip this check out of habit, though — the last deploy
in this repo that skipped `prisma generate` broke in production because a model
actually *had* changed and the generated client went stale. See
`docs/deploy/encounter-E1-staging-deploy.md` for that history before assuming "no
migration" means "no Prisma step" on some future deploy. This one genuinely needs
neither `db push`/`migrate` (`DATABASE_URL` is the WordPress database, never touch it
with a migration tool) nor `generate` (nothing in `schema.prisma` moved).

No new environment variables. `WP_ENDPOINT` and `WORDPRESS_SERVICE_TOKEN` already
exist on staging for the upload path and are reused as-is for every route below.
Staging environment variables live in **cPanel**, not `.htaccess` — editing
`.htaccess` does nothing and has cost time before.

**Also riding this deploy: an unrelated auth fix.** `withAuth` was passing Next's
whole `{ params }` context object through as `params`, so every dynamic `[id]` route
read `params.id` as `undefined` and computed `NaN` — 39 authenticated endpoints
affected, not just this feature's. After this deploy those routes start returning
real rows instead of empty/error responses. That is the intended fix, but it is a
behaviour change well beyond encounter documents, so before calling the deploy done,
spot-check a few unrelated `[id]` endpoints that previously looked "empty" — e.g. a
bill, a professional, a followup — rather than assuming only the document routes
changed behaviour.

## 0. Back up the plugin

    cd ~ && cp -a appointment.praktiqu.com/wp-content/mu-plugins/praktiqu-endpoint \
                  praktiqu-endpoint.bak-$(date +%F-%H%M)

The plugin is an mu-plugin: it activates the instant files land in `mu-plugins`,
with no enable step and no staging area of its own. That is why linting happens in a
scratch directory first (step 1), never in place.

## 1. Plugin

Upload `praktiqu-endpoint.tar.gz` to `~/` (cPanel File Manager or scp), then:

    cd ~ && rm -rf pe-staging && mkdir pe-staging && tar xzf praktiqu-endpoint.tar.gz -C pe-staging

### 1a. Lint before it goes anywhere near `mu-plugins`

A fatal in an mu-plugin takes down the whole WordPress site, including the live
booking form — there is no way to "roll it back" faster than the next request. Lint
every file first:

    for f in $(find ~/pe-staging -name '*.php'); do /usr/local/bin/php -l "$f"; done

Every line must read `No syntax errors detected`. If the box's PHP binary is at a
different path, find it with `which php` or check cPanel's PHP Selector first —
don't skip the check because a container already passed it (see below).

**This has already been linted once, but not on this box.** `php -l` ran clean
against all 16 plugin files in a `php:8.2-cli` container — zero syntax errors — but
never against the staging box's own PHP version, which may not be 8.2. Re-run it here
regardless of that earlier result.

If you need to repeat that container lint (e.g. the box's `php` binary is missing or
broken and you want a second opinion before touching `mu-plugins` at all), two traps
on this machine will burn time if you don't know about them:

- **Bind mounts from a WSL path come up empty.** `-v "$PWD":/app` inside a container
  started from a WSL filesystem path yields zero files — don't spend time debugging
  the plugin when the mount itself is the problem.
- **The credential helper is broken.** `docker pull` fails with
  `docker-credential-desktop.exe: exec format error` until `DOCKER_CONFIG` points at
  a directory whose `config.json` is `{}`.

The working recipe pipes a tar over stdin instead of mounting:

    tar cf - Wordpress-Plugin/praktiqu-endpoint | DOCKER_CONFIG=<dir> docker run --rm -i php:8.2-cli sh -c 'mkdir -p /src && tar xf - -C /src && cd /src && find . -name "*.php" -print0 | xargs -0 -n1 php -l'

(`<dir>` is any directory containing a `config.json` of `{}`.) This proves the code
parses under 8.2; it does not replace the on-box lint above, which is the one that
matters for this deploy.

### 1b. Swap it in

    cd ~/appointment.praktiqu.com/wp-content/mu-plugins \
      && rm -rf praktiqu-endpoint \
      && mv ~/pe-staging/praktiqu-endpoint . \
      && ls praktiqu-endpoint/includes | wc -l   # expect 16

### 1c. Smoke test the plugin routes

Health check, and confirm the site is still alive at all:

    curl -s -o /dev/null -w '%{http_code}\n' https://appointment.praktiqu.com/wp-json/praktiqu/v1/health

Expect `200`. If this is not `200`, stop — do not proceed to the app deploy — restore
from the step-0 backup and investigate before touching anything else.

Media streaming route — pick an attachment id on the box:

    SELECT ID FROM wp_posts WHERE post_type='attachment' LIMIT 1;

Then:

    curl -sS -o /tmp/probe.bin -D /tmp/probe.hdr \
      -H "X-PraktiQU-Service-Token: $WORDPRESS_SERVICE_TOKEN" \
      "https://appointment.praktiqu.com/wp-json/praktiqu/v1/media/<id>"

Expect in `/tmp/probe.hdr`: `HTTP/… 200`, a `Content-Type` matching the attachment,
and `X-Content-Type-Options: nosniff`. Expect `/tmp/probe.bin` to open in a viewer. A
zero-byte file, or one that starts with `{`, means the headers were sent after output
had already begun — treat that as a plugin bug, not a fluke, and do not proceed.

Without the token, the same URL must answer `401`:

    curl -sS -o /dev/null -w '%{http_code}\n' \
      "https://appointment.praktiqu.com/wp-json/praktiqu/v1/media/<id>"

If this is `200`, stop. The service-token guard is not wired and the media endpoint
is open to the internet — do not deploy the app on top of that.

## 2. App

Deploy the built `.next` as usual and restart Passenger. No environment variable
changes are needed — see the note at the top.

    cloudlinux-selector restart --json --interpreter nodejs --user praktiqu \
      --app-root /home/praktiqu/staging2.praktiqu.com

The first request after a restart can still 500 from a worker that has not respawned
yet. Retry once before treating a first-hit 500 as real.

## 3. Verify end to end

With a PROFESSIONAL token, against an encounter that has at least one appointment
with attachments and at least one archived report:

    GET /api/v1/encounters/{id}/documents

Expect a `200` with both `sessionDocuments` and `patientDocuments` present in the
response body — not just one of the two.

Then, for one item from each section, fetch its content and confirm bytes come back,
not JSON:

    GET /api/v1/sessions/{id}/attachments/{mediaId}/content
    GET /api/v1/patient-medical-reports/{id}/content

Rename check — pick one `patientDocuments` item:

    PATCH /api/v1/patient-medical-reports/{id}
    { "title": "smoke test rename" }

Expect `200` and the new title reflected back on a subsequent
`GET /api/v1/encounters/{id}/documents`.

Upload check, staff token only:

    POST /api/v1/encounters/{id}/documents   (multipart)

Expect `201` and the new file to appear in `patientDocuments` on the next list call.
Repeat with a CLIENT token and confirm `403` — this route is staff-only.

`file` endpoint shape change — this used to return a WordPress URL directly usable in
a browser; it no longer does:

    GET /api/v1/patient-medical-reports/{id}/file

Expect the response body to carry a `contentPath` field, not a `url`/`previewUrl`
field pointing at WordPress. Anything downstream still expecting the old shape (a
raw WordPress link) will break here — that is intended; `docs/api/openapi.yaml`
already documents the new shape if a client of this endpoint needs updating.

Deleted endpoint — confirm it is actually gone rather than assuming the code review
caught every reference:

    GET /api/v1/patient-medical-reports/{id}/preview

Expect `404`. A `200` here means an old route survived the deploy (stale `.next`
artifact, or a caching layer serving the previous build) — do not sign off until this
is a clean `404`.

### 3a. The negative case — the one that actually matters

Take a `mediaId` that belongs to a booking attachment on one session, and request it
under a **different** session id:

    GET /api/v1/sessions/{otherSessionId}/attachments/{mediaId}/content

Expect `404`.

This is the single most important check in this runbook. A `200` here means the
ownership guard between session and attachment is not actually wired on staging's
data, and any authenticated clinician could read another patient's documents by
incrementing an integer in the URL. There is an automated test for this wiring
already (`attachmentBelongsToAppointment`, exercised in the encounter-documents test
suite), but that runs against test fixtures — this check is what proves the guard
holds against the real staging database and the real plugin response, where a typo
in a table join or a stale row could slip past a unit test's mocks. Do not skip it
because "the tests passed."

### 3b. Spot-check the unrelated `withAuth` fix

Pick two or three dynamic `[id]` endpoints outside this feature that were previously
returning empty results or silent failures due to the `params`/`NaN` bug — a bill, a
professional, a followup are good candidates — and confirm they now return real data
for a known-good id, and a normal `404` (not another `NaN`-shaped error) for an id
that does not exist. This bug touched 39 endpoints; this feature's own routes are not
enough evidence that the fix is safe everywhere else.

## 4. Rollback

If step 1c's smoke tests fail, restore the plugin backup before doing anything else:

    cd ~/appointment.praktiqu.com/wp-content/mu-plugins \
      && rm -rf praktiqu-endpoint \
      && cp -a ~/praktiqu-endpoint.bak-<timestamp> praktiqu-endpoint

If step 3's app checks fail after the app is live, restore the previous `.next`
build and restart Passenger; the plugin can stay deployed either way since it is
additive and does not depend on the app being current.

## 5. Known gaps left standing

- `uploads/kivicare-uploads/` is still world-readable. Nothing in this feature writes
  there, but the `custom-field` upload context does, and that exposure predates and
  outlives this deploy. Its own fix, not blocking this one.
- `medReportScopeFor` still scopes a PROFESSIONAL clinic-wide rather than to their own
  patients, unlike `encounterScopeFor` and the session guard, which are both
  patient/owner-scoped. This is design decision D7 in
  `docs/superpowers/specs/2026-08-24-encounter-documents-design.md` — deliberately
  inherited from existing behaviour, not introduced by this feature, and its own
  change when someone decides to tighten it.
- Three further tenancy gaps found in pre-merge re-review of this branch's `withAuth`
  fix were deliberately left unfixed: `GET /api/v1/practices` (list) has no clinic
  filter, so a CLINIC_ADMIN can enumerate every clinic; `POST /api/v1/taxes` is
  entirely unscoped and can create a cross-tenant or global tax; and global tax rows
  (`clinic_id` `-1`/`null`) are writable and deletable by any clinic admin, not just
  readable. Detail and mitigating context are in the "Open questions" section of
  `docs/superpowers/specs/2026-08-24-encounter-documents-design.md`.
