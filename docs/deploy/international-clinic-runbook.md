# International Clinic Payment — Deployment Runbook

**Spec:** `docs/superpowers/specs/2026-10-06-international-clinic-payment-design.md` (§8 Rollout)
**Ships:** plugin `praktiqu-endpoint` 1.7.0 → Next.js API → Laravel FE PR `feat/klinik-internasional`
**FE contract:** `docs/api/PAYMENT-METHODS-GUIDE.md`, `docs/api/PRACTICES-AND-SERVICES-GUIDE.md` §4.16

## Before you start

- **Run every step with the user present.** Ask before every database query, including the
  read-only ones below. Never run `prisma db push` / `prisma migrate`: `DATABASE_URL` is the
  WordPress database. This release adds no table, no column and no Prisma change.
- **The International flag is now the safety switch.** Until now PayPal was kept shut by
  leaving the global rate empty. That no longer protects a flagged clinic: a clinic with its
  own rate takes real money the moment it is flagged, if PPCP is live.
- Never paste the service token, `PAYMENT_WEBHOOK_SECRET` or any password into this file, a
  commit or a chat. The commands below read them on the server at run time.

| Component | Where |
| --- | --- |
| WordPress + `praktiqu-endpoint` + WooCommerce/PPCP | Hostinger: `ssh praktiqu-hostinger` (use `-o ConnectTimeout=40`), `~/domains/api-appointment.praktiqu.com/public_html`, plugin in `wp-content/plugins/praktiqu-endpoint/`, table prefix `wp_`. `php` is on PATH; `wp-cli` is not used. |
| Next.js API | Hostinger Node.js app `endpoint.praktiqu.com` (hPanel Git build): `~/domains/endpoint.praktiqu.com/hbuilds/current`, log `hbuilds/current/nodejs/console.log`, env `hbuilds/config/.env` |
| Laravel FE | `terpadu.praktiqu.com`, auto-deployed from `main` of `raakanaka/laravel-praktiqu` |

The Hostinger clock is UTC. Curl from outside hits a JS bot-check WAF, so run the HTTP checks
from the server itself.

## 1. Pre-deploy checks (read-only)

Ask the user before each query.

1. **Which WordPress does the app call?** The app's `WORDPRESS_URL` must be
   `https://api-appointment.praktiqu.com` (Hostinger). The plugin goes to that install; a
   plugin deployed to the WordPress the app does not call changes nothing.
2. **PPCP mode.** wp-admin → WooCommerce → Settings → Payments → PayPal → connection tab: write
   down **Live** or **Sandbox**. If it is Live, no clinic may be flagged until §3 step 1 has
   switched PPCP to sandbox (real clinics are flagged only in §4, after it is back on Live).
3. **WooCommerce tax calculation is OFF.** wp-admin → WooCommerce → Settings → General:
   **"Enable tax rates and calculations" must be unchecked.** If it is on, WooCommerce adds its
   own tax in `calculate_totals()`, the order total no longer equals `charge.total`, and plugin
   1.7.0 cancels every USD order with 502 `charge_mismatch`. That fails closed, but it makes
   PayPal and card unusable. If it is on, stop and decide with the user before deploying.
4. **Global rate and markup:**

   ```sql
   SELECT option_name, option_value FROM wp_options
   WHERE option_name IN ('praktiqu_endpoint_paypal_idr_rate', 'praktiqu_endpoint_paypal_markup_percent');
   ```

   Each must be empty or plain digits with at most 2 decimals: the rate within 1,000–100,000
   (rupiah per 1 USD), the markup within 0–100. Anything else is unusable, and Next.js never
   reads a value that is set but unusable as "not set". It is logged either way, but it shows
   up in two ways:
   - Text that is not a plain decimal (`1e1`, `.5`, `+10`, `10.`, `16,500`) appears in the
     settings view as `globalDefaults.invalid`.
   - A plain decimal that is out of range or has too many decimals (a rate of `16500.123`, a
     markup of `150`) appears in `globalDefaults` as an ordinary number with no `invalid`
     key; the only sign is that `effective.fxRate` is null for a clinic that depends on it.

   The effect: an unusable global rate is ignored (a flagged clinic without its own rate then
   answers 503 `paypal_rate_missing`), and an unusable global markup voids the rate of every
   flagged clinic that has no markup of its own, even one with its own rate (the same 503).
   The 1.7.0 sanitizer refuses to save such a value, but one written earlier stays: if the
   query shows one, correct it in wp-admin before going further (enter `0` for no markup —
   the form cannot save a blank markup).
