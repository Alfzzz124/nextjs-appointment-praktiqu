# Deployment — terpadu.praktiqu.com

Auto-deploy runs on every push to `main` via `.github/workflows/deploy.yml`.
You can also trigger it manually from the Actions tab ("Run workflow").

## How it works

The host is Hostinger shared hosting. It has PHP 8.0–8.5, Composer and git,
but **no Node**, so the frontend is built on the GitHub runner and shipped
as part of the payload.

1. Runner checks out `main`, installs PHP 8.4 and Node 22.
2. `composer install --no-dev --optimize-autoloader` and `npm run build`.
3. `rsync` the whole workspace over SSH into the app directory.
4. Over SSH: `migrate --force`, `storage:link`, then config/route/view/event
   caching, and `queue:restart`.
5. Curls `https://terpadu.praktiqu.com` and fails the run on a 4xx/5xx.

The site is put into maintenance mode for step 4. A `trap ... EXIT` runs
`artisan up` no matter how the script ends, so a failed migration can't leave
the site down.

## Server layout

```
/home/u615745027/domains/terpadu.praktiqu.com/
├── app/                     <- Laravel root (rsync target)
│   ├── .env                 <- server-owned, never overwritten
│   ├── database/database.sqlite
│   └── storage/             <- server-owned, never overwritten
├── public_html -> app/public
└── public_html.default.bak  <- Hostinger's original placeholder
```

`public_html` is a symlink into `app/public`, so the Laravel internals are
never exposed under the document root.

## What deploys and what doesn't

`rsync --delete` keeps the server identical to the build output, so anything
uploaded to `app/` by hand gets removed on the next deploy. These paths are
excluded and therefore safe:

- `/.env`
- `/storage/` (logs, sessions, cached views, uploaded files)
- `/database/*.sqlite`
- `/public/storage` (the storage symlink)

`vendor/` and `public/build/` are gitignored locally but **are** deployed —
they're produced on the runner.

## Secrets

Set as repository secrets (Settings → Secrets and variables → Actions):

| Secret | Value |
| --- | --- |
| `SSH_HOST` | `46.202.186.49` |
| `SSH_PORT` | `65002` |
| `SSH_USER` | `u615745027` |
| `SSH_PASSWORD` | the hosting SSH password |

Host, port, user and the deploy path are not secret in themselves, but keeping
them out of the YAML means the workflow file stays safe to share.

### Rotating the SSH password

Change it in hPanel, then:

```bash
gh secret set SSH_PASSWORD -R raakanaka/laravel-praktiqu
```

### Moving to key auth (recommended later)

Password auth needs `sshpass`, which the workflow installs on each run. To use
a key instead: generate a dedicated keypair, append the public key to
`~/.ssh/authorized_keys` on the host, store the private key as `SSH_KEY`, and
replace the `sshpass -e` prefixes with a `ssh-agent` setup step.

## Editing the production .env

```bash
ssh -p 65002 u615745027@46.202.186.49
cd ~/domains/terpadu.praktiqu.com/app
nano .env
/opt/alt/php84/usr/bin/php artisan config:cache
```

`config:cache` is required — with a cached config, edits to `.env` are ignored
until the cache is rebuilt.

## PHP version — important

Although `composer.json` says `php: ^8.3`, the locked Symfony 8 packages
require **>= 8.4.1**, so the app will not boot on anything lower. Composer
enforces this in `vendor/composer/platform_check.php`, which is why a wrong
version produces a bare HTTP 500 with nothing in `storage/logs`.

Two places have to be on 8.4:

- **CLI** (migrations, caching) — the account default is 8.2, so the workflow
  calls `/opt/alt/php84/usr/bin/php` explicitly via the `REMOTE_PHP` env var.
- **Web requests** — the domain was serving 8.3, so `public/.htaccess` pins the
  handler with `AddHandler application/x-httpd-alt-php84___lsphp .php`.

The `.htaccess` pin is committed to the repo, so it survives `rsync --delete`.
Setting the domain to PHP 8.4 in hPanel as well is worthwhile — then the pin
is merely redundant rather than load-bearing.

## Notes

- The DB is SQLite at `app/database/database.sqlite`. It is never overwritten
  by a deploy. Back it up before destructive migrations.
- Concurrency is capped at one deploy at a time; overlapping pushes queue.
