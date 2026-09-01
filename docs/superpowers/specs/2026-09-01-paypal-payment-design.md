# PayPal Payment Method — Design

**Date:** 2026-09-01
**Status:** Approved (user, 2026-09-01)
**Builds on:** `2026-07-14-appointment-payment-xendit-woocommerce-design.md`,
`2026-07-24-xendit-hosted-checkout-handoff-design.md`

## Problem

The clinic wants to accept PayPal alongside Xendit, and requires a card option. The
WooCommerce PayPal Payments plugin is already installed and connected, but no payment can
succeed through it: the store currency is IDR, which PayPal does not support.

## Audit of the existing setup (2026-09-01, `appointment.praktiqu.com`)

Measured directly against the live WordPress install, not assumed.

**Working:**

| Item | Value |
| --- | --- |
| Plugin | `woocommerce-paypal-payments` v4.1.2, present in `active_plugins` |
| Onboarding | `completed: true`, `setup_done: true`, `gateways_synced: true` |
| Merchant | `merchant_connected: true`, id `6565GTKBHLQ6Q`, `praktiqu@gmail.com`, country `ID` |
| Credentials | manual connection, `client_id` set (82 chars); a live PayPal bearer token is cached in `_transient_ppcp-paypal-bearerppcp-bearer`, proving the keys authenticate |
| Gateways | `ppcp-gateway` and `ppcp-card-button-gateway` both `enabled: yes` |
| Capabilities | all `ACTIVE`, products `SUBSCRIBED`, `is_send_only_country: false` — the Indonesian merchant account may receive payments |
| Webhook | `ppcp-webhook` option registered |

**Blocking:** `woocommerce_currency = IDR`.

The plugin's own supported-currency list
(`modules/ppcp-api-client/services.php:393` on the server) is:
`AUD, BRL, CAD, CNY, CZK, DKK, EUR, HKD, HUF, ILS, JPY, MYR, MXN, TWD, NZD, NOK, PHP,
PLN, GBP, RUB, SGD, SEK, CHF, THB, USD`. IDR is absent — the string `IDR` does not
appear anywhere in the plugin's PHP source.

The plugin does **not** fail closed. `modules/ppcp-wc-gateway/src/Notice/
UnsupportedCurrencyAdminNotice.php` only renders an admin warning, and only on the
WooCommerce-gateways or PPCP-settings screens. The gateway stays enabled and appears
available; a real transaction would reach PayPal and be rejected.

**Also noted:** `use_sandbox: false` — the connection is in **live** mode, so any test
transaction moves real money. `authorize_only: false`, `capture_virtual_orders: false`,
`three_d_secure: no-3d-secure`, `landing_page: 'any'`.

### Card availability

The merchant's PayPal capabilities, read from the cached seller status, are
`PPCP_STANDARD` (SUBSCRIBED), `PAYPAL_CHECKOUT`, `EXPRESS_CHECKOUT`, **`GUEST_CHECKOUT`**,
`PAYPAL_CHECKOUT_ALTERNATIVE_PAYMENT_METHODS`, `PAYPAL_CHECKOUT_PAY_WITH_PAYPAL_CREDIT`,
`INSTALLMENTS`, `SUBSCRIPTIONS`, `QR_CODE`, `SEND_INVOICE`, `ACCEPT_DONATIONS`,
`WITHDRAW_FUNDS_TO_DOMESTIC_BANK` — all `ACTIVE`.

**On-site card fields are impossible.** Advanced Card Processing (DCC) requires country
eligibility. The plugin's matrix (`modules/ppcp-api-client/services.php:414`, filterable
as `woocommerce_paypal_payments_supported_country_card_matrix`) lists 43 countries — `AU
AT BE BG CN C2 CY CZ DE DK EE ES FI FR GB GR HK HU IE IT US CA LI LT LU LV MT MX NL NO PL
PT RO SE SI SK SG JP YT RE GP GF MQ` — and **`ID` is not among them**. This matches the
capability set: `CUSTOM_CARD_PROCESSING` is absent, only `PPCP_STANDARD` is granted.
Accordingly `ppcp-credit-card-gateway`, `ppcp-axo-gateway` (Fastlane),
`ppcp-applepay_settings`, and `ppcp-googlepay_settings` are all `enabled: no` and cannot
usefully be enabled.