5. **PayPal rows in flight:**

   ```sql
   SELECT gateway, chargedCurrency, status, COUNT(*) AS n, MAX(createdAt) AS newest
   FROM payment_orders
   WHERE chargedCurrency <> 'IDR'
   GROUP BY gateway, chargedCurrency, status;
   ```

   Any `pending` USD row must be settled or reconciled by hand (open its WooCommerce order:
   was it captured at PayPal?) before deploying.
6. **No clinic options yet:**

   ```sql
   SELECT option_name FROM wp_options WHERE option_name LIKE 'praktiqu\_endpoint\_clinic\_%\_payment';
   ```

   Expect 0 rows.
7. Write down the current plugin version (1.6.8) and the current Next.js build id
   (`readlink ~/domains/endpoint.praktiqu.com/hbuilds/current`) for a rollback.

## 2. Deploy — plugin, then Next.js, then the FE

The order matters. The new Next.js needs the plugin's settings route and its `charge`
support: a 1.6.8 plugin ignores `charge` and charges the global rate, which the Next.js
backstop then catches as 502 `charge_mismatch` (and cancels the order). The reverse — new
plugin, old Next.js — is safe: 1.7.0 keeps the legacy global path for exactly this window.

### 2.1 Plugin 1.7.0 (Hostinger WordPress)

The established method: md5 comparison, tar backup, `php -l`, then `cp` + `mv`.

```bash
PLUGINS='~/domains/api-appointment.praktiqu.com/public_html/wp-content/plugins'
# 1. Every server file must match SOME version in git history (no hand edits get lost).
ssh -o ConnectTimeout=40 praktiqu-hostinger "cd $PLUGINS/praktiqu-endpoint && find . -type f -exec md5sum {} + | sort -k2"
#    Locally, for each file: git log --format=%H -- Wordpress-Plugin/praktiqu-endpoint/<file>
#    and git show <sha>:Wordpress-Plugin/praktiqu-endpoint/<file> | md5sum. Stop if a server
#    file matches no version.
# 2. Backup.
ssh -o ConnectTimeout=40 praktiqu-hostinger "mkdir -p ~/plugin-backups && tar -czf ~/plugin-backups/praktiqu-endpoint-1.6.8-\$(date -u +%Y%m%dT%H%M%SZ).tgz -C $PLUGINS praktiqu-endpoint"
# 3. Upload the merged 1.7.0 tree to a temp dir. <merged-commit> = the commit being deployed.
rm -rf /tmp/pq-1.7.0 && mkdir -p /tmp/pq-1.7.0
git -C /home/ahmad/projects/nextjs-appointment-praktiqu archive <merged-commit> Wordpress-Plugin/praktiqu-endpoint | tar -x -C /tmp/pq-1.7.0
ssh -o ConnectTimeout=40 praktiqu-hostinger 'rm -rf ~/plugin-upload-1.7.0'
scp -o ConnectTimeout=40 -r /tmp/pq-1.7.0/Wordpress-Plugin/praktiqu-endpoint praktiqu-hostinger:~/plugin-upload-1.7.0
# 4. Lint every PHP file there — expect no output.
ssh -o ConnectTimeout=40 praktiqu-hostinger "cd ~/plugin-upload-1.7.0 && find . -name '*.php' -print0 | xargs -0 -n1 php -l | grep -v '^No syntax errors'"
```

