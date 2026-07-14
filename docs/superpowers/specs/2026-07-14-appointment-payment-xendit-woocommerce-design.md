# Appointment Payment via WooCommerce + Xendit — Design

**Date:** 2026-07-14
**Status:** Approved (user, 2026-07-14)
**Branch:** fix/auth-hardening-and-wp-plugin (implementation will branch off)

## Decisions (made with user)

| Decision | Choice | Why |
| --- | --- | --- |
| Gateway | **Xendit**, via the **WooCommerce Xendit gateway plugin** | Proven in the old KiviCare setup; the clinic's **disbursement feature depends on WooCommerce order data**, so payments must produce real WC orders. |
| Bridge | Extend the existing **`praktiqu-endpoint`** WP plugin | It already has service-token REST auth, an HMAC-SHA256 webhook dispatcher, and Action Scheduler job plumbing. No new plugin. |
| Flows | **Both at once**: public/guest booking payment and staff-created session/bill payment | Same WC bridge underneath; only the initiator differs. |
| Payment window | **1 hour** hold, then auto-cancel | Long enough for VA/bank transfer; Xendit invoice expiry set to match so no payment can land after the slot is released. |
| Status sync | **Webhook (WP → Next.js) + verify-fallback** | Real-time, resilient to missed webhooks; consistent with the existing `password.changed` webhook pattern. Polling-only and shared-DB reads of `wc_orders` were rejected (slow / fragile to WC HPOS schema). |

## Context

- All five payment endpoints are 501 stubs today: `/api/v1/sessions/payment-{cancel,success,verify,webhook}` and `/api/v1/public/payment-verify`.
- `stripe` / `@stripe/stripe-js` in package.json and `src/lib/stripe.ts` are **dead scaffolding** from the 011-billing spec's Stripe-only MVP assumption (nothing imports the shim). Xendit un-defers that decision.
- Public booking creates an app-table `Appointment` with status **PENDING** (blocking statuses: PENDING, BOOKED, CHECK_IN). Guest access uses a stateless HMAC token (`src/lib/public/appointment-token.ts`).
- Staff billing runs on **legacy `wp_kc_bills`** via `src/services/billing/bill.service.ts` (marking paid ⇒ encounter status 0, `wp_kc_appointments` status 3). The app-table `Bill`/`Payment` Prisma models are unused by that flow; existence of their tables in the live DB is unverified.
- The old KiviCare `KCWooCommerce.php` gateway shows the WC order pattern: hidden virtual product per service, taxes as `WC_Order_Item_Fee`, appointment id in order meta, `get_checkout_payment_url()` for direct orders.
- The DB is the live WordPress DB (`praktiqu_wp314`). **Never `prisma db push` / `migrate dev`** — new tables via scoped SQL only.

## 1. Data flow

### Public / guest

1. Public booking creates `Appointment` PENDING (existing).
2. FE calls **`POST /api/v1/public/payments`** with the appointment HMAC token.
3. Next.js computes the expected total (service price string → integer rupiah, taxes via `TaxCalculator`), then calls plugin **`POST /praktiqu/v1/payments/order`** (service token).
4. Plugin creates a WC order directly (KiviCare `create_wc_direct_order` pattern: virtual product per service, tax fees), with meta `praktiqu_appointment_id`, `praktiqu_source=public`, `praktiqu_return_url`; returns `orderId` + `checkout_payment_url`.
5. Next.js records a `payment_orders` row (status `pending`), enqueues the auto-cancel job (+1 h), returns the checkout URL; FE redirects the patient.
6. Patient pays on the WP checkout page via the Xendit-WC gateway.
7. On completion the plugin redirects the patient to the FE status page (carrying the guest token) **and** fires the signed webhook (see §Confirmation).

### Staff / session

1. Receptionist/staff opens a bill/session and calls **`POST /api/v1/sessions/payment-verify`** (JWT, staff roles) with `encounter_id` / `bill_id`.
2. Same bridge: Next.js builds the amount from `wp_kc_bills`, creates the WC order (`praktiqu_source=session`), returns a payment link to share with the patient.

### Confirmation (webhook)

- Plugin hooks `woocommerce_order_status_changed` + `woocommerce_payment_complete`, **only** for orders with `praktiqu_appointment_id` meta, and dispatches `payment.completed` / `payment.failed` through the existing `dispatch_webhook()` (HMAC-SHA256, `X-PraktiQU-Webhook-Signature`).
- **`POST /api/v1/sessions/payment-webhook`** verifies the signature (constant-time), matches the paid amount against `payment_orders.expectedAmount`, rejects unknown orders, then transitions:
  - **public:** `Appointment` PENDING→BOOKED, `payment_orders.status`→`paid`, cancel the auto-cancel job.
  - **session:** `wp_kc_bills.payment_status`→`paid` + the same side effects as `bill.service.ts` (encounter status 0, `wp_kc_appointments` status 3).