**Card through PayPal's hosted page works.** `GUEST_CHECKOUT` being ACTIVE means a payer
with no PayPal account can pay by debit or credit card on the hosted page. Card is
therefore already reachable today, merged into the single PayPal page.

**`ppcp-card-button-gateway` is not a usable second gateway for us**, despite being
`enabled: yes`. `CardButtonGateway::process_payment()` has the same
`PayPalOrderMissingException` fallback, but calls `create_order($wc_order)` with no
`funding_source` argument, so it defaults to `'paypal'` and produces a PayPal order
identical to `ppcp-gateway`'s. The two gateways differ only in which button the browser
clicked; driven server-side they are the same thing. Routing a "card" method through it
would add a branch with no behavioural difference.

## Feasibility of the server-side call (verified by reading PPCP source)

Our bridge calls `$gateway->process_payment($order_id)` from a REST request, with no
browser, cart, or JS SDK. PPCP normally expects a PayPal order created client-side, so
this needed checking. It works:

- `PayPalGateway::process_payment()` → `OrderProcessor::process()`. With no PayPal order
  in session and no `paypal_order_id`, `OrderProcessor.php:111` throws
  `PayPalOrderMissingException`.
- `PayPalGateway.php:449` catches it, calls `OrderProcessor::create_order()` server-side,
  and returns `['result' => 'success', 'redirect' => <paypal checkout url>]` — the same
  shape Xendit returns, which `create_order()` already consumes.
- `SessionHandler::load_session()` guards on `isset(WC()->session)`, so the REST context
  does not fatal.
- The return leg is session-independent: `ReturnUrlEndpoint::handle_request()` resolves
  the WC order from the PayPal order's `custom_id` (`ReturnUrlEndpoint.php:103`), not
  from a browser session, then calls `process_payment()` again to capture and redirects
  to `$success['redirect']` — which is `get_return_url()`, already filtered to the
  front-end by our existing `woocommerce_get_return_url` hook.

Consequence: **the post-payment path needs no changes at all.** Capture, order status
change, `payment.completed` webhook, and `PENDING → BOOKED` all reuse the Xendit
machinery.

## Decisions

Approved by the user on 2026-09-01:

1. **PayPal is an additional method, not a replacement.** Xendit keeps serving local
   patients in IDR.
2. **Both flows** — public booking and staff/session bills. Both already share
   `create_order()`, so generalizing the gateway resolver covers both.
3. **Currency: per-order USD with a manually configured rate.** The store stays IDR.
   Only PayPal orders are created as USD. Rejected: a live FX API (adds an external
   dependency and a new failure mode), and switching the store currency to USD (kills
   Xendit, which needs IDR).
4. **The rate lives in wp-admin and the plugin converts.** New field next to the
   existing Payment Webhook Secret. The clinic admin can update it without a deploy or
   an app restart — notably avoiding the cPanel Node.js Selector env-var route, where a
   trailing space in a key name once silently broke payment webhooks for a day. The plugin
   returns the charged figures to Next.js, which records them.
5. **Initial rate: 18000 IDR per USD**, set by the user. See *Risks* — as a divisor, a
   rate above the market rate charges the payer less, so this figure discounts foreign
   payments rather than buffering the clinic. It is a wp-admin field, changeable in one
   click.
6. **Rounding is always up (ceiling)** for foreign currency. Any rounding difference
   accrues to the clinic, never undercharges.
7. **Card is a third method, `card`.** The user requires a card option; merged or separate
   was left to us. It routes through the same `ppcp-gateway` but overrides
   `landing_page` to `GUEST_CHECKOUT`, so the payer lands on the card form instead of the
   PayPal login form. Chosen over merging into one `paypal` method because a visible card
   button is what a patient without a PayPal account looks for, and the extra cost is one
   scoped filter. On-site card fields are not an option at all (see *Card availability*).
8. **Test in PayPal sandbox**, not live, then restore live credentials.
9. **Scope is API + plugin only.** The Laravel front-end is Rafiq's and read-only for us;
   the method-selector UI is handed off with a contract document.

## Design

### Data flow