5. Swap the files in, one at a time, each as `cp <upload>/<f> <plugin>/<f>.new && mv
   <plugin>/<f>.new <plugin>/<f>`. Copy the two **new** classes first
   (`includes/class-praktiqu-endpoint-clinic-payment-settings.php`,
   `includes/class-praktiqu-endpoint-charge-validator.php`), then `praktiqu-endpoint.php` —
   it is the file that requires them — then the changed includes
   (`class-praktiqu-endpoint-rest-controller.php`, `class-praktiqu-endpoint-settings.php`,
   `class-praktiqu-endpoint-payments.php`), then `uninstall.php` and `readme.txt`. Upload
   `tests/` only if the server copy already has it. Check first that the main file's diff
   only adds `require_once` lines and the version. Until 2026-10-16 this step said to swap
   `praktiqu-endpoint.php` **last**; that is unsafe — a changed include that already uses a
   new class fatals every request until the main file requires it.
6. Verify the version and that the plugin is still active (it is a normal plugin on Hostinger
   and can drop out of `active_plugins`):

   ```bash
   ssh -o ConnectTimeout=40 praktiqu-hostinger "cd ~/domains/api-appointment.praktiqu.com/public_html && php -r 'define(\"WP_USE_THEMES\", false); require \"wp-load.php\"; echo PRAKTIQU_ENDPOINT_VERSION, PHP_EOL; var_dump(in_array(\"praktiqu-endpoint/praktiqu-endpoint.php\", (array) get_option(\"active_plugins\"), true));'"
   ```

   → `1.7.0` and `bool(true)`.
7. Settings route smoke test (pick a real clinic id; the token never leaves the server):

   ```bash
   ssh -o ConnectTimeout=40 praktiqu-hostinger 'cd ~/domains/api-appointment.praktiqu.com/public_html && TOKEN=$(php -r "define(\"WP_USE_THEMES\", false); require \"wp-load.php\"; echo PRAKTIQU_SERVICE_TOKEN;") && curl -s -H "X-PraktiQU-Service-Token: $TOKEN" https://api-appointment.praktiqu.com/wp-json/praktiqu/v1/clinics/4/payment-settings'
   ```

   → `{"clinicId":4,"settings":null}`.
8. An unknown clinic is refused and nothing is written (same server-side token read):

   ```bash
   ssh -o ConnectTimeout=40 praktiqu-hostinger 'cd ~/domains/api-appointment.praktiqu.com/public_html && TOKEN=$(php -r "define(\"WP_USE_THEMES\", false); require \"wp-load.php\"; echo PRAKTIQU_SERVICE_TOKEN;") && curl -s -X PUT -H "X-PraktiQU-Service-Token: $TOKEN" -H "Content-Type: application/json" --data "{\"international\":false,\"fx_rate\":null,\"markup_percent\":null,\"fixed_fee_idr\":null,\"updated_by\":null}" https://api-appointment.praktiqu.com/wp-json/praktiqu/v1/clinics/999999/payment-settings'
   ```

   → `{"code":"clinic_not_found",…,"data":{"status":404,…}}`. Then (ask first):
   `SELECT COUNT(*) FROM wp_options WHERE option_name = 'praktiqu_endpoint_clinic_999999_payment';`
   → `0`.
9. wp-admin → Settings → PraktiQU Endpoint: the two fields now read **Global default PayPal FX
   Rate (IDR per 1 USD)** and **Global default Foreign Patient Markup**, with the values from
   check 1.4 unchanged. Then type `16.5` into the rate field and save: the page must show the
   "Global default PayPal FX Rate was not updated" notice, and the field must still hold the
   check-1.4 rate (the form also re-saves the markup — leave it as it was; if the check-1.4
   markup is empty, the markup notice of item 11 appears too and the empty value is kept, which
   is expected). Only if the rate did change, re-enter the check-1.4 value and save again.
