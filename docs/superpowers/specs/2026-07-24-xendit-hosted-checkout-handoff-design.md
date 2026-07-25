# Xendit Hosted Checkout Hand-off — Design

**Date:** 2026-07-24
**Status:** Approved (user, 2026-07-24)
**Supersedes the hand-off step of:** `2026-07-14-appointment-payment-xendit-woocommerce-design.md`

## Problem

Today "Bayar sekarang" sends the patient to the WooCommerce **order-pay** page (`get_checkout_payment_url()`), where they must pick a method before reaching Xendit. The user wants the patient to land **straight on a Xendit hosted payment page** (all enabled methods on one page), while **still creating a real WooCommerce order** (disbursement depends on WC order data).

## Feasibility (confirmed by reading the plugin)

The active `woo-xendit-virtual-accounts` plugin is the full **Xendit plugin v5.1.9** (`WC_Xendit_PG`), Invoice-API based. Its base gateway `WC_Xendit_Invoice::process_payment()` (`libs/class-wc-xendit-invoice.php:985`) calls `createInvoice()` with `payment_methods = extract_enabled_payments()` (all enabled methods) and returns `['result' => 'success', 'redirect' => $invoice_url]`. The invoice is tied to the WC order via `external_id`, so **disbursement data is preserved**. Hosted checkout is therefore fully supported.

## Decision

**Approach A — trigger the invoice server-side inside our `praktiqu-endpoint` plugin.** Chosen over (B) calling the Xendit Invoice API directly from Next.js (duplicates the plugin, needs our own Xendit keys/signature, risks disbursement drift) and (C) auto-submitting the WC pay page (hacky/fragile). A is the smallest change and reuses the proven Xendit engine.

**The WC order is still created** — non-negotiable, and A does exactly that (create order → then invoice, invoice references the order).

## Design

All changes live in the WP plugin `Wordpress-Plugin/praktiqu-endpoint`. **Next.js has no logic change.**

### 1. `create_order()` returns the Xendit invoice URL
After the existing `wc_create_order()` + product/tax/meta setup + `calculate_totals()` + `save()`:
1. Resolve one **enabled** Xendit gateway (`xendit_*`) from `WC()->payment_gateways()`; set it as the order's payment method.
2. Call `$gateway->process_payment($order->get_id())`.
3. On `result === 'success'`, return `['orderId' => $order->get_id(), 'checkoutUrl' => $result['redirect']]` — the `invoice_url`.

The hosted page shows every method enabled in **WooCommerce → Xendit settings** (no per-request method selection needed).

### 2. Return-to-FE on success
Add a `woocommerce_get_return_url` filter in the plugin: if the order has `praktiqu_return_url` meta, return it. This makes the invoice's `success_redirect_url` land on our FE. Next.js already sends `returnUrl` (`payment.service.ts:230`) and the plugin already stores it as `praktiqu_return_url` — this change only **consumes** it.

### 3. Next.js — unchanged
`/public/payments` and `/sessions/payment-verify` already return whatever `checkoutUrl` the plugin gives; it is now the `invoice_url`. Money math, `payment_orders`, the 1-hour auto-cancel job, and the confirmation webhook are all untouched.

### Post-payment flow (unchanged)
Patient pays on Xendit → Xendit callback → Xendit plugin marks the WC order `paid` → our `woocommerce_order_status_changed` hook → `payment.completed` webhook → `PENDING → BOOKED`.

## Edge cases & error handling

- **Free service (price 0):** skip Xendit entirely (invoice minimum ≈ IDR 10,000) and treat as booked. Enforced before invoice creation.
- **Invoice creation fails** (Xendit error, no enabled Xendit gateway, amount below minimum): `create_order()` returns a `WP_Error` **and cancels the just-created WC order**, so Next.js surfaces a clean error and no orphan order is left holding a slot.
- **Idempotency:** the Xendit plugin reuses an existing non-expired invoice for the same order (`class-wc-xendit-invoice.php:1057`), so a repeated call does not double-create.

## Known limitation → technical debt (accepted by user)

The Xendit plugin **hardcodes** `failure_redirect_url = wc_get_checkout_url()` (`class-wc-xendit-invoice.php:1038`), with no filter. So **success → FE** (clean), but **failure/cancel → WooCommerce checkout page** (off-brand). Routing failure to the FE would require editing the third-party plugin (lost on update) or a bounce page — deferred as technical debt. Acceptable because the FE polls `/public/payment-verify` and the appointment auto-cancels within 1 hour regardless. Tracked as a separate follow-up task.

## Testing

Change is PHP-only in our plugin:
- `php -l` on all changed plugin files.
- Staging smoke test: public booking → `POST /public/payments` → confirm the returned `checkoutUrl` is a Xendit `invoice_url` → pay in Xendit **test mode** → confirm `PENDING → BOOKED` and that the patient lands on the FE success URL.
- Next.js money-math tests (`computePublicAmount`, webhook signature) are unchanged and must stay green.

Plugin version bumps **1.3.0 → 1.4.0** (repo is already at 1.3.0 from the media endpoint).

## Out of scope

- Failure/cancel-to-FE routing (technical debt above).
- Session/staff flow UX (same `create_order` path already benefits; no separate work).
- Any change to disbursement, `payment_orders`, or the webhook/auto-cancel machinery.