```
POST /public/payments { token, method: 'xendit' | 'paypal' | 'card' }
  └→ createWcOrder({ ..., method })
       └→ plugin  POST /praktiqu/v1/payments/order
            ├─ xendit → order currency IDR → gateway xendit*          (unchanged)
            ├─ paypal → order currency USD → gateway ppcp-gateway
            └─ card   → order currency USD → gateway ppcp-gateway
                                           + landing_page GUEST_CHECKOUT
                 └→ process_payment() → PayPal hosted checkout URL
  ← { orderId, checkoutUrl, chargedAmount, chargedCurrency, fxRate }

payer approves on PayPal
  → ReturnUrlEndpoint → capture → order paid
  → woocommerce_order_status_changed (existing)
  → payment.completed webhook (existing)
  → PENDING → BOOKED (existing)
```

### WordPress plugin — `praktiqu-endpoint` 1.4.0 → 1.5.0

**New setting.** `praktiqu_endpoint_paypal_idr_rate` — rupiah per 1 USD, an integer or
decimal, seeded to `18000`. Registered on the existing Settings → PraktiQU Endpoint screen
alongside the payment webhook fields, following the same `register_setting` +
`sanitize_callback` pattern. A companion option stores the last-modified timestamp and
the screen displays it, so a stale rate is visible rather than silent. The field's help
text states the direction explicitly — a higher rate charges the payer fewer dollars —
because the intuition runs the other way.

**Gateway resolution.** `resolve_xendit_gateway()` becomes
`resolve_gateway(string $method): ?WC_Payment_Gateway`:

- `xendit` — first enabled gateway whose id starts with `xendit` (today's behaviour).
- `paypal`, `card` — the enabled gateway with id `ppcp-gateway`.

`create_order()` reads `$input['method']` and **defaults to `xendit`** when absent, so
every existing caller keeps working untouched. An unrecognised method is rejected with
`WP_Error('unknown_method', …, ['status' => 400])` before any WC order is created, so a
typo cannot silently fall through to Xendit and charge in the wrong currency.

**Card landing page (only when `method === 'card'`).** Immediately before
`process_payment()`, add a closure to the plugin filter
`ppcp_create_order_request_body_data` (`modules/ppcp-api-client/src/Endpoint/
OrderEndpoint.php:173`) that sets
`$data['payment_source']['paypal']['experience_context']['landing_page'] =
'GUEST_CHECKOUT'`. Remove the filter in a `finally` block so a thrown exception can't leave
it registered for the rest of *this* request. (It is not a defence against a later,
separate request: WordPress rebuilds `$wp_filter` on every bootstrap, so PHP-FPM reusing a
process across requests carries compiled code, never filter state.) `GUEST_CHECKOUT` is
PPCP's own constant
(`ExperienceContext::LANDING_PAGE_GUEST_CHECKOUT`); the store setting is currently `'any'`,
which maps to `NO_PREFERENCE`.

Using the plugin's documented filter, rather than editing PPCP or hand-rolling a PayPal
API call, keeps the change update-safe and leaves a single code path for both PayPal
methods.

**Conversion (when `method` is `paypal` or `card`).** Before the WC order is even created:

1. Read the rate. If it is missing, non-numeric, or `<= 0`, create no WC order and return
   `WP_Error('paypal_rate_missing', …, ['status' => 503])` — mirrors the unknown-method
   check above, and leaves nothing unsweepable behind.
2. `$order->set_currency('USD')` (after `wc_create_order()`, since this step needs the order).
3. Convert **each** item price and **each** tax amount independently:

   ```php
   $usd = ceil(round(($idr / $rate) * 100, 6)) / 100;
   ```

   The inner `round(…, 6)` exists to stop binary-float error from inflating an exact
   value — without it `12.00 * 100` can evaluate to `1200.0000000001` and `ceil()` would
   return `12.01`.
4. The order total is WooCommerce's own sum of those lines, and that sum is what PayPal
   charges.

Rounding per line (rather than only on the total) is forced by WooCommerce: it recomputes
the total from the line items, so a separately-ceiled total would not survive
`calculate_totals()`. The cost is an over-charge bounded by $0.01 per line — a typical
booking is one service plus one or two taxes, so at most $0.03.

**Order metadata** (for reconciliation and disbursement, which reads WC order data):
`praktiqu_charge_currency`, `praktiqu_fx_rate`, `praktiqu_expected_idr`.

**Response.** `create_order()` returns `chargedAmount`, `chargedCurrency`, and `fxRate`
in addition to `orderId` and `checkoutUrl`. For Xendit orders these are the IDR total,
`IDR`, and `null`.

**Webhook payload fix.** `dispatch_payment_webhook()` currently sends
`'amountPaid' => (int) round((float) $order->get_total())`
(`class-praktiqu-endpoint-payments.php:267`). For a USD order of `$12.35` that transmits
`12`, which `markPaid` compares against an `expectedAmount` of e.g. `200000` IDR — an
`AmountMismatchError`, a 409, and an appointment that never reaches BOOKED. The payload
gains a `currency` field, and `amountPaid` is rounded to 2 decimals when the currency is
not IDR. IDR orders keep the integer cast, so their behaviour is byte-for-byte unchanged.

`get_order_status()` (`:199`) carries the identical bug on the verify-fallback path and
gets the identical treatment.

**Free services** (total 0) keep their current short-circuit: no gateway, no invoice,
`payment_complete()` immediately. That path never reaches the conversion code.

### Next.js

**Schema.** Four columns on `payment_orders`, applied through scoped SQL in
`prisma/manual/2026-09-01-paypal-payment-orders.sql`. `prisma db push` and
`prisma migrate dev` are forbidden here — `DATABASE_URL` is the WordPress database and
the schema mixes app tables with `wp_` tables.

| Column | Type | Default |
| --- | --- | --- |
| `gateway` | `VARCHAR(32)` | `'xendit'` — stores the method: `xendit`, `paypal`, or `card` |
| `chargedCurrency` | `VARCHAR(3)` | `'IDR'` |
| `chargedAmount` | `DECIMAL(12,2)` | — |
| `fxRate` | `DECIMAL(12,2)` | `NULL` |

The defaults keep every existing row valid with no backfill.

**Code changes:**

- `createWcOrder` accepts `method`; its result type gains `chargedAmount`,
  `chargedCurrency`, `fxRate`.
- `initiatePublicPayment(appointmentId)` → `initiatePublicPayment(appointmentId, method)`
  and `ensureSessionPayment(billId)` → `ensureSessionPayment(billId, method)`. Both
  persist the charged figures onto the `payment_orders` row they create.
- `POST /public/payments` and `POST /sessions/payment-verify` (which both initiates and
  verifies the staff flow) accept
  `method: z.enum(['xendit', 'paypal', 'card']).default('xendit')`.
- `PaymentStatusView` gains `chargedAmount` and `chargedCurrency` alongside
  `expectedAmount`, so the front-end can display `$12.35` rather than a rupiah figure the
  payer was never charged. Returned by `checkPublicPaymentStatus`,
  `checkSessionPaymentStatus`, and `ensureSessionPayment`.
- `markPaid` branches on the stored currency: `IDR` keeps the existing ±2 rupiah
  tolerance; anything else compares `chargedAmount` with a ±0.01 tolerance.
- `reconcileIfStale`, which reads the order back through `getWcOrderStatus` on the
  verify-fallback path, gets the same currency-aware comparison.

`expectedAmount` stays in IDR and remains the source of truth. Service pricing and tax
computation (`computePublicAmount`, `computeSessionAmountFromBill`) are not touched.

### Error handling

| Condition | Result |
| --- | --- |
| Unrecognised `method` | `WP_Error` 400 `unknown_method`, no WC order created |
| Rate missing / non-numeric / `<= 0` | No WC order created, `WP_Error` 503 `paypal_rate_missing` (resolved before `wc_create_order()` — see below) |
| No enabled `ppcp-gateway` | WC order cancelled, `WP_Error` 503 (mirrors the Xendit branch) |
| PayPal API rejects the order | Notice captured via `wc_get_notices()`, WC order cancelled, `WP_Error` 502 |
| Converted total below PayPal's minimum | WC order cancelled, `WP_Error` 502 with the PayPal message |
| Amount mismatch at webhook | 409, logged, appointment left PENDING for the auto-cancel job |

Cancelling the WC order on every failure preserves the existing invariant: no orphan
order is left holding a slot.

## Testing

- **Unit (`tests/payments/`)** — the ceiling conversion, including the float-error case
  and a zero/negative rate; `markPaid`'s currency branch for both IDR and USD; the
  `method` parameter defaulting to `xendit` and rejecting an unknown value on both routes.
  The existing seven test files must stay green.
- **Plugin** — `php -l` on every changed file.
- **End-to-end, in PayPal sandbox:** create a sandbox REST app, swap the sandbox client
  id/secret into PPCP, re-register the webhook, then run a public booking through
  `POST /public/payments { method: 'paypal' }`, confirm `checkoutUrl` points at
  `sandbox.paypal.com`, pay with a sandbox buyer account, and confirm the appointment
  moves `PENDING → BOOKED` and the patient lands on the front-end success URL. Repeat for
  a session bill. Then restore the live credentials and re-register the live webhook.
- **Card method** — the same run with `method: 'card'`, checking two things: the hosted
  page opens on the card form rather than the PayPal login, and paying with a sandbox
  **card** (no PayPal account) completes the booking. The landing-page filter's cleanup
  is verified by code review (the `finally` block), not by a live "run another order
  right after" step — two separate HTTP requests never share `$wp_filter` state (see
  above), so such a step would pass regardless of whether the `finally` exists.