### Verify fallback

- **`POST /api/v1/public/payment-verify`** (guest token) and the staff-side status check read `payment_orders`; if still `pending` > 2 minutes after redirect, Next.js queries plugin **`GET /praktiqu/v1/payments/order/{id}`** for live WC status and reconciles.

### Auto-cancel (1 h)

- On order creation, Next.js enqueues `praktiqu_payment_auto_cancel` (`runAt` +1 h) via the existing `/praktiqu/v1/jobs` endpoint.
- Handler fires webhook `payment.expired`; Next.js cancels the appointment **only if still PENDING** and asks the plugin to set the WC order `cancelled`.
- Xendit-WC gateway invoice expiry is configured to 1 hour to match.

## 2. WP plugin changes (`Wordpress-Plugin/praktiqu-endpoint`)

- New REST routes (service-token gated, same `Plugin::verify_service_token`):
  - `POST /praktiqu/v1/payments/order` — create the WC order; returns `{ orderId, checkoutUrl }`.
  - `GET /praktiqu/v1/payments/order/{id}` — order status for verify-fallback.
- New WC hooks → `Hooks::dispatch_webhook()` with events `payment.completed|failed|expired`.
- `Jobs`: register `praktiqu_payment_auto_cancel` handler and add it to the enqueue allowlist.
- **Own meta keys** (`praktiqu_*`, not `kivicare_*`) so KiviCare's order-status hooks never touch `wp_kc_appointments` with an app-table `Appointment` id (the two tables' ids can collide).

## 3. Next.js changes

- Fill the 501 stubs: `sessions/payment-webhook` (webhook receiver), `sessions/payment-verify` (staff create/check payment link), `sessions/payment-success|cancel` (thin redirect-outcome recorders), `public/payment-verify` (guest status check); new route `public/payments` (guest initiates payment).
- New `src/services/payments/payment.service.ts` — the only place owning the state machine `pending → paid | failed | expired | cancelled` (one-way transitions, guarded in SQL with `WHERE status='pending'`).
- WP endpoint client `src/lib/wp-endpoint.ts` (reuse the auth flow's client if one exists — check at implementation time).

## 4. Data model — `payment_orders` (scoped SQL, no prisma push)

| Column | Notes |
| --- | --- |
| `id` | PK |
| `source` | `public` \| `session` |
| `appointmentId` | nullable (public flow) |
| `billId`, `encounterId` | nullable (session flow) |
| `wcOrderId` | **UNIQUE** — idempotency anchor |
| `expectedAmount` | integer rupiah |
| `status` | `pending|paid|failed|expired|cancelled` |
| `transactionId` | gateway txn id from webhook |
| `paidAt`, `createdAt`, `updatedAt` | timestamps |
| `webhookPayload` | JSON, last received payload for audit |

Unique `wcOrderId` + guarded one-way status transitions make duplicate/replayed webhooks a no-op.

## 5. Security

- **New, separate `PAYMENT_WEBHOOK_SECRET`** — not `AUTH_SECRET` (which is due for rotation per the 2026-07-14 handover §7; rotating it kills outstanding guest links, so coordinate with this release). Secrets live in `.htaccess` SetEnv on staging, never committed.
- Constant-time HMAC verification (`crypto.timingSafeEqual`).
- Reject when paid amount ≠ `expectedAmount`; reject events for unknown `wcOrderId`.
- Guests can only initiate payment with the existing appointment HMAC token — no id enumeration.

## 6. Testing

TDD targets:

- Money math: price string → integer rupiah + tax application.
- Webhook signature verify/reject (including timing-safe path and empty-secret refusal).
- Idempotency: duplicate webhook ⇒ single transition.
- State machine: `paid` can never revert to `pending`; `expired` cannot override `paid`.
- Auto-cancel never cancels an appointment already BOOKED/CHECK_IN.

End-to-end on staging with Xendit **test mode**. The 8 pre-existing billing test failures (missing legacy `wp_kc_*` tables in the local test DB) are out of scope.

## Out of scope (tracked separately)

- Refunds/partial payments (state machine leaves room; not built now).
- The pending `.next` staging deploy of 5339a35 (SSH port 45022 unreachable from the dev sandbox).
- Secret rotation from handover §7 — should ship alongside this feature.