10. `"charge": null` is refused by the plugin itself. WordPress core treats a null param as
    absent, so the route's `charge` schema does not catch it; plugin 1.7.0's `create_order()`
    rejects a present-but-null `charge` with its own 400 `invalid_charge`, before any order
    exists. The unit test cannot prove that the real HTTP layer delivers the null, so check it
    over HTTP, with the service token, a throwaway appointment id, method `paypal` and
    `"items": []`.

    **Run it only while PPCP is in Sandbox, or while the global rate from check 1.4 is
    empty.** If the check were to fail, the request would take the legacy global-rate path;
    with Sandbox active or no global rate that can at worst be a 503 `paypal_rate_missing` or a
    throwaway sandbox order, never a live charge. If PPCP is Live and the global rate is set,
    skip this item here and run it in §3 right after step 1 instead.

    ```bash
    ssh -o ConnectTimeout=40 praktiqu-hostinger 'cd ~/domains/api-appointment.praktiqu.com/public_html && TOKEN=$(php -r "define(\"WP_USE_THEMES\", false); require \"wp-load.php\"; echo PRAKTIQU_SERVICE_TOKEN;") && curl -s -w "\nHTTP %{http_code}\n" -X POST -H "X-PraktiQU-Service-Token: $TOKEN" -H "Content-Type: application/json" --data "{\"source\":\"public\",\"appointmentId\":\"deploy-check-throwaway\",\"method\":\"paypal\",\"customerName\":\"Deploy check\",\"customerEmail\":\"deploy-check@example.com\",\"items\":[],\"taxes\":[],\"returnUrl\":\"https://example.com/\",\"cancelUrl\":\"https://example.com/\",\"charge\":null}" https://api-appointment.praktiqu.com/wp-json/praktiqu/v1/payments/order'
    ```

    → `HTTP 400` with `"code":"invalid_charge"` (message `charge must be an object when
    present`), and no new order under WooCommerce → Orders (note the newest order id before you
    run it). Any other answer — above all a 201 or a new order — means a null `charge` reaches
    the plugin's legacy path: stop, cancel any stray order and report it before going on.
11. The global markup is stored as plain digits only. In Settings → PraktiQU Endpoint type
    `1e1` into **Global default Foreign Patient Markup** and save: the page must show the
    "Global default Foreign Patient Markup was not updated" notice and the field must keep its
    earlier value. Do the same with `.5`. Then save the check-1.4 markup again and (ask first)
    run `SELECT option_value FROM wp_options WHERE option_name = 'praktiqu_endpoint_paypal_markup_percent';`
    → plain digits such as `10` or `4.4`, never `1e1`, `.5` or `+10`, and equal to check 1.4.
    (If the check-1.4 markup was empty, stop after the two rejections: the form cannot save a
    blank markup.)

### 2.2 Next.js (`endpoint.praktiqu.com`)

Deploy the merged branch the way `endpoint.praktiqu.com` is normally built (hPanel Git build).
There is no env change, no Prisma change and no SQL. Confirm the build id changed and that
`console.log` shows no new errors.

**From this moment PayPal and card are closed for every clinic**, because none is flagged yet.
On the old FE a patient who picks PayPal gets the generic "Gagal membuka halaman pembayaran"
plus the existing "Bayar dengan Xendit (IDR)" fallback, so they can still pay. Keep the gap
before 2.3 short.

Smoke checks, from the server:

- [ ] `GET /api/v1/public/practices` → every clinic has `"international": false` and
  `"paymentMethods": ["xendit"]`.
- [ ] `GET /api/v1/public/professionals/{id}/services` → every row has `clinicId`,
  `"paymentMethods": ["xendit"]` and `"usd": null`.
- [ ] `GET /api/v1/practices/{id}/payment-settings` with a SUPER_ADMIN bearer → 200,
  `stored.international: false`, `globalDefaults` equal to check 1.4 and with no `invalid` key.
- [ ] One Xendit booking pays exactly as before (rupiah, no markup, no fee).