- **Tax line** — a `paypal` order for a service with a tax line, the one genuinely new
  code path versus Xendit (a tax line becomes a `WC_Order_Item_Fee`, and PPCP must
  itemise the purchase unit so the parts sum to the total). Assert the PayPal page's
  total matches `chargedAmount` and the booking completes.
- **Regression** — one Xendit booking after the change, to prove the default path is
  untouched.

## Deployment checklist

1. Apply the scoped SQL to add the four columns.
2. Copy `schema.prisma` to the server and run `prisma generate` there, then restart.
   A `.next`-only deploy does not regenerate the Prisma client — that exact omission
   previously made `/public/payment-verify` return 500 because `prisma.paymentOrder` was
   undefined.
3. Deploy plugin 1.5.0 to `appointment.praktiqu.com` (`wp-cli` is not on PATH on that
   box; activate through WordPress's own `activate_plugin()` if needed).
4. Set the FX rate in wp-admin before enabling PayPal in the front-end.
5. Verify plugin health returns `1.5.0`.

## Risks and accepted limitations

- **Failure and cancel land on the WooCommerce checkout page.** PPCP hardcodes
  `cancel_url = wc_get_checkout_url()`, exactly as the Xendit plugin does. This is the
  same technical debt already accepted on 2026-07-24, and is not addressed here.
- **The configured rate of 18000 discounts foreign payments.** The rate is a divisor
  (`USD = IDR / rate`), so a figure above the market rate charges fewer dollars. At a
  market rate near 16500, a Rp 200.000 service is charged $11.11 and settles to about
  Rp 183.315 — roughly 8% below list, before PayPal's fees. A rate *below* market is what
  buffers the clinic. The user set 18000 knowingly; it is a wp-admin field and changing it
  needs no deploy. Flagged here so nobody later reads it as a safety margin.
- **PayPal cross-border fees (~4.4% + a fixed fee)** mean the clinic receives less than
  `chargedAmount`. Combined with the rate above, the effective shortfall per PayPal
  transaction is roughly 12–13% of the rupiah list price.
- **A stale FX rate is the clinic's exposure.** The last-modified timestamp makes it
  visible on the settings screen.
- **`landing_page` is a preference, not a contract.** PayPal may still show the
  account-login option on a `card` order. The requirement — that a card option exists —
  holds either way, because `GUEST_CHECKOUT` is active; only the pre-selected form is at
  stake.
- **The connection is currently live.** No test transaction may run before the sandbox
  credentials are in place.
- **PayPal expires an unapproved order after roughly three hours**, while our auto-cancel
  releases the slot after one. Ours is stricter, so the slot is never held longer than
  today.

## Out of scope

- Any front-end work, including the method selector.
- Routing PayPal failure or cancellation back to the front-end.
- Refunds through the API (PPCP supports `process_refund`, but no route drives it today).
- Currencies other than USD.
- Changes to disbursement, the webhook secret, the auto-cancel job, or the Xendit path.
- On-site card fields, Apple Pay, Google Pay, and Fastlane — all require Advanced Card
  Processing, for which Indonesia is not eligible. Not deferred; unavailable.
