# Session reminders — deploy runbook

Covers the WordPress `praktiqu-endpoint` plugin bump (1.6.5 → 1.6.6) and the Next.js half of
the T-24h / T-1h session reminder feature. Consumes all of Tasks 1–8; this task writes no
product code. **Executing any step below is a human decision — this file does not deploy
anything, and nothing here was run against staging.**

**Scope: staging only.** Every hostname, option value, and verification query below targets
`staging2.praktiqu.com` / `appointment.praktiqu.com`. A production run needs its own Jobs
Webhook URL and secret (never copy staging's), its own on-screen version confirmation, and
its own pass through the verification steps below — nothing here should be treated as
validated for production without repeating it there.

Two hosts are involved and they are not the same machine:

- **Next.js app**: `staging2.praktiqu.com`.
- **WordPress**: `appointment.praktiqu.com`, plugin at
  `/home/praktiqu/appointment.praktiqu.com/wp-content/plugins/praktiqu-endpoint`, currently
  **v1.6.5** on the server. This branch takes it to **v1.6.6**.
- SSH to the WordPress box: `ssh -p 45022 -i ~/.ssh/praktiqu_staging praktiqu@101.50.1.106`.

## 1. Deploy order, and why

**Plugin first, Next.js app second.**

Plugin 1.6.6 only sends `session.reminder` when its **Jobs Webhook URL** option is filled in
(see step 2). An empty option means the plugin sends nothing, so deploying it first — before
the option is set, before the app side is even live — is inert. It changes no runtime
behavior on its own.

The reverse order is not safe. If the Next.js app goes out first, it starts calling
`jobs.enqueue()` for every session that becomes BOOKED, scheduling
`praktiqu_session_send_reminder` actions on Action Scheduler. Against the
**still-installed 1.6.5** plugin, that hook fires into a `handle_session_send_reminder()`
body that called a method that does not exist on that version — a fatal error inside the
Action Scheduler run, recorded as a **failed** action. That's a broken window: real
sessions get scheduled into jobs that are guaranteed to blow up, and by the time anyone
notices, backfilling the missed reminders is manual.

So: plugin up first (silent, since the option is still empty), fill in the two options,
confirm the plugin is live and correct, *then* deploy the app.

## 2. Two options to fill in by hand after the plugin deploys

WP Admin → **Settings → PraktiQU Endpoint** → "PraktiQU Jobs Webhook" section
(`options-general.php?page=praktiqu-endpoint`):

| Field | Value |
| --- | --- |
| **Jobs Webhook URL** | `https://staging2.praktiqu.com/api/v1/webhooks/wordpress-jobs` |
| **Jobs Webhook Secret** | the live value of `WORDPRESS_WEBHOOK_SECRET` on the Next.js process (see below) |

Read the secret from the **running process**, not from any `.env` file on the server — the
server's `.env` is not authoritative; the Passenger process gets its real environment from
cPanel, and the two have drifted before.

```bash
ssh -p 45022 praktiqu@101.50.1.106 'PID=$(pgrep -u praktiqu -f staging2.praktiqu.com | head -1); tr "\0" "\n" < /proc/$PID/environ | grep "^WORDPRESS_WEBHOOK_SECRET="'
```

`WORDPRESS_SERVICE_TOKEN` and `WORDPRESS_WEBHOOK_SECRET` are both already populated on the
live Next.js process — this step only needs to read the second one, not set either.

**Open question to settle while you're in there.** An earlier reading of the process
environment showed both `WORDPRESS_WEBHOOK_SECRET` and `WORDPRESS_SERVICE_TOKEN` starting
with the same 6-character prefix — suggestive that they might be the *same* value, but not
proof, and the process could not be re-read afterward to confirm. If they are the same, one
credential is doing two jobs (inbound webhook signing here, outbound service-token auth for
the WordPress REST calls in `src/lib/jobs/client.ts`), and rotating either one breaks both
directions at once. Check without printing either value:

```bash
ssh -p 45022 praktiqu@101.50.1.106 '
  PID=$(pgrep -u praktiqu -f staging2.praktiqu.com | head -1)
  ENV=$(tr "\0" "\n" < /proc/$PID/environ)
  A=$(echo "$ENV" | sed -n "s/^WORDPRESS_WEBHOOK_SECRET=//p" | sha256sum)
  B=$(echo "$ENV" | sed -n "s/^WORDPRESS_SERVICE_TOKEN=//p" | sha256sum)
  [ "$A" = "$B" ] && echo "SAME VALUE" || echo "DIFFERENT VALUES"
'
```

If it prints `SAME VALUE`: treat the two as one credential for planning purposes — a future
rotation of either one must update both the WordPress-side jobs-webhook secret and the
service-token side in the same maintenance window, or one direction breaks silently. If it
prints `DIFFERENT VALUES`, they can be rotated independently as intended — but this is a
live check, not a settled fact, so re-run it after any future rotation rather than assuming
today's answer still holds.

The secret field on the settings page renders **masked**, with an `(unchanged)` placeholder
and an empty `value=""` attribute (`includes/class-praktiqu-endpoint-settings.php`). That is
by design, not a bug: **saving the form again later with the secret field left blank does
not wipe it** — the sanitizer preserves the existing option when the submitted value is the
placeholder. Don't re-type the secret defensively on every settings save; leave it blank
unless you're deliberately rotating it.

Also confirm on the same page that the plugin version shown is **1.6.6** before moving on to
step 3 or deploying the app — deploying the app against a plugin that silently failed to
update is the same broken window described in step 1.

## 3. Verify the job actually gets scheduled

This is real behavior only staging can prove — `jobs.enqueue()` on the Next.js side POSTs to
WordPress and returns `void` either way; nothing in this repo's test suite can see whether a
row actually landed in Action Scheduler.

Schedule one session (staff-created BOOKED, or an approved PENDING one), then query:

```sql
SELECT action_id, hook, status, scheduled_date_gmt, args
  FROM wp_actionscheduler_actions
 WHERE hook = 'praktiqu_session_send_reminder'
 ORDER BY action_id DESC LIMIT 5;
```

Expected: two `pending` rows — one scheduled ~24h before the session start time, one ~1h
before — with `args` containing `sessionId` and `channel`.

Alongside that SQL query, the app now writes an audit event — `session.reminder.scheduled`
— to `LogEntry`, once per successfully enqueued job, carrying the `channel` and `runAt`.
Seeing two of those rows for the session you scheduled is a Next.js-side confirmation that
`enqueue()` at least attempted the call; it doesn't by itself prove the row landed in Action
Scheduler (the SQL query above is still what proves that), but it narrows a "zero rows"
result down to "never tried" vs. "tried, but WordPress rejected or dropped it."

If a reminder instead gets *skipped* once the webhook does arrive, look for a
`session.reminder.skipped` audit row with a `reason`: `status` (session is no longer
`BOOKED`), `sudah_dimulai` (start time already passed), `jadwal_tidak_lengkap` (session is
missing a date or start time), or `waktu_tidak_valid` — new on this branch, for a session
whose stored date/time/timezone no longer resolves to a valid instant (a malformed IANA
timezone, for example).

**If you get zero rows**, `jobs.enqueue()` silently did nothing. The most likely cause is
`WORDPRESS_SERVICE_TOKEN` missing on the Next.js process — `enqueue()` logs
`[jobs] WORDPRESS_SERVICE_TOKEN not set — job not scheduled` and `return`s before making any
HTTP call, so there is no failed request to find, only silence. Re-check the token with the
same `/proc/<pid>/environ` technique as step 2.

## 4. Verify the args arrive in the right order on the PHP side

This is the only way to prove `$session_id` receives the session id and not the channel
string. The wire payload is exactly `{"sessionId":N,"channel":"email_24h"|"email_1h"}` — two
keys, no more. Key **order** is the contract and key names are not:

- Next.js's `jobs.enqueue()` (`src/lib/jobs/client.ts`) sends `args: { sessionId, channel }`
  in that order.
- The plugin's `Jobs::register()` wires the hook with
  `add_action('praktiqu_session_send_reminder', [...], 10, 2)`. Action Scheduler calls the
  hook with `do_action_ref_array($hook, array_values($args))`, so key names are discarded
  entirely and the two values arrive positionally, in insertion order, at
  `handle_session_send_reminder(int $session_id, string $channel)`.

If either side's field order ever drifts, `$session_id` silently receives the channel string
instead of the session id, and nothing before staging would catch it — Task 7 pins the
payload shape on the plugin side and Task 9's own tests pin the key order on the Next.js
side, but only a live run proves the two agree. Separately, `jobs.enqueue()` and
`jobs.cancel()` must build that `args` object identically to each other, because
`as_unschedule_all_actions` matches on the exact serialized `args` string — if they ever
diverge, cancellation silently stops matching the action it's supposed to remove, and that's
the only idempotency mechanism this feature has. `tests/payments/jobs-client.test.ts` now
pins that the two calls serialize identically.

Schedule a job with `runAt` a few minutes in the future, wait for it to fire, then check:

```sql
SELECT * FROM wp_actionscheduler_logs
 WHERE action_id = <the action_id from step 3>
 ORDER BY log_date_gmt DESC;
```

and the Next.js application log for a `session.reminder.sent` audit line (see
`src/lib/logging`) carrying the correct `sessionId`. If the id logged there doesn't match the
session you scheduled, the positional-arg wiring has drifted — stop and do not proceed to
production.

**If the Action Scheduler log shows the action `complete`, but no `session.reminder.sent`
audit row shows up at all — not even for the wrong session — the POST was most likely
rejected before it ever reached the handler.** `Jobs_Webhook::send()` posts with
`'blocking' => false`, so from WordPress's side the action reads `complete` regardless of
what happened to the HTTP request; a rejected POST looks identical to a delivered one on the
WP side, and WordPress logs nothing either way. Check the Next.js access log for
`/api/v1/webhooks/wordpress-jobs` instead:

- **401** — the two secrets disagree: `praktiqu_endpoint_jobs_webhook_secret` on WordPress
  and `WORDPRESS_WEBHOOK_SECRET` on the Next.js process are not the same value.
- **403 or 415** — the request was rejected before reaching the route, most likely the
  staging WAF; this project has already hit a WAF edge block returning 415 on other JSON
  POSTs (see `docs/handover/2026-07-13-public-endpoints-deploy-and-postman.md`, "known
  hammering→415 edge block").

**Rotation note.** The jobs-webhook signing secret has two homes — the
`praktiqu_endpoint_jobs_webhook_secret` WordPress option and `WORDPRESS_WEBHOOK_SECRET` on
the Next.js process. Both must change together in the same maintenance window; changing one
without the other reproduces exactly the silent-401 failure mode above, and — because of the
`blocking => false` behavior — neither side will show an obvious error telling you why.

## 5. Known state: `session.auto_complete` fails quietly, not loudly

Before this branch, `handle_session_auto_complete()` called a plugin method that did not
exist, so the Action Scheduler action **fataled and was marked `failed`** — loud, visible in
`wp_actionscheduler_actions`.

Task 8 fixed the ghost-method call: the handler now calls `$this->jobs_webhook->send(...)`
correctly, which POSTs to the Next.js webhook and gets a real `200 OK` back. But
`processWebhook()` (`src/lib/jobs/webhook-handler.ts`) dispatches by event name against a
map of registered handlers, and **no handler is registered for `session.auto_complete`** —
only `session.reminder` is (via `src/services/session/reminder-handler.ts`, imported for its
side effect in the webhook route). The dispatcher's fallback for an unregistered event is to
log a warning (`No handler registered for webhook event: session.auto_complete`) and still
return `true` → the route answers `200 OK`.

So the failure mode changed shape: **loud failure → quiet success.** Nothing in this feature
enqueues `praktiqu_session_auto_complete` today, so in practice both states are currently
invisible — there's nothing scheduled to fail or silently no-op. This is a known state, not
a step to perform: whoever later wires up the enqueue side for session auto-completion needs
to know that sessions will not auto-complete on their own yet, and — unlike the old
behavior — there will be no failed Action Scheduler row pointing at why. It will look like
nothing is wrong, right up until someone asks why a session that ended days ago is still
open.

## 6. Rollback

App down first, then plugin — the reverse of the deploy order, for the same reason.

Before rolling back, **empty the Jobs Webhook URL option** so the still-installed 1.6.6
plugin doesn't fire callbacks against a Next.js app that's already gone (or, worse, isn't
gone yet but is mid-rollback and inconsistent). The URL field genuinely clears — its
sanitizer is plain `esc_url_raw`, with no placeholder-preserving behavior. **The secret
field does not clear the same way**: `sanitize_jobs_secret()` treats a blank submission as
"leave the stored value alone" (the same placeholder-preserving behavior as the other two
webhook secrets on this settings page), so submitting the form with the secret left blank
will *not* wipe `praktiqu_endpoint_jobs_webhook_secret`. Don't rely on blanking the secret
field to disable anything — the URL field is what actually turns the callback off.

**Cancel whatever reminder/auto-complete jobs are left pending next, before touching the
plugin version** — not after. A reminder that fires in the gap between downgrading the
plugin and cancelling its pending jobs hits 1.6.5's ghost `Service::send_webhook()` call and
fatals, which is exactly the broken-window scenario the deploy order in §1 exists to avoid;
doing this step after the downgrade instead of before reintroduces that same window during
rollback.

```sql
UPDATE wp_actionscheduler_actions
   SET status = 'canceled'
 WHERE hook IN ('praktiqu_session_send_reminder', 'praktiqu_session_auto_complete')
   AND status = 'pending';
```

This uses raw SQL rather than `wp action-scheduler cancel` / `as_unschedule_all_actions`
because wp-cli is not usable on this host (see the staging-ssh memory notes) — there's no
CLI shortcut to reach for here, so don't spend time looking for one.

Only once the pending jobs are cancelled: roll back the app, then downgrade the plugin to
1.6.5.

## What this does not cover

Two things in this feature can only be proven by a live run against staging, and neither has
been run as part of this task:

1. **That a job enqueued by the Next.js app actually reaches Action Scheduler.** Step 3
   above is how to check it — a real row in `wp_actionscheduler_actions`. This has not been
   executed; do not treat the unit/integration test suite's green result as proof of this.
2. **That the args arrive in the correct positional order on the PHP side** — that
   `$session_id` really receives the session id and not the channel string once the two
   independently-tested sides (Next.js's key order, the plugin's payload shape and arg
   count) meet for real. Step 4 above is how to check it. This has not been executed either.

Both are staging-only verifications by nature (Action Scheduler and WP-Cron don't run in
this repo's test environment) — they are listed here as open, not as done.

## Final green gate (this task)

Run from the repo root unless noted:

```bash
npm test
npx tsc --noEmit
```

```bash
cd Wordpress-Plugin/praktiqu-endpoint
docker run --rm -v "$(pwd)":/p -w /p php:8.3-cli sh -c '
  for f in praktiqu-endpoint.php uninstall.php includes/*.php; do php -l "$f" || exit 1; done
  for t in tests/*.php; do echo -n "$t -> "; php "$t" | tail -1; done
'
```

Last run for this task: `npm test` — 156 files / 1532 tests, zero failures. `tsc --noEmit` —
clean. PHP — all files lint clean, and all three harnesses (`test-jobs-secret-sanitizer.php`,
`test-jobs-webhook.php`, `test-money.php`) print `ALL PASS`. See the Task 9 report for the
verbatim output.
