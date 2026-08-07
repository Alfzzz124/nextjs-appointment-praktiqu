# Staging deploy — public self-registration

One artifact: the Next.js build. **No plugin change and no `schema.prisma` change**, so
neither the mu-plugin swap nor `prisma generate` from the E1 runbook applies here.

The WordPress side already has everything this needs: `POST /praktiqu/v1/patients` and the
`username` field in its response both landed in `e9fe5df`, the commit that created the patient
write endpoints. Any staging plugin new enough to have `/patients` at all is new enough for this.

Artifact: `.deploy-artifacts/next-build.tar.gz`
sha256 `ced7d598b8a920d3f1abe093c26cb01187bed198bfc2f5224497ccf625088028`
Built with `NEXT_PUBLIC_APP_URL=https://staging2.praktiqu.com`.

## 1. Upload

```bash
pscp -P 45022 -i <key.ppk> .deploy-artifacts/next-build.tar.gz praktiqu@101.50.1.106:~/
```

## 2. Swap and restart

```bash
cd ~/staging2.praktiqu.com \
  && mv .next .next.bak-$(date +%F-%H%M) \
  && tar xzf ~/next-build.tar.gz \
  && mkdir -p .next/cache

cloudlinux-selector restart --json --interpreter nodejs --user praktiqu \
  --app-root /home/praktiqu/staging2.praktiqu.com
```

The first request after a restart can still 500 from a worker that has not respawned. Retry
once before believing it.

## 3. Smoke test

Run from the server — the WAF's JS bot-check answers curl from outside.

```bash
curl -s -X POST https://staging2.praktiqu.com/api/v1/public/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"smoke-reg-01@example.com","password":"rahasia123","firstName":"Smoke","lastName":"Test","contactNumber":"081200000001"}'
```

Expect `201` carrying `accessToken`, `refreshToken`, and `user.role: "CLIENT"`.

Then prove the account can actually log in — that is the whole point of routing the write
through the plugin instead of raw SQL:

```bash
curl -s -X POST https://staging2.praktiqu.com/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"smoke-reg-01@example.com","password":"rahasia123"}'
```

Expect `200`. A `401` here means the WordPress row was written without a real password hash —
the receptionist-lockout failure mode — and the deploy should be rolled back.

Re-posting the same registration must answer `409 duplicate_email`.

Clean up — **two databases**, because staging's plugin writes and Prisma reads do not share
one (see the `staging-two-databases-split` note). Prisma's `User` model maps to the table
`users`, not `User`.

```sql
-- praktiqu_wp580 — the WordPress site the plugin writes to
DELETE FROM wp_usermeta WHERE user_id = <WP_ID>;
DELETE FROM wp_users WHERE ID = <WP_ID> AND user_email = 'smoke-reg-01@example.com';

-- praktiqu_wp314 — the app's own database
DELETE FROM refresh_tokens WHERE userId = (SELECT id FROM users WHERE email = 'smoke-reg-01@example.com');
DELETE FROM users WHERE email = 'smoke-reg-01@example.com';
```

`<WP_ID>` is the `user.wpUserId` the registration response returned.

## Known staging limitation

`DATABASE_URL` points at `praktiqu_wp314`, whose `wp_users` is a copy frozen at 2026-07-05,
while `WORDPRESS_URL` points at appointment.praktiqu.com backed by `praktiqu_wp580`. A patient
who self-registers therefore exists in wp580 but not in the `wp_users` the app reads through
Prisma. Registration and login are unaffected — both talk to the plugin over HTTP — but the new
patient will not show up in anything that reads patients from the database, including public
booking's `findPatientByEmail` and staff patient lists. This predates the feature and is an
environment issue, not a code one.

## Rollback

```bash
cd ~/staging2.praktiqu.com && rm -rf .next && mv .next.bak-<STAMP> .next
cloudlinux-selector restart --json --interpreter nodejs --user praktiqu \
  --app-root /home/praktiqu/staging2.praktiqu.com
```

Nothing in this change writes to the database on its own, so a rollback needs no data repair —
only the accounts created by real registrations in between, which are ordinary patients.
