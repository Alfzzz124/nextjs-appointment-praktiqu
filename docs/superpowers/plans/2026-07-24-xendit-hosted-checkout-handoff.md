# Xendit Hosted Checkout Hand-off Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make "Bayar sekarang" send the patient straight to a Xendit hosted invoice page (all enabled methods on one page) while still creating a real WooCommerce order, by having the `praktiqu-endpoint` plugin trigger the Xendit gateway server-side and return the `invoice_url`.

**Architecture:** All changes live in the WP plugin `Wordpress-Plugin/praktiqu-endpoint`. `create_order()` still builds the WC order, then resolves an enabled Xendit gateway, sets it as the order's payment method, calls its `process_payment()`, and returns the resulting `invoice_url` as `checkoutUrl`. A `woocommerce_get_return_url` filter sends the patient back to the app frontend after payment. Next.js is unchanged — it already sends `returnUrl` and returns whatever `checkoutUrl` the plugin gives.

**Tech Stack:** PHP 8.3 (WordPress mu-plugin), WooCommerce, Xendit WooCommerce plugin v5.1.9 (`woo-xendit-virtual-accounts`, Invoice API).

**Design spec:** `docs/superpowers/specs/2026-07-24-xendit-hosted-checkout-handoff-design.md`

## Global Constraints