### 2.3 Laravel FE

Rafiq merges PR `feat/klinik-internasional` in `raakanaka/laravel-praktiqu`; `main`
auto-deploys to `terpadu.praktiqu.com`. Never push to `main` directly.

- [ ] SUPER_ADMIN sees a "Pengaturan pembayaran" link on each clinic card.
- [ ] A CLINIC_ADMIN sees the menu entry under Pengaturan **after logging in again** (older
  sessions read `canManageClinicPayment` as false; nobody is forced out).
- [ ] A receptionist sees neither.

## 3. Sandbox end to end

1. **Switch PPCP to sandbox**: WooCommerce → Settings → Payments → PayPal, paste the sandbox
   app's client id and secret, save (the webhook re-registers). Have a sandbox **personal**
   buyer account and a sandbox card ready. **Gate: confirm the PPCP connection tab now reads
   Sandbox before you flag any clinic in step 2.** If it still says Live, stop. (If 2.1 item 10
   was skipped because PPCP was Live, run it now.)
2. **Flag one test clinic** — not one taking real bookings — on
   `/dashboard/klinik/{id}/pembayaran-internasional`: Klinik Internasional on, Kurs 18000,
   Markup 10, Fee flat 25000. The page's example must read **$12.23 + $1.39 = $13.62** and
   "Terakhir diubah oleh <your name> pada …".
   - Audit row (ask first):
     `SELECT occurredAt, userId, action, metadata FROM log_entries WHERE action = 'clinic.payment_settings.updated' ORDER BY occurredAt DESC LIMIT 1;`
     → `userId` is your `users.id` (a cuid), `metadata` holds `wpUserId`, `before`, `after`.
   - Storage (ask first):
     `SELECT option_value, autoload FROM wp_options WHERE option_name = 'praktiqu_endpoint_clinic_<id>_payment';`
     → the value starts with `{` (JSON, never `a:`), autoload is off (`no`/`off`).
3. **Book** a Rp 200,000 service of a psychologist at that clinic through the clinic's booking
   page: the service card shows **$12.23** (the service line, `usd.price`) with "Rp 200.000"
   underneath; step 5 offers Xendit, PayPal and Kartu, and with PayPal chosen the summary reads
   $12.23 + International service fee $1.39 = **$13.62**. The success screen offers the same
   three methods.
4. **Pay with PayPal** in a **fresh incognito window** (a PayPal session cookie overrides the
   landing page): `sandbox.paypal.com`, total **$13.62**. Pay with the sandbox buyer.
