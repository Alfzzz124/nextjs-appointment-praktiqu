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

Clean up — all in `praktiqu_wp580`, the one database staging now uses for both the WordPress
side and the app's own tables. Prisma's `User` model maps to the table `users`, not `User`.

```sql
DELETE FROM refresh_tokens WHERE userId = (SELECT id FROM users WHERE email = 'smoke-reg-01@example.com');
DELETE FROM users WHERE email = 'smoke-reg-01@example.com';
DELETE FROM wp_usermeta WHERE user_id = <WP_ID>;
DELETE FROM wp_users WHERE ID = <WP_ID> AND user_email = 'smoke-reg-01@example.com';
```

`<WP_ID>` is the `user.wpUserId` the registration response returned.

## History: the read/write split, fixed 2026-08-07

The first deploy of this feature ran against a staging where `DATABASE_URL` pointed at
`praktiqu_wp314` — a WordPress copy frozen at 2026-07-05 — while `WORDPRESS_URL` pointed at
appointment.praktiqu.com, backed by `praktiqu_wp580`. Registration and login worked, because both
talk to the plugin over HTTP, but the new patient was written to wp580 and read from wp314, so
nothing that reads patients from the database could see them.

Resolved by creating the one missing table (`payment_orders`) in wp580 and repointing
`DATABASE_URL` there. Nothing was migrated from wp314: `users` rows rebuild from WordPress on
login, and the only other delta was 15 rows in the dead `appointments` shadow table, which no
code writes any more.

## Rollback

```bash
cd ~/staging2.praktiqu.com && rm -rf .next && mv .next.bak-<STAMP> .next
cloudlinux-selector restart --json --interpreter nodejs --user praktiqu \
  --app-root /home/praktiqu/staging2.praktiqu.com
```

Nothing in this change writes to the database on its own, so a rollback needs no data repair —
only the accounts created by real registrations in between, which are ordinary patients.
