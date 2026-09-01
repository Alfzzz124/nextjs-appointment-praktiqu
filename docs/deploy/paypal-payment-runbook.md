# PayPal + Card Payment — Deployment Runbook

**Spec:** `docs/superpowers/specs/2026-09-01-paypal-payment-design.md`
**Plan:** `docs/superpowers/plans/2026-09-01-paypal-payment.md`

## Before you start

**The PayPal connection on `appointment.praktiqu.com` is LIVE** (`use_sandbox: false`,
merchant `6565GTKBHLQ6Q`). A test payment moves real money. Do step 5 before any test.

Access: `ssh -i ~/.ssh/praktiqu_staging -p 45022 praktiqu@101.50.1.106`. Port 45022, not
22, and it is intermittently unreachable for minutes — retry rather than concluding the
box is down. `wp-cli` is **not** on PATH; activate plugins through WordPress's own
`activate_plugin()` from a throwaway script.

## 1. Database

```bash
mysql -u praktiqu_wp580 -p praktiqu_wp580 < prisma/manual/2026-09-01-paypal-payment-orders.sql
```

Verify: `SHOW COLUMNS FROM payment_orders LIKE 'charged%';` → two rows.

## 2. Prisma client on the server

A `.next`-only deploy does **not** regenerate the Prisma client. Skipping this is what
made `/public/payment-verify` return 500 once before, because `prisma.paymentOrder` was
undefined. Copy `prisma/schema.prisma` up, then on the server:

```bash
source ~/nodevenv/staging2.praktiqu.com/20/bin/activate
cd ~/staging2.praktiqu.com && npx prisma generate
```

Then restart Passenger.

## 3. App

Deploy the built `.next` as usual. Verify the app root returns 200 and no new stderr
appears in `~/logs`.

## 4. Plugin

Upload `Wordpress-Plugin/praktiqu-endpoint/` to
`~/appointment.praktiqu.com/wp-content/plugins/praktiqu-endpoint/`, keeping a timestamped
backup of the existing directory. Verify plugin health reports `"version":"1.5.0"`.

Then in **Settings → PraktiQU Endpoint**, set **PayPal FX Rate (IDR per 1 USD)** to
`18000` and save. Confirm "Last changed" appears.

> The rate divides: `USD = IDR / rate`. A **higher** rate charges the payer **fewer**
> dollars. At 18000 a Rp 200.000 service is charged $11.12.

## 5. Switch PayPal to sandbox — before any test payment

1. At developer.paypal.com, create a sandbox REST app; note its client id and secret.
2. WooCommerce → Settings → Payments → PayPal → switch to sandbox and paste them.
3. Re-register the webhook (the plugin does this on save; confirm the `ppcp-webhook`
   option changed).
4. Create a sandbox **personal** buyer account for the PayPal test and note a sandbox
   card for the card test.

## 6. End-to-end tests

Curl from a local machine hits a JS bot-check WAF and returns an HTML "One moment,
please..." page rather than JSON — **run these from the server itself.**

- [ ] `POST /public/payments {"token":"…","method":"paypal"}` → 201, `checkoutUrl` on
  `sandbox.paypal.com`, `chargedCurrency: "USD"`, `chargedAmount` = ceil of
  `total_idr / 18000`.
- [ ] Pay with the sandbox buyer account → appointment goes `PENDING → BOOKED`, patient
  lands on the front-end success URL.
- [ ] `method: "card"` → the hosted page opens on the **card form**, and paying with a
  sandbox card (no PayPal login) completes the booking.
- [ ] Immediately after the card order, run a `paypal` order in the same PHP process →
  it must open on the **PayPal login**, proving the landing-page filter was removed and
  did not leak.
- [ ] A session bill through `POST /sessions/payment-verify {"billId":"…","method":"paypal"}`.
- [ ] **Regression:** one `xendit` booking, and one with `method` omitted entirely →
  both charge rupiah and behave exactly as before.
- [ ] Missing rate: temporarily blank the FX rate, attempt a `paypal` order → **503**
  `paypal_rate_missing`, and the WC order is left `cancelled`, holding no slot. Restore
  the rate afterwards.

## 7. Restore live mode

Swap the live client id and secret back, re-register the webhook, and confirm
`use_sandbox` reads `false` again. **Do not leave the box in sandbox.**

## Rollback

- Plugin: restore the timestamped backup directory.
- App: restore the previous `.next` backup.
- Database: the four columns are additive and all default or nullable, so they can stay.
  Nothing reads them unless a `paypal`/`card` order exists.