5. **Check what was recorded.**
   - WooCommerce order: currency USD, total 13.62, a fee line "International service fee"
     (1.39), custom fields `praktiqu_clinic_id` = the clinic id, `praktiqu_fixed_fee_idr` =
     25000, `praktiqu_fx_rate` = 18000, `praktiqu_markup_percent` = 10, and
     `praktiqu_fx_source` = `{"fxRate":"clinic","markupPercent":"clinic","fixedFeeIdr":"clinic"}`.
   - `payment_orders` (ask first):
     `SELECT wcOrderId, gateway, expectedAmount, chargedAmount, chargedCurrency, fxRate, status FROM payment_orders ORDER BY createdAt DESC LIMIT 1;`
     → `expectedAmount` 200000 (the fee is not the clinic's), `chargedAmount` 13.62, `USD`,
     `fxRate` ≈ 16363.64 (rate ÷ 1.10), `status` `pending`.
6. **Replay the final webhook (UNILATERAL).** In sandbox the capture stays *pending* with reason
   `UNILATERAL`: PPCP carries the live merchant e-mail into sandbox, PayPal holds the money
   unclaimed, WooCommerce puts the order *on-hold*, and nothing books the appointment. That is
   expected — replay `payment.completed` by hand, on the server.

   **Only while Sandbox is active, only for the sandbox capture id — never for a live order.**

   ```bash
   cd ~/domains/endpoint.praktiqu.com/hbuilds/config
   SECRET=$(grep '^PAYMENT_WEBHOOK_SECRET=' .env | cut -d= -f2- | tr -d '"')
   BODY='{"event":"payment.completed","wcOrderId":<WC order id>,"amountPaid":13.62,"currency":"USD","transactionId":"<PayPal capture id from the order notes>"}'
   SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SECRET" | sed 's/^.* //')
   curl -s -X POST https://endpoint.praktiqu.com/api/v1/sessions/payment-webhook \
     -H 'Content-Type: application/json' -H "X-PraktiQU-Webhook-Signature: $SIG" --data "$BODY"
   ```

   `transactionId` must be a JSON **string**. Expected: 200, the `payment_orders` row `paid`,
   the appointment **BOOKED**, the delayed auto-cancel job cancelled. If the running process's
   environment differs from `.env`, use the value the process actually has.
7. **Card:** book again, choose Kartu → the PayPal page opens on the **card form**; pay with
   the sandbox card; replay the webhook as in 6.
8. **Negative checks.**
   - [ ] A clinic that is not international: no PayPal/Kartu buttons, and
     `POST /api/v1/public/payments {"token":"…","method":"paypal"}` → **403**
     `payment_method_not_allowed`, with no WooCommerce order created.
   - [ ] Xendit at the international clinic → **Rp 200.000**: no markup, no fee.
   - [ ] (Optional) staff `POST /api/v1/sessions/payment-verify {"billId":"…","method":"paypal"}`
     on a bill with a discount → **422** `discount_not_supported`.
9. Switch International off again for **every** test clinic you flagged during this section,
   before §4.1 switches PPCP to Live. Real clinics are enabled only later, in §4.2.

## 4. Back to live, then enable clinics

1. **Switch PPCP back to Live** (live client id and secret, save, webhook re-registers) and
   confirm the connection tab says Live. Do not leave the box in sandbox.
2. **Enable real clinics one at a time**, with the clinic owner: set Kurs / Markup / Fee flat,
   check the example, open that clinic's booking page and check the USD price, then watch the
   first live USD payment through to BOOKED. Live capture → webhook → BOOKED has never run
   against real PayPal, and neither has a booking with a tax line (`wp_kc_taxes` is empty), so
   the first of each is the real test.
3. **Kill switch:** turning International off for a clinic hides PayPal and card at once.
   Next.js does not cache the settings, and the FE forgets its `pq_public_practices` cache on
   every save.

## 5. Next plugin release: remove the legacy path

`create_order` for `paypal`/`card` **without** a `charge` (the global rate path) exists only for
the deploy window between 2.1 and 2.2. Before removing it in the next plugin release, confirm
nothing still uses it: every USD WooCommerce order created after the Next.js deploy carries a
`praktiqu_fx_source` custom field. Then remove the branch, bump the version, and deploy with
the method in 2.1.

## Rollback

- **Settle first.** Run check 1.5 again; any `pending` USD row must be settled or reconciled
  before rolling anything back.
- **Roll back in the reverse order: Next.js first, then the plugin.** New Next.js against a
  1.6.8 plugin would fail every USD payment as 502 `charge_mismatch` and every settings save
  as 502 `payment_settings_save_failed`.
- **Next.js:** redeploy the build id written down in 1.7. The old app never sends `charge`, so
  plugin 1.7.0's legacy path takes PayPal again with the **global** rate and markup — and with
  no per-clinic gate, every clinic can be paid by PayPal or card again. Decide with the user
  whether to blank the global rate to keep PayPal shut.
- **Plugin:** move `praktiqu-endpoint` aside, extract the tar backup from 2.1 into
  `wp-content/plugins/`, and re-run the check in 2.1 step 6 (expect `1.6.8`, `bool(true)`).
- The `praktiqu_endpoint_clinic_{id}_payment` options can stay: nothing older reads them, and
  `uninstall.php` removes them only when the plugin is deleted.