- **Version bump: `1.3.0` → `1.4.0`** in `Wordpress-Plugin/praktiqu-endpoint/praktiqu-endpoint.php` (both the header `Version:` line and the `PRAKTIQU_ENDPOINT_VERSION` constant). `1.3.0` is already taken by the media endpoint.
- **The WC order MUST still be created** in every non-error path (user requirement). Never return a checkout URL without a persisted WC order behind it.
- **Do NOT edit the third-party Xendit plugin** (`Wordpress-Plugin/woo-xendit-virtual-accounts/**`) — changes there are lost on update. Only read it.
- **No PHP test harness exists** for this plugin (the repo's automated tests are vitest, for Next.js only). WooCommerce-runtime code (`wc_get_order`, `WC()->payment_gateways()`, `$gateway->process_payment()`) cannot run outside WordPress. Therefore per-task verification is **`php -l` (syntax gate)** plus the **staging smoke test in Task 3** (behavioral gate). Do not invent PHPUnit tests.
- **Cancel orphaned orders on failure** using WooCommerce core `$order->update_status('cancelled', ...)`, never the Xendit plugin's helper (keeps us decoupled).
- **Next.js is unchanged.** No files under `src/` are touched.
- **Prerequisite for smoke test (Task 3):** the staging server's Prisma client must already be regenerated with the `PaymentOrder` model (fix for the earlier `prisma.paymentOrder undefined` 500). Payment cannot work end-to-end until that is done.

## File Structure

- `Wordpress-Plugin/praktiqu-endpoint/includes/class-praktiqu-endpoint-payments.php` — **modify**: `create_order()` (return `invoice_url`, free-service skip, error→WP_Error+cancel), add private `resolve_xendit_gateway()`, register + add `filter_return_url()`.
- `Wordpress-Plugin/praktiqu-endpoint/praktiqu-endpoint.php` — **modify**: version bump.
- `Wordpress-Plugin/praktiqu-endpoint/readme.txt` — **modify**: changelog + stable tag.

---

### Task 1: `create_order()` returns the Xendit invoice URL

**Files:**
- Modify: `Wordpress-Plugin/praktiqu-endpoint/includes/class-praktiqu-endpoint-payments.php` (the `create_order()` return block, currently at lines 93-100; add a private helper method)

**Interfaces:**
- Consumes: `$input['returnUrl']` (already passed by Next.js `initiatePublicPayment`, `src/services/payments/payment.service.ts:230`); the WC order built earlier in `create_order()`.
- Produces: `create_order()` returns `['orderId' => int, 'checkoutUrl' => string]` where `checkoutUrl` is the Xendit `invoice_url` (or, for free services, the return URL); or `\WP_Error` on failure. Adds private `resolve_xendit_gateway(): ?\WC_Payment_Gateway`.

- [ ] **Step 1: Add the `resolve_xendit_gateway()` helper**

Add this private method to the `Payments` class (e.g., directly after `get_order_status()`):

```php
    /**
     * First enabled Xendit gateway (id prefixed with 'xendit'). The hosted
     * invoice shows every enabled Xendit method regardless of which gateway
     * triggers it, so the specific pick only sets the page's pre-highlighted
     * method.
     */
    private function resolve_xendit_gateway(): ?\WC_Payment_Gateway
    {
        if (!function_exists('WC') || !WC()->payment_gateways()) {
            return null;
        }
        foreach (WC()->payment_gateways()->payment_gateways() as $gateway) {
            if (strpos((string) $gateway->id, 'xendit') === 0 && $gateway->enabled === 'yes') {
                return $gateway;
            }
        }
        return null;
    }
```

- [ ] **Step 2: Replace the `create_order()` return block**

Find the tail of `create_order()`:

```php
        $order->calculate_totals();
        $order->save();

        return [
            'orderId'     => $order->get_id(),
            'checkoutUrl' => $order->get_checkout_payment_url(),
        ];
    }
```

Replace everything from `return [` through the method-closing `}` with:

```php
        // Free service (total 0, below Xendit's minimum): no invoice. Complete
        // the order so our woocommerce_order_status_changed hook books the slot,
        // and send the patient straight to the return URL.
        if ((float) $order->get_total() <= 0) {
            $order->payment_complete();
            return [
                'orderId'     => $order->get_id(),
                'checkoutUrl' => (string) ($input['returnUrl'] ?? $order->get_checkout_order_received_url()),
            ];
        }

        $gateway = $this->resolve_xendit_gateway();
        if ($gateway === null) {
            $order->update_status('cancelled', 'PraktiQU: no enabled Xendit gateway');
            return new \WP_Error('xendit_gateway_missing', 'No enabled Xendit payment gateway', ['status' => 503]);
        }

        // process_payment() early-returns unless the order's payment method
        // resolves to this gateway (woo-xendit class-wc-xendit-invoice.php:1022),
        // so set it first.
        $order->set_payment_method($gateway);
        $order->save();

        // Xendit's process_payment() adds a WC notice and returns null on failure
        // (class-wc-xendit-invoice.php:1108). Clear stale notices so we read only
        // this call's error.
        if (function_exists('wc_clear_notices')) {
            wc_clear_notices();
        }

        $result = $gateway->process_payment($order->get_id());

        if (!is_array($result) || ($result['result'] ?? '') !== 'success' || empty($result['redirect'])) {
            $message = 'Failed to create Xendit invoice';
            if (function_exists('wc_get_notices')) {
                $errors = wc_get_notices('error');
                if (!empty($errors)) {
                    $first = $errors[0];
                    $message = is_array($first) ? ($first['notice'] ?? $message) : (string) $first;
                }
                wc_clear_notices();
            }
            $order->update_status('cancelled', 'PraktiQU: Xendit invoice creation failed');
            return new \WP_Error('xendit_invoice_failed', $message, ['status' => 502]);
        }

        return [
            'orderId'     => $order->get_id(),
            'checkoutUrl' => (string) $result['redirect'],
        ];
    }
```

- [ ] **Step 3: Syntax-check the file**

Run: `php -l Wordpress-Plugin/praktiqu-endpoint/includes/class-praktiqu-endpoint-payments.php`
Expected: `No syntax errors detected`
(If `php` is not installed locally, run this on the staging server in Task 3 before swapping the plugin in.)

- [ ] **Step 4: Commit**

```bash
git add Wordpress-Plugin/praktiqu-endpoint/includes/class-praktiqu-endpoint-payments.php
git commit -m "feat(payments): return Xendit hosted invoice URL from create_order"
```

---

### Task 2: Return-to-FE filter + version bump

**Files:**
- Modify: `Wordpress-Plugin/praktiqu-endpoint/includes/class-praktiqu-endpoint-payments.php` (`register()` at lines 24-28; add `filter_return_url()` handler)
- Modify: `Wordpress-Plugin/praktiqu-endpoint/praktiqu-endpoint.php` (version)
- Modify: `Wordpress-Plugin/praktiqu-endpoint/readme.txt` (changelog)

**Interfaces:**
- Consumes: `is_praktiqu_order(\WC_Order): bool` (existing, line 163); the `praktiqu_return_url` order meta set in `create_order()` (existing, lines 86-88).
- Produces: WooCommerce `woocommerce_get_return_url` now yields the FE URL for praktiqu orders, so the Xendit invoice's `success_redirect_url` lands on the app frontend.

- [ ] **Step 1: Register the filter**

In `register()`, add after the two existing `add_action(...)` lines:

```php
        add_filter('woocommerce_get_return_url', [$this, 'filter_return_url'], 10, 2);
```

- [ ] **Step 2: Add the `filter_return_url()` handler**

Add this public method to the `Payments` class (e.g., after `resolve_xendit_gateway()`):

```php
    /**
     * Send praktiqu orders back to the app frontend after payment instead of
     * the WooCommerce order-received page. Consumes the praktiqu_return_url meta
     * set in create_order(). Non-praktiqu orders are left untouched.
     *
     * @param string    $return_url
     * @param \WC_Order|null $order
     */
    public function filter_return_url(string $return_url, $order): string
    {
        if (!$order instanceof \WC_Order || !$this->is_praktiqu_order($order)) {
            return $return_url;
        }
        $fe = (string) $order->get_meta('praktiqu_return_url');
        return $fe !== '' ? $fe : $return_url;
    }
```

- [ ] **Step 3: Bump the plugin version to 1.4.0**

In `Wordpress-Plugin/praktiqu-endpoint/praktiqu-endpoint.php`, change the header line:

```php
 * Version:           1.3.0
```
to:
```php
 * Version:           1.4.0
```

and the constant:

```php
define('PRAKTIQU_ENDPOINT_VERSION', '1.3.0');
```
to:
```php
define('PRAKTIQU_ENDPOINT_VERSION', '1.4.0');
```

- [ ] **Step 4: Update readme changelog**

In `Wordpress-Plugin/praktiqu-endpoint/readme.txt`, update the `Stable tag:` to `1.4.0` and add a changelog entry near the top of the `== Changelog ==` section:

```
= 1.4.0 =
* Payment hand-off now returns the Xendit hosted invoice URL (all enabled
  methods on one page) instead of the WooCommerce order-pay page. WC order is
  still created. Patients return to the app frontend on success via
  woocommerce_get_return_url.
```

- [ ] **Step 5: Syntax-check the changed PHP**

Run: `php -l Wordpress-Plugin/praktiqu-endpoint/includes/class-praktiqu-endpoint-payments.php && php -l Wordpress-Plugin/praktiqu-endpoint/praktiqu-endpoint.php`
Expected: `No syntax errors detected` for both.
(If `php` is absent locally, defer to the server run in Task 3.)

- [ ] **Step 6: Commit**

```bash
git add Wordpress-Plugin/praktiqu-endpoint/includes/class-praktiqu-endpoint-payments.php Wordpress-Plugin/praktiqu-endpoint/praktiqu-endpoint.php Wordpress-Plugin/praktiqu-endpoint/readme.txt
git commit -m "feat(payments): return patients to the frontend after Xendit payment; bump to 1.4.0"
```

---

### Task 3: Deploy to staging and smoke-test

**Files:** none (deployment + verification only).

**Prerequisite:** the staging Prisma client is already regenerated with the `PaymentOrder` model (otherwise `/public/payments` 500s before reaching the plugin). Confirm first (see Step 2).

**Interfaces:**
- Consumes: the committed plugin at v1.4.0.
- Produces: v1.4.0 live on `appointment.praktiqu.com`; a verified hosted-checkout hand-off.

- [ ] **Step 1: Package and upload the plugin, then `php -l` on the server**

Use the staging SSH key (host `101.50.1.106:45022`, user `praktiqu`; native `ssh -i <pem-key>` works — see memory `staging-deploy-mechanics`). Upload the plugin dir to `~/deploy-tmp`, extract, and lint every file with the server PHP (`/usr/local/bin/php`, 8.3):

```bash
for f in $(find ~/deploy-tmp/praktiqu-endpoint -name '*.php'); do /usr/local/bin/php -l "$f"; done
```
Expected: `No syntax errors detected` for every file. Do not proceed if any file fails.

- [ ] **Step 2: Confirm the Prisma prerequisite**

```bash
grep -c paymentOrder ~/staging2.praktiqu.com/node_modules/.prisma/client/index.d.ts
```
Expected: a non-zero count. If `0`, stop and regenerate the Prisma client with the `PaymentOrder` model first — the smoke test will 500 otherwise.

- [ ] **Step 3: Back up and swap the plugin in**

```bash
MU=~/appointment.praktiqu.com/wp-content/mu-plugins
STAMP=$(date +%Y%m%d-%H%M%S)
cp -a "$MU/praktiqu-endpoint" "$MU/praktiqu-endpoint.bak-$STAMP"
rm -rf "$MU/praktiqu-endpoint" && cp -a ~/deploy-tmp/praktiqu-endpoint "$MU/praktiqu-endpoint"
```

- [ ] **Step 4: Verify the plugin booted at 1.4.0 (no fatal)**

```bash
curl -4 -s -H 'X-PraktiQU-Service-Token: <WORDPRESS_SERVICE_TOKEN>' \
  https://appointment.praktiqu.com/wp-json/praktiqu/v1/health
```
Expected: JSON with `"version":"1.4.0"`. A fatal in mu-plugins would break the whole WP site — if this is not 200/1.4.0, roll back by restoring `praktiqu-endpoint.bak-$STAMP`.

- [ ] **Step 5: Behavioral smoke test (hosted-checkout hand-off)**

Create a real public booking (PENDING) via the booking flow, then request payment. From the FE or with the appointment guest token, call:

```bash
curl -4 -s -X POST https://staging2.praktiqu.com/api/v1/public/payments \
  -H 'Content-Type: application/json' \
  --data-raw '{"token":"<appointment-guest-token>"}' -w '\nHTTP=%{http_code}\n'
```
Expected: HTTP 200 with a `checkoutUrl` that is a **Xendit hosted invoice URL** (e.g. `https://checkout.xendit.co/...` or `https://checkout-staging.xendit.co/...`), NOT a `.../checkout/order-pay/...` WooCommerce URL. Confirm a WC order row exists (`praktiqu_appointment_id` meta present) and a `payment_orders` row was written.

- [ ] **Step 6: End-to-end confirmation (test mode)**

Pay the invoice in Xendit **test mode**. Confirm: the appointment transitions `PENDING → BOOKED`, the `payment_orders` row flips to `paid`, and the browser lands on the **app frontend** success URL (not the WooCommerce order-received page).

- [ ] **Step 7: Clean up server temp**

```bash
rm -rf ~/deploy-tmp/praktiqu-endpoint ~/deploy-tmp/*.tar.gz
```

---

## Notes / risks

- `process_payment()` touches WooCommerce session/cart (`WC()->cart`, notices). In the REST context these may be thin; the code guards with `function_exists`/null checks, but **Step 5 is the real proof** it works server-side. If `process_payment()` returns `null` on staging with a valid enabled gateway, capture `stderr.log` and the cancelled order's notes to see the Xendit error message.
- Which Xendit methods appear on the hosted page is controlled entirely by **WooCommerce → Xendit settings** (enabled gateways), not by this code. Enable the desired methods there. Invoice expiry should remain **1 hour** to match `AUTO_CANCEL_MS`.
- Failure/cancel still lands on the WooCommerce checkout page (accepted technical debt; tracked separately).
