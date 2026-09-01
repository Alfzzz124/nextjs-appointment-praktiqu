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

## Environments

This is one physical box with two separate site directories on it — don't point a step
at the wrong one:

| Component | Host / directory | Database |
| --- | --- | --- |
| Next.js app + Prisma client (steps 1, 3, 4) | `~/staging2.praktiqu.com` (nodevenv `~/nodevenv/staging2.praktiqu.com/20`) | `praktiqu_wp580` |
| WordPress + plugin + PayPal (steps 2, 5–7) | `~/appointment.praktiqu.com/wp-content/plugins/praktiqu-endpoint/` | live WP database, **live** merchant `6565GTKBHLQ6Q` |

Each numbered step below is tagged with which row it belongs to. Applying the SQL in
step 1 to the wrong database, or the plugin in step 2 to the wrong site, will not error
loudly — it will just silently do nothing or corrupt the wrong install.

## Deploy order — plugin before app, not the other way round

Deploy in this order: **SQL → plugin 1.5.0 (including the FX rate) → Prisma client →
app.** Do not deploy the app first. If the app goes live before the plugin, a
`method:'paypal'` request reaches plugin 1.4.0, which ignores `method` and silently
resolves the Xendit gateway: the patient who chose PayPal is billed in **rupiah** on a
**Xendit** page, while the app records `gateway:'paypal', chargedCurrency:'IDR'` for
that order — and 1.4.0 has no version handshake, so nothing detects the mismatch. The
reverse order (new plugin, old app) was verified safe: the old app never sends `method`
so the plugin defaults to `xendit`, the old client ignores the three extra response
keys, the old webhook schema strips `currency`, and an IDR order's `amountPaid` is
still `(int) round(total)`. Don't "optimise" this back to app-then-plugin.

## 1. Database

*[`staging2.praktiqu.com` / `praktiqu_wp580`]*

```bash
mysql -u praktiqu_wp580 -p praktiqu_wp580 < prisma/manual/2026-09-01-paypal-payment-orders.sql
```

Verify **all four** new columns, not just the `charged*` ones — the app writes
`gateway` and `fxRate` too, and a partial `ALTER` would 500 every payment initiation on
the very first write:

```sql
SHOW COLUMNS FROM payment_orders WHERE Field IN ('gateway', 'chargedCurrency', 'chargedAmount', 'fxRate');
```

→ four rows.

## 2. Plugin

*[`appointment.praktiqu.com` / live]*

Upload `Wordpress-Plugin/praktiqu-endpoint/` to
`~/appointment.praktiqu.com/wp-content/plugins/praktiqu-endpoint/`, keeping a timestamped
backup of the existing directory. Verify plugin health reports `"version":"1.5.0"`.

Then in **Settings → PraktiQU Endpoint**, set **PayPal FX Rate (IDR per 1 USD)** to
`18000` and save. Confirm "Last changed" appears.

> The rate divides: `USD = IDR / rate`. A **higher** rate charges the payer **fewer**
> dollars. At 18000 a Rp 200.000 service is charged $11.12.

## 3. Prisma client on the server

*[`staging2.praktiqu.com` / `praktiqu_wp580`]*

A `.next`-only deploy does **not** regenerate the Prisma client. Skipping this is what
made `/public/payment-verify` return 500 once before, because `prisma.paymentOrder` was
undefined. Copy `prisma/schema.prisma` up, then on the server:

```bash
source ~/nodevenv/staging2.praktiqu.com/20/bin/activate
cd ~/staging2.praktiqu.com && npx prisma generate
```

Then restart Passenger.

## 4. App

*[`staging2.praktiqu.com`]*

Deploy the built `.next` as usual. Verify the app root returns 200 and no new stderr
appears in `~/logs`.

## 5. Switch PayPal to sandbox — before any test payment

*[`appointment.praktiqu.com` / live → sandbox]*

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
- [ ] A `paypal` order for a service that carries a **tax line** → the PayPal hosted
  page's total matches `chargedAmount` (each item *and* the tax line are independently
  ceiling-converted, and PPCP's purchase-unit breakdown must still sum to that total),
  and paying completes the booking. This is the one genuinely new code path versus
  Xendit — a tax line becomes a `WC_Order_Item_Fee` — and every other test above uses a
  zero-tax booking, so none of them exercise it.
- [ ] **Filter-leak check — verified by code review, not by a live test.** An earlier
  draft of this runbook had a step here that ran a card order, then a `paypal` order,
  "in the same PHP process," and asserted the second opened on the PayPal login. That
  test cannot fail: two HTTP requests never share `$wp_filter` state — WordPress
  rebuilds the filter registry on every bootstrap, and PHP-FPM process reuse carries
  compiled code across requests, never runtime state. The test would pass whether or
  not the `finally` block in `create_order()` exists, so it was deleted rather than
  kept as false confidence. What the `finally` blocks around
  `ppcp_create_order_request_body_data` and `wc_get_price_decimals` actually protect is
  the *current* request: without them, an exception thrown mid-`process_payment()`
  would leave the filter registered for any later work in that same request. Confirm
  this by reading `create_order()`, not by a step here. (A real test would require a
  throwaway script that calls `create_order()` twice within one PHP process, forcing
  the first call to throw before its `finally` runs — impractical to stand up on this
  box for this release.)
- [ ] A session bill through `POST /sessions/payment-verify {"billId":"…","method":"paypal"}`.
- [ ] **Regression:** one `xendit` booking, and one with `method` omitted entirely →
  both charge rupiah and behave exactly as before.
- [ ] Missing rate: temporarily blank the FX rate, attempt a `paypal` order → **503**
  `paypal_rate_missing`, and **no WC order is created at all**. Restore the rate
  afterwards.

## 7. Restore live mode

*[`appointment.praktiqu.com` / live]*

Swap the live client id and secret back, re-register the webhook, and confirm
`use_sandbox` reads `false` again. **Do not leave the box in sandbox.**

## Rollback

**Before rolling back either component**, confirm no `payment_orders` row is a paid
foreign order still stuck mid-flight:

```sql
SELECT id, wcOrderId, chargedCurrency, status, createdAt
FROM payment_orders
WHERE chargedCurrency <> 'IDR' AND status = 'pending';
```

Any row this query returns must be settled or reconciled by hand first (check the
matching WooCommerce order directly — was it actually captured at PayPal?) before
rolling back either component. Rolling back silently destroys a paid booking, because
the rolled-back amount check rejects that order's webhook and the auto-cancel job then
releases the slot, even though the money is already captured at PayPal:

- **App rolled back:** the old `markPaid` computes `Math.abs(200000 - 11.12) > 2` →
  `AmountMismatchError` → 409. The appointment stays PENDING and the 1-hour auto-cancel
  releases the slot.
- **Plugin rolled back:** 1.4.0's `get_order_status()` reports `amount: (int) round(11.12) = 11`
  with no `currency`, so the verify-fallback compares 200000 against 11 — same outcome.

Once confirmed clear:

- Plugin: restore the timestamped backup directory.
- App: restore the previous `.next` backup.
- Database: the four columns are additive and all default or nullable, so they can stay.
  Nothing reads them unless a `paypal`/`card` order exists.
