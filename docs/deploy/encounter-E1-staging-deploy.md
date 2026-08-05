# E1 staging deploy — encounter write routes

Two artifacts, deployed in this order. The plugin first: it is additive, so the app
keeps working without it, while the app's new code is useless until the routes exist.

**`prisma generate` IS required — read this before skipping it.**

That was true when this runbook covered E1 alone. It is false for the deploy that
actually shipped, which carries all of Phase 3 as well. `schema.prisma` gained
`KcStaticData` (and lost `Client`), and an **added** model is exactly what broke the
payment deploy: the generated client lives in the nodevenv's `node_modules`, ships in
neither the `.next` tarball nor the plugin, so `prisma.kcStaticData` is `undefined` at
runtime and `/api/v1/public/static-data` answers an opaque 500 while every pre-existing
model keeps working.

So section 2 must also copy `prisma/schema.prisma` up and regenerate. Removing a model
is harmless by comparison — nothing references `prisma.client` any more — but
regenerating covers both directions, and it is idempotent, so run it whenever
`schema.prisma` differs at all rather than trying to judge which direction it moved.

**Do NOT run `prisma/manual/2026-07-27-drop-clients-shadow-table.sql` on staging.**
The shadow tables stay standing until staging is verified working — the user's explicit
call. A leftover `clients` table costs disk and nothing else, since no code reads it.

## 0. Before anything

```bash
cd ~ && cp -a appointment.praktiqu.com/wp-content/mu-plugins/praktiqu-endpoint \
              praktiqu-endpoint.bak-$(date +%F-%H%M)
```

The plugin is an **mu-plugin**: it activates the instant files land in place. There is
no enable step and no staging area — which is why it gets linted in a temp directory
first, below.

## 1. Plugin

Upload `praktiqu-endpoint.tar.gz` to `~/` (cPanel File Manager, or scp), then:

```bash
cd ~ && rm -rf pe-staging && mkdir pe-staging && tar xzf praktiqu-endpoint.tar.gz -C pe-staging
```

Lint **before** it goes anywhere near `mu-plugins`:

```bash
for f in $(find ~/pe-staging -name '*.php'); do /usr/local/bin/php -l "$f"; done
```

Every line must read `No syntax errors detected`. If any file fails, stop — a fatal in
an mu-plugin takes down the whole WordPress site, including the live booking form.

Then swap it in:

```bash
cd ~/appointment.praktiqu.com/wp-content/mu-plugins \
  && rm -rf praktiqu-endpoint \
  && mv ~/pe-staging/praktiqu-endpoint . \
  && ls praktiqu-endpoint/includes | wc -l   # expect 14
```

Confirm the plugin still boots and the new routes are registered:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://appointment.praktiqu.com/wp-json/praktiqu/v1/health
curl -s https://appointment.praktiqu.com/wp-json/praktiqu/v1 | tr ',' '\n' | grep -c encounters
```

The second should be non-zero. A 401/403 on the encounter routes themselves is the
correct answer without a service token — it proves the route exists and the guard works.

## 2. Next.js app

Upload `next-build.tar.gz` to `~/`, then:

```bash
cd ~/staging2.praktiqu.com \
  && mv .next .next.bak-$(date +%F-%H%M) \
  && tar xzf ~/next-build.tar.gz \
  && mkdir -p .next/cache
```

Then the Prisma client, **before** the restart — see the warning at the top:

```bash
# schema.prisma must already be uploaded to ~/staging2.praktiqu.com/prisma/
source /home/praktiqu/nodevenv/staging2.praktiqu.com/20/bin/activate \
  && cd ~/staging2.praktiqu.com \
  && ./node_modules/.bin/prisma generate
```

Restart Passenger:

```bash
cloudlinux-selector restart --json --interpreter nodejs --user praktiqu \
  --app-root /home/praktiqu/staging2.praktiqu.com
```

The first request after a restart can still 500 from a worker that has not respawned.
Retry once before believing it.

## 3. Smoke test

The health check only proves the plugin boots. What matters here is that an encounter
can be created and closed, and that closing notifies.

```bash
# from the server, so the WAF's per-IP rate limit is not in play
TOKEN=$(grep -oP "define\(\s*'PRAKTIQU_SERVICE_TOKEN'\s*,\s*'\K[^']+" \
        ~/appointment.praktiqu.com/wp-config.php)

curl -s -X POST https://appointment.praktiqu.com/wp-json/praktiqu/v1/encounters \
  -H "X-PraktiQU-Service-Token: $TOKEN" -H 'Content-Type: application/json' \
  -d '{"clinic_id":1,"doctor_id":1,"patient_id":1,"appointment_id":0,"description":"smoke test"}'
```

Expect `201` and an `id`. Then close it:

```bash
curl -s -X POST https://appointment.praktiqu.com/wp-json/praktiqu/v1/encounters/<ID>/status \
  -H "X-PraktiQU-Service-Token: $TOKEN" -H 'Content-Type: application/json' \
  -d '{"status":0}'
```

Expect `{"id":…,"status":0,"closed":true,"notified":false}`. **`notified: false` is
correct here** — the test encounter has `appointment_id: 0`, and the notification
listener resolves the patient through the appointment. To exercise the email path, use
a real appointment id and expect `notified: true`.

Clean up the smoke-test row afterwards:

```sql
DELETE FROM wp_kc_patient_encounters WHERE description = 'smoke test';
```

## Rollback

```bash
cd ~/appointment.praktiqu.com/wp-content/mu-plugins \
  && rm -rf praktiqu-endpoint && mv ~/praktiqu-endpoint.bak-<STAMP> praktiqu-endpoint
cd ~/staging2.praktiqu.com && rm -rf .next && mv .next.bak-<STAMP> .next
cloudlinux-selector restart --json --interpreter nodejs --user praktiqu \
  --app-root /home/praktiqu/staging2.praktiqu.com
```

The plugin is additive — rolling it back only removes the new routes, and the app falls
back to failing those calls rather than corrupting anything.
