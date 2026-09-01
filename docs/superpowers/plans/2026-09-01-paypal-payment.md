# PayPal + Card Payment Methods Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `paypal` and `card` payment methods alongside the existing Xendit method, charging in USD converted from rupiah, without touching the Xendit path or the post-payment machinery.

**Architecture:** The WooCommerce PayPal Payments (PPCP) plugin is already installed and connected on `appointment.praktiqu.com`, and it can be driven server-side: with no PayPal order in session its gateway creates one and returns `['result' => 'success', 'redirect' => <url>]` — the same shape the Xendit gateway returns, which our `praktiqu-endpoint` plugin's `create_order()` already consumes. So the work is (a) generalizing gateway resolution from "the Xendit one" to "the one this method names", (b) creating PayPal orders in USD because PayPal does not support IDR, and (c) teaching the Next.js side to carry a method in and charged-amount figures back out. Capture, the `payment.completed` webhook, and `PENDING → BOOKED` are untouched.

**Tech Stack:** Next.js App Router (route handlers under `src/app/api/v1/`), Prisma + MySQL, Vitest, and a WordPress plugin in `Wordpress-Plugin/praktiqu-endpoint/` (PHP 7.4+, namespace `PraktiQU\Endpoint`, `declare(strict_types=1)`).

**Spec:** `docs/superpowers/specs/2026-09-01-paypal-payment-design.md`

## Global Constraints

- **Never run `prisma db push` or `prisma migrate dev`.** `DATABASE_URL` points at the live WordPress database; the schema mixes app tables with KiviCare `wp_*` tables that `schema.prisma` does not describe. Schema changes go in `prisma/manual/*.sql`, applied by hand.
- **`expectedAmount` stays integer rupiah and remains the source of truth.** Nothing in this plan changes `computePublicAmount` or `computeSessionAmountFromBill`.
- **`method` defaults to `'xendit'` everywhere.** Every existing caller and every existing row must behave exactly as before. An unrecognised method is an error, never a silent fallback.
- **Foreign-currency rounding is always UP**, per line, using `ceil(round($x * 100, 6)) / 100`. The inner `round(…, 6)` is required, not decorative.
- **FX rate: `18000` IDR per 1 USD**, stored in wp-admin. The rate is a divisor, so a rate above market charges the payer fewer dollars.
- **Allowed methods: `xendit`, `paypal`, `card`.** `paypal` and `card` both resolve to the `ppcp-gateway` gateway.
- **Plugin version goes `1.4.0` → `1.5.0`** in exactly two places: the `Version:` header line and the `PRAKTIQU_ENDPOINT_VERSION` define, both in `Wordpress-Plugin/praktiqu-endpoint/praktiqu-endpoint.php`.
- **Do not edit any file under `wp-content/plugins/woocommerce-paypal-payments/`.** Third-party; changes are lost on update. Use its documented filters.
- **Do not edit anything under `Front-End Laravel/`.** Rafiq maintains it; it is read-only reference.
- **Baseline to preserve:** `npx vitest run tests/payments/` is 7 files / 65 tests, all passing. It must stay green after every task.

### Commands you will need

Run the payment test suite:

```bash
npx vitest run tests/payments/
```

Lint every PHP file in the plugin. There is no PHP binary in WSL, so this goes through Docker. A bind mount from a WSL path comes up **empty**, so the source is piped in as a tar; and the Docker credential helper on this machine is broken, so `DOCKER_CONFIG` must point at a directory whose `config.json` is `{}`. This exact command is verified working:

```bash
SP=/tmp/claude-1000/-home-ahmad-projects-nextjs-appointment-praktiqu/php-lint; mkdir -p "$SP/dockercfg" && echo '{}' > "$SP/dockercfg/config.json" && export DOCKER_CONFIG="$SP/dockercfg" && tar cf - Wordpress-Plugin/praktiqu-endpoint | docker run --rm -i php:8.3-cli sh -c 'mkdir -p /src && tar xf - -C /src && find /src -name "*.php" -exec php -l {} \;' | grep -v "No syntax errors"
```

Expected output: nothing (every file lints clean). Any line printed is a syntax error.

Run the plugin's pure-PHP unit test (created in Task 2):

```bash
SP=/tmp/claude-1000/-home-ahmad-projects-nextjs-appointment-praktiqu/php-lint; export DOCKER_CONFIG="$SP/dockercfg" && tar cf - Wordpress-Plugin/praktiqu-endpoint | docker run --rm -i php:8.3-cli sh -c 'mkdir -p /src && tar xf - -C /src && php /src/Wordpress-Plugin/praktiqu-endpoint/tests/test-money.php'
```

## File Structure

**Created:**

| File | Responsibility |
| --- | --- |
| `prisma/manual/2026-09-01-paypal-payment-orders.sql` | Adds four columns to `payment_orders`. Applied by hand per environment. |
| `Wordpress-Plugin/praktiqu-endpoint/includes/class-praktiqu-endpoint-money.php` | Pure currency conversion. No WordPress or WooCommerce calls, so it is unit-testable in a bare PHP container. |
| `Wordpress-Plugin/praktiqu-endpoint/tests/test-money.php` | Assertion script for the above. No PHPUnit dependency. |
| `docs/api/PAYMENT-METHODS-GUIDE.md` | Request/response contract handed to the front-end team. |
| `docs/deploy/paypal-payment-runbook.md` | Sandbox test procedure and deployment order. |

**Modified:**

| File | Change |
| --- | --- |
| `prisma/schema.prisma` (`model PaymentOrder`, ~line 959) | Four new fields mirroring the SQL. |
| `.../includes/class-praktiqu-endpoint-settings.php` | Register + render the FX rate field. |
| `.../includes/class-praktiqu-endpoint-payments.php` | Method routing, gateway resolution, USD conversion, card landing page, currency-aware webhook payload. |
| `.../praktiqu-endpoint.php` | Load the Money class; bump version to 1.5.0. |
| `src/lib/wp-endpoint.ts` | `method` in `CreateWcOrderInput`; charged figures in `CreateWcOrderResult`. |
| `src/services/payments/payment.service.ts` | `method` params, persist charged figures, currency-aware amount checks, extended `PaymentStatusView`. |
| `src/app/api/v1/public/payments/route.ts` | Accept `method`. |
| `src/app/api/v1/sessions/payment-verify/route.ts` | Accept `method`. |
| `docs/api/openapi.yaml` | `method` on both request bodies; charged figures on both response schemas. |

**Tests:** `tests/payments/wp-endpoint.test.ts`, `tests/payments/payment-service.test.ts`, `tests/payments/state-machine.test.ts`, `tests/payments/public-routes.test.ts`, `tests/payments/session-routes.test.ts` (all existing files, extended).

---

### Task 1: Database columns and Prisma model

**Files:**
- Create: `prisma/manual/2026-09-01-paypal-payment-orders.sql`
- Modify: `prisma/schema.prisma` (`model PaymentOrder`, around line 959)

**Interfaces:**
- Consumes: nothing.
- Produces: four Prisma fields on `PaymentOrder` — `gateway: string` (default `'xendit'`), `chargedCurrency: string` (default `'IDR'`), `chargedAmount: Decimal | null`, `fxRate: Decimal | null`. Tasks 9 and 10 read and write these. `chargedAmount` and `fxRate` come back from Prisma as `Decimal` objects, not numbers — convert with `toNum()` from `@/lib/kc-num`, which handles them because `String(decimal)` yields `"12.35"`.

- [ ] **Step 1: Write the scoped SQL**

Create `prisma/manual/2026-09-01-paypal-payment-orders.sql`:

```sql
-- PayPal/card payment support: record what was actually charged, in what currency.
-- Apply by hand, per environment:
--   mysql -u <user> -p <database> < prisma/manual/2026-09-01-paypal-payment-orders.sql
--
-- Written out rather than generated because this database also holds KiviCare's
-- wp_* tables, and `prisma db push` would try to reconcile them against a schema
-- that does not describe them.
--
-- Every column has a default or is nullable, so existing rows stay valid with no
-- backfill: they are all Xendit orders charged in rupiah, and `expectedAmount`
-- already holds their amount.
ALTER TABLE `payment_orders`
  ADD COLUMN `gateway`         varchar(32)   NOT NULL DEFAULT 'xendit' AFTER `wcOrderId`,
  ADD COLUMN `chargedCurrency` varchar(3)    NOT NULL DEFAULT 'IDR'    AFTER `gateway`,
  ADD COLUMN `chargedAmount`   decimal(12,2)     NULL                  AFTER `chargedCurrency`,
  ADD COLUMN `fxRate`          decimal(12,2)     NULL                  AFTER `chargedAmount`;
```

- [ ] **Step 2: Add the fields to the Prisma model**

In `prisma/schema.prisma`, inside `model PaymentOrder`, insert these four lines immediately after the `wcOrderId` line:

```prisma
  gateway         String    @default("xendit") @db.VarChar(32) // 'xendit' | 'paypal' | 'card'
  chargedCurrency String    @default("IDR") @db.VarChar(3)
  // What the payer was actually billed. Equals expectedAmount for IDR orders;
  // for PayPal/card it is the ceiling-converted USD figure. NULL on rows that
  // predate this column — treat NULL as "expectedAmount, in IDR".
  chargedAmount   Decimal?  @db.Decimal(12, 2)
  fxRate          Decimal?  @db.Decimal(12, 2) // rupiah per 1 USD at charge time
```

- [ ] **Step 3: Validate the schema**

Run: `npx prisma validate`
Expected: `The schema at prisma/schema.prisma is valid 🚀`

- [ ] **Step 4: Regenerate the Prisma client**

Run: `npx prisma generate`
Expected: `Generated Prisma Client ... in <n>ms`

- [ ] **Step 5: Confirm the existing suite still compiles and passes**

Run: `npx vitest run tests/payments/`
Expected: 7 files, 65 tests, all passing.

- [ ] **Step 6: Commit**

```bash
git add prisma/manual/2026-09-01-paypal-payment-orders.sql prisma/schema.prisma
git commit -m "feat(payments): record gateway and charged amount on payment_orders

PayPal cannot be charged in IDR, so an order's charge may differ from its
rupiah expectedAmount in both figure and currency. Four columns capture what
was actually billed; all default or nullable so existing Xendit rows need no
backfill.

Scoped SQL rather than a Prisma migration: DATABASE_URL is the WordPress
database and the schema does not describe its wp_ tables."
```

---

### Task 2: Plugin — pure currency conversion

**Files:**
- Create: `Wordpress-Plugin/praktiqu-endpoint/includes/class-praktiqu-endpoint-money.php`
- Create: `Wordpress-Plugin/praktiqu-endpoint/tests/test-money.php`
- Modify: `Wordpress-Plugin/praktiqu-endpoint/praktiqu-endpoint.php` (the `require_once` block, around line 26)

**Interfaces:**
- Consumes: nothing.
- Produces: `\PraktiQU\Endpoint\Money::idr_to_foreign(float $idr, float $rate): float` — rounds **up** to 2 decimals; throws `\InvalidArgumentException` when `$rate <= 0`. Task 5 calls it for every line item and every tax.

- [ ] **Step 1: Write the failing test**

Create `Wordpress-Plugin/praktiqu-endpoint/tests/test-money.php`:

```php
<?php
/**
 * Assertions for Money::idr_to_foreign(). Plain PHP — no PHPUnit, no WordPress —
 * so it runs in a bare `php:8.3-cli` container. See the plan's command list.
 */

declare(strict_types=1);

define('PRAKTIQU_ENDPOINT_MONEY_TEST', true);
require_once __DIR__ . '/../includes/class-praktiqu-endpoint-money.php';

use PraktiQU\Endpoint\Money;

$failures = 0;

function check(string $label, $actual, $expected): void
{
    global $failures;
    if ($actual === $expected) {
        echo "  ok   {$label}\n";
        return;
    }
    $failures++;
    echo "  FAIL {$label}: expected " . var_export($expected, true)
        . ', got ' . var_export($actual, true) . "\n";
}

echo "Money::idr_to_foreign\n";

// Exact division must not be inflated by a spurious cent. 180000/18000 = 10.00
// exactly; a naive ceil($x * 100) / 100 returns 10.01 here on some platforms.
check('exact division stays exact', Money::idr_to_foreign(180000, 18000), 10.0);

// 200000/18000 = 11.111... → rounds UP to 11.12, never down to 11.11.
check('rounds up, not to nearest', Money::idr_to_foreign(200000, 18000), 11.12);

// 150000/18000 = 8.333... → 8.34
check('rounds up a third', Money::idr_to_foreign(150000, 18000), 8.34);

// A sub-cent amount still costs a full cent rather than becoming free.
check('tiny amount becomes one cent', Money::idr_to_foreign(1, 18000), 0.01);

check('zero stays zero', Money::idr_to_foreign(0, 18000), 0.0);

// A tax line, to prove the same helper serves both item and tax amounts.
check('tax line converts', Money::idr_to_foreign(20000, 18000), 1.12);

echo "\nMoney::idr_to_foreign rejects a bad rate\n";

foreach ([0.0, -1.0] as $bad) {
    $threw = false;
    try {
        Money::idr_to_foreign(100000, $bad);
    } catch (\InvalidArgumentException $e) {
        $threw = true;
    }
    check('rate ' . $bad . ' throws', $threw, true);
}

echo "\n" . ($failures === 0 ? "ALL PASS\n" : "{$failures} FAILURE(S)\n");
exit($failures === 0 ? 0 : 1);
```

- [ ] **Step 2: Run it to verify it fails**

```bash
SP=/tmp/claude-1000/-home-ahmad-projects-nextjs-appointment-praktiqu/php-lint; mkdir -p "$SP/dockercfg" && echo '{}' > "$SP/dockercfg/config.json" && export DOCKER_CONFIG="$SP/dockercfg" && tar cf - Wordpress-Plugin/praktiqu-endpoint | docker run --rm -i php:8.3-cli sh -c 'mkdir -p /src && tar xf - -C /src && php /src/Wordpress-Plugin/praktiqu-endpoint/tests/test-money.php'
```

Expected: a PHP fatal error — `Failed to open stream` for `class-praktiqu-endpoint-money.php`, because the class does not exist yet.

- [ ] **Step 3: Write the implementation**

Create `Wordpress-Plugin/praktiqu-endpoint/includes/class-praktiqu-endpoint-money.php`:

```php
<?php
/**
 * Money — pure currency arithmetic.
 *
 * Deliberately free of WordPress and WooCommerce calls so the conversion can be
 * unit-tested in a bare PHP container (tests/test-money.php) rather than only
 * through a live WooCommerce order.
 *
 * @package PraktiQU\Endpoint
 */

declare(strict_types=1);

namespace PraktiQU\Endpoint;

// The test harness defines PRAKTIQU_ENDPOINT_MONEY_TEST so this file can be
// required outside WordPress. Everything else still exits without ABSPATH.
defined('ABSPATH') || defined('PRAKTIQU_ENDPOINT_MONEY_TEST') || exit;

final class Money
{
    /**
     * Convert rupiah to a 2-decimal foreign amount, always rounding UP.
     *
     * Rounding up is deliberate (2026-09-01 design, decision 6): the sub-cent
     * remainder accrues to the clinic instead of shaving the charge.
     *
     * The inner round(..., 6) guards against binary-float error inflating an
     * exact value. Without it, (10.0 * 100) can evaluate to 1000.0000000001,
     * and ceil() would turn an exact $10.00 into $10.01.
     *
     * @param float $idr  Amount in rupiah.
     * @param float $rate Rupiah per 1 unit of the target currency; must be > 0.
     *
     * @throws \InvalidArgumentException When the rate is zero or negative.
     */
    public static function idr_to_foreign(float $idr, float $rate): float
    {
        if ($rate <= 0) {
            throw new \InvalidArgumentException('FX rate must be greater than zero');
        }
        return ceil(round(($idr / $rate) * 100, 6)) / 100;
    }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Use the same command as Step 2.
Expected: every line prefixed `ok`, then `ALL PASS`, exit 0.

- [ ] **Step 5: Load the class in the plugin bootstrap**

In `Wordpress-Plugin/praktiqu-endpoint/praktiqu-endpoint.php`, add this line to the `require_once` block immediately **before** the `class-praktiqu-endpoint-payments.php` line (Payments is its only consumer):

```php
require_once PRAKTIQU_ENDPOINT_PATH . 'includes/class-praktiqu-endpoint-money.php';
```

- [ ] **Step 6: Lint every PHP file**

Run the `php -l` command from the plan's command list.
Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add Wordpress-Plugin/praktiqu-endpoint/includes/class-praktiqu-endpoint-money.php Wordpress-Plugin/praktiqu-endpoint/tests/test-money.php Wordpress-Plugin/praktiqu-endpoint/praktiqu-endpoint.php
git commit -m "feat(payments): add Money::idr_to_foreign with ceiling rounding

PayPal has no IDR, so PayPal orders must be priced in USD. The conversion
rounds up so the sub-cent remainder falls to the clinic rather than shaving
the charge.

The inner round(x, 6) before ceil() is load-bearing: without it an exact
\$10.00 can become \$10.01 through binary-float error.

Kept free of WordPress calls so it can be tested in a bare PHP container --
the plugin has no PHPUnit setup, and a fatal in a WordPress plugin takes the
whole site down, so cheap verification matters."
```

---

### Task 3: Plugin — the FX rate setting

**Files:**
- Modify: `Wordpress-Plugin/praktiqu-endpoint/includes/class-praktiqu-endpoint-settings.php` (`register_settings()` around line 41; the settings form, after the payment-webhook-secret `</tr>` around line 227)

**Interfaces:**
- Consumes: nothing.
- Produces: WordPress option `praktiqu_endpoint_paypal_idr_rate` (string, default `'18000'`) and `praktiqu_endpoint_paypal_idr_rate_updated` (string, a `gmdate('c')` timestamp). Task 5 reads the rate with `(float) get_option('praktiqu_endpoint_paypal_idr_rate', '0')`.

- [ ] **Step 1: Register the setting**

In `register_settings()`, append after the `praktiqu_endpoint_payment_webhook_secret` block:

```php
        register_setting(self::OPTION_GROUP, 'praktiqu_endpoint_paypal_idr_rate', [
            'type'              => 'string',
            'sanitize_callback' => [$this, 'sanitize_fx_rate'],
            'default'           => '18000',
        ]);
```

- [ ] **Step 2: Add the sanitizer**

Add this method immediately after `sanitize_payment_secret()`:

```php
    /**
     * Keep the FX rate a positive number, and stamp when it last changed so a
     * stale rate is visible on the settings screen rather than silent.
     *
     * A rejected value keeps the stored one: a blank or malformed submission
     * must not zero the rate, because Payments::create_order() treats a
     * non-positive rate as a hard failure and would refuse every PayPal order.
     */
    public function sanitize_fx_rate(string $value): string
    {
        $current = (string) get_option('praktiqu_endpoint_paypal_idr_rate', '18000');
        $trimmed = trim($value);
        if ($trimmed === '' || !is_numeric($trimmed) || (float) $trimmed <= 0) {
            return $current;
        }
        if ($trimmed !== $current) {
            update_option('praktiqu_endpoint_paypal_idr_rate_updated', gmdate('c'));
        }
        return $trimmed;
    }
```

- [ ] **Step 3: Render the field**

In the settings form, immediately after the closing `</tr>` of the Payment Webhook Secret row and **before** the `</table>` that follows it, insert:

```php
                    <tr>
                        <th scope="row">
                            <label for="praktiqu_endpoint_paypal_idr_rate"><?php esc_html_e('PayPal FX Rate (IDR per 1 USD)', 'praktiqu-endpoint'); ?></label>
                        </th>
                        <td>
                            <input
                                type="text"
                                id="praktiqu_endpoint_paypal_idr_rate"
                                name="praktiqu_endpoint_paypal_idr_rate"
                                value="<?php echo esc_attr((string) get_option('praktiqu_endpoint_paypal_idr_rate', '18000')); ?>"
                                class="regular-text"
                                placeholder="18000"
                            />
                            <p class="description">
                                <?php esc_html_e('PayPal does not support IDR, so PayPal and card orders are charged in USD. This rate divides: a HIGHER rate charges the payer FEWER dollars. At 18000, a Rp 200.000 service is charged $11.12.', 'praktiqu-endpoint'); ?>
                                <?php
                                $rate_updated = (string) get_option('praktiqu_endpoint_paypal_idr_rate_updated', '');
                                if ($rate_updated !== '') {
                                    echo '<br/>' . esc_html(sprintf(
                                        /* translators: %s is an ISO-8601 timestamp. */
                                        __('Last changed: %s', 'praktiqu-endpoint'),
                                        $rate_updated
                                    ));
                                }
                                ?>
                            </p>
                        </td>
                    </tr>
```

- [ ] **Step 4: Lint every PHP file**

Run the `php -l` command from the plan's command list.
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add Wordpress-Plugin/praktiqu-endpoint/includes/class-praktiqu-endpoint-settings.php
git commit -m "feat(payments): add a wp-admin FX rate for PayPal orders

Kept in wp-admin rather than an app env var so the clinic can change it
without a deploy -- and to stay clear of the cPanel Node.js Selector, where a
trailing space in a key name once silently broke payment webhooks.

The sanitizer refuses a blank or non-positive value and keeps the stored rate,
because create_order() treats a non-positive rate as a hard failure and would
otherwise refuse every PayPal order after one bad save.

The help text spells out the direction: the rate divides, so a higher number
charges less. The intuition runs the other way."
```

---

### Task 4: Plugin — method routing and gateway resolution

**Files:**
- Modify: `Wordpress-Plugin/praktiqu-endpoint/includes/class-praktiqu-endpoint-payments.php` (`create_order()` around line 41; `resolve_xendit_gateway()` around line 155)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `create_order()` accepts `$input['method']` ∈ `{'xendit','paypal','card'}`, defaulting to `'xendit'`. `resolve_gateway(string $method): ?\WC_Payment_Gateway` replaces `resolve_xendit_gateway()`. Task 5 branches on the same `$method` local.

- [ ] **Step 1: Replace the gateway resolver**

Replace the whole `resolve_xendit_gateway()` method (its docblock included) with:

```php
    /**
     * The enabled WooCommerce gateway that serves a payment method.
     *
     * - xendit: first enabled gateway whose id starts with 'xendit'. The hosted
     *   invoice shows every enabled Xendit method regardless of which gateway
     *   triggers it, so the specific pick only sets the page's pre-highlighted
     *   method.
     * - paypal, card: 'ppcp-gateway'. Both use the same gateway; 'card' differs
     *   only in the landing page requested from PayPal (see
     *   force_card_landing_page()). 'ppcp-card-button-gateway' is NOT used
     *   even though it is enabled: driven server-side its process_payment() calls
     *   create_order() with no funding_source, so it produces a PayPal order
     *   identical to ppcp-gateway's. The two differ only in which browser button
     *   was clicked.
     */
    private function resolve_gateway(string $method): ?\WC_Payment_Gateway
    {
        if (!function_exists('WC') || !WC()->payment_gateways()) {
            return null;
        }
        foreach (WC()->payment_gateways()->payment_gateways() as $gateway) {
            if ((string) $gateway->enabled !== 'yes') {
                continue;
            }
            $id = (string) $gateway->id;
            if ($method === 'xendit' && strpos($id, 'xendit') === 0) {
                return $gateway;
            }
            if (($method === 'paypal' || $method === 'card') && $id === 'ppcp-gateway') {
                return $gateway;
            }
        }
        return null;
    }
```

- [ ] **Step 2: Validate the method at the top of `create_order()`**

In `create_order()`, immediately after the `class_exists('WooCommerce')` guard and **before** `$order = wc_create_order();`, insert:

```php
        $method = (string) ($input['method'] ?? 'xendit');
        if (!in_array($method, ['xendit', 'paypal', 'card'], true)) {
            return new \WP_Error(
                'unknown_method',
                sprintf('Unknown payment method "%s"', $method),
                ['status' => 400]
            );
        }
```

Validating before `wc_create_order()` is deliberate: a typo must not leave an orphan order holding an appointment slot, and must never fall through to Xendit and charge rupiah for what the caller meant as a dollar payment.

- [ ] **Step 3: Point the gateway branch at the new resolver**

In `create_order()`, replace these three lines:

```php
        $gateway = $this->resolve_xendit_gateway();
        if ($gateway === null) {
            $order->update_status('cancelled', 'PraktiQU: no enabled Xendit gateway');
            return new \WP_Error('xendit_gateway_missing', 'No enabled Xendit payment gateway', ['status' => 503]);
```

with:

```php
        $gateway = $this->resolve_gateway($method);
        if ($gateway === null) {
            $order->update_status('cancelled', sprintf('PraktiQU: no enabled gateway for method "%s"', $method));
            return new \WP_Error(
                'gateway_missing',
                sprintf('No enabled payment gateway for method "%s"', $method),
                ['status' => 503]
            );
```

- [ ] **Step 4: Generalise the invoice-failure wording**

Still in `create_order()`, in the block that handles a non-success `$result`, replace:

```php
            $message = 'Failed to create Xendit invoice';
```

with:

```php
            $message = sprintf('Failed to start payment via "%s"', $method);
```

and replace:

```php
            $order->update_status('cancelled', 'PraktiQU: Xendit invoice creation failed');
            return new \WP_Error('xendit_invoice_failed', $message, ['status' => 502]);
```

with:

```php
            $order->update_status('cancelled', sprintf('PraktiQU: payment start failed for method "%s"', $method));
            return new \WP_Error('payment_start_failed', $message, ['status' => 502]);
```

- [ ] **Step 5: Record the method on the order**

In `create_order()`, in the metadata block, immediately after the `praktiqu_source` line, add:

```php
        $order->update_meta_data('praktiqu_method', $method);
```

- [ ] **Step 6: Confirm no reference to the old resolver survives**

Run: `grep -rn "resolve_xendit_gateway\|xendit_gateway_missing\|xendit_invoice_failed" Wordpress-Plugin/praktiqu-endpoint/`
Expected: no matches.

- [ ] **Step 7: Lint every PHP file**

Run the `php -l` command from the plan's command list.
Expected: no output.

- [ ] **Step 8: Commit**

```bash
git add Wordpress-Plugin/praktiqu-endpoint/includes/class-praktiqu-endpoint-payments.php
git commit -m "feat(payments): route WC order creation by payment method

resolve_xendit_gateway() becomes resolve_gateway(\$method), and create_order()
takes a method that defaults to xendit so every existing caller is unchanged.

An unrecognised method is rejected before wc_create_order() runs: a typo must
not leave an orphan order holding an appointment slot, and must never fall
through to Xendit and charge rupiah for what the caller meant as dollars.

ppcp-card-button-gateway is deliberately not used despite being enabled --
driven server-side it calls create_order() with no funding_source and yields
an order identical to ppcp-gateway's."
```

---

### Task 5: Plugin — USD order creation

**Files:**
- Modify: `Wordpress-Plugin/praktiqu-endpoint/includes/class-praktiqu-endpoint-payments.php` (`create_order()`)

**Interfaces:**
- Consumes: `Money::idr_to_foreign()` (Task 2); the `praktiqu_endpoint_paypal_idr_rate` option (Task 3); the `$method` local (Task 4).
- Produces: `create_order()` returns `['orderId' => int, 'checkoutUrl' => string, 'chargedAmount' => float, 'chargedCurrency' => string, 'fxRate' => float|null]`. Task 8 reads exactly these keys.

- [ ] **Step 1: Resolve the rate and currency before any line item is added**

In `create_order()`, immediately after `$order = wc_create_order();`, insert:

```php
        // PayPal has no IDR (verified against the PPCP plugin's own supported list),
        // so paypal/card orders are priced in USD from a rate the clinic maintains
        // in wp-admin. Xendit orders stay in the store currency, untouched.
        $is_foreign = ($method === 'paypal' || $method === 'card');
        $rate       = 0.0;
        if ($is_foreign) {
            $rate = (float) get_option('praktiqu_endpoint_paypal_idr_rate', '0');
            if ($rate <= 0) {
                $order->update_status('cancelled', 'PraktiQU: PayPal FX rate not configured');
                return new \WP_Error(
                    'paypal_rate_missing',
                    'PayPal FX rate is not configured (Settings -> PraktiQU Endpoint)',
                    ['status' => 503]
                );
            }
            $order->set_currency('USD');
        }
```

- [ ] **Step 2: Convert item prices**

In the `foreach ((array) ($input['items'] ?? []) as $item)` loop, replace the first line:

```php
            $product = new \WC_Product_Simple();
```

with:

```php
            $price = (float) ($item['price'] ?? 0);
            if ($is_foreign) {
                $price = Money::idr_to_foreign($price, $rate);
            }
            $product = new \WC_Product_Simple();
```

Then replace the two price setters:

```php
            $product->set_price((string) ($item['price'] ?? 0));
            $product->set_regular_price((string) ($item['price'] ?? 0));
```

with:

```php
            $product->set_price((string) $price);
            $product->set_regular_price((string) $price);
```

- [ ] **Step 3: Convert tax amounts**

In the `foreach ((array) ($input['taxes'] ?? []) as $tax)` loop, replace:

```php
            $amount = (float) ($tax['amount'] ?? 0);
            if ($amount <= 0) {
                continue;
            }
```

with:

```php
            $amount = (float) ($tax['amount'] ?? 0);
            if ($amount <= 0) {
                continue;
            }
            if ($is_foreign) {
                $amount = Money::idr_to_foreign($amount, $rate);
            }
```

Each line converts independently, so the WooCommerce total — which is its own sum of the lines — is at least the exact conversion. Rounding only the total would not survive `calculate_totals()`, which recomputes from the lines. The cost is at most one cent per line.

- [ ] **Step 4: Record the conversion on the order**

In the metadata block, immediately after the `praktiqu_method` line added in Task 4, add:

```php
        $order->update_meta_data('praktiqu_charge_currency', $is_foreign ? 'USD' : get_woocommerce_currency());
        $order->update_meta_data('praktiqu_expected_idr', (string) array_sum(
            array_map(
                static fn ($row): float => (float) ($row['price'] ?? $row['amount'] ?? 0),
                array_merge((array) ($input['items'] ?? []), (array) ($input['taxes'] ?? []))
            )
        ));
        if ($is_foreign) {
            $order->update_meta_data('praktiqu_fx_rate', (string) $rate);
        }
```

Disbursement reads WooCommerce order data, so the rupiah figure and the rate must live on the order, not only in the app database.

- [ ] **Step 5: Extend both return paths**

In the free-service short-circuit (`if ((float) $order->get_total() <= 0)`), replace the return with:

```php
            return [
                'orderId'         => $order->get_id(),
                'checkoutUrl'     => (string) ($input['returnUrl'] ?? $order->get_checkout_order_received_url()),
                'chargedAmount'   => 0.0,
                'chargedCurrency' => $is_foreign ? 'USD' : get_woocommerce_currency(),
                'fxRate'          => $is_foreign ? $rate : null,
            ];
```

And replace the success return at the end of `create_order()` with:

```php
        return [
            'orderId'         => $order->get_id(),
            'checkoutUrl'     => (string) $result['redirect'],
            'chargedAmount'   => (float) $order->get_total(),
            'chargedCurrency' => $is_foreign ? 'USD' : get_woocommerce_currency(),
            'fxRate'          => $is_foreign ? $rate : null,
        ];
```

`$order->get_total()` is read *after* `calculate_totals()` and `save()`, so it is the figure the gateway actually charged — not a recomputation that could drift from it.

- [ ] **Step 6: Lint every PHP file**

Run the `php -l` command from the plan's command list.
Expected: no output.

- [ ] **Step 7: Re-run the Money test**

Run the `test-money.php` command from the plan's command list.
Expected: `ALL PASS`.

- [ ] **Step 8: Commit**

```bash
git add Wordpress-Plugin/praktiqu-endpoint/includes/class-praktiqu-endpoint-payments.php
git commit -m "feat(payments): create PayPal and card orders in USD

The store stays on IDR for Xendit; only paypal/card orders switch the order
currency and convert their lines. Conversion is per line because WooCommerce
recomputes an order total from its lines, so a separately-rounded total would
not survive calculate_totals(). At most one cent per line accrues to the
clinic -- a typical booking is a service plus one or two taxes.

A missing or non-positive rate cancels the order and fails with 503 rather
than charging a wrong amount.

chargedAmount is read back from get_total() after calculate_totals(), so it is
what the gateway was actually handed, not a recomputation that could drift."
```

---

### Task 6: Plugin — the card landing page

**Files:**
- Modify: `Wordpress-Plugin/praktiqu-endpoint/includes/class-praktiqu-endpoint-payments.php` (`create_order()`, around the `process_payment()` call; plus one new private method)

**Interfaces:**
- Consumes: the `$method` local (Task 4).
- Produces: no new public surface. Behavioural: a `card` order asks PayPal to open on the guest card form.

- [ ] **Step 1: Add the filter helper**

Add this private method immediately after `resolve_gateway()`:

```php
    /**
     * Ask PayPal to open its hosted page on the guest card form rather than the
     * account-login form, for the 'card' method only.
     *
     * Indonesia is not eligible for Advanced Card Processing -- the PPCP plugin's
     * own country matrix omits ID, and this merchant holds only PPCP_STANDARD --
     * so card fields cannot be hosted on our own pages. Cards must go through
     * PayPal's page, where the merchant's active GUEST_CHECKOUT capability lets a
     * payer with no PayPal account pay by card. All this does is choose which
     * form that page opens on.
     *
     * Uses PPCP's documented `ppcp_create_order_request_body_data` filter rather
     * than editing PPCP or hand-rolling a PayPal API call, so it survives plugin
     * updates.
     *
     * @return callable The registered closure, so the caller can remove it.
     */
    private function force_card_landing_page(): callable
    {
        $filter = static function ($data) {
            if (!is_array($data)) {
                return $data;
            }
            // GUEST_CHECKOUT is PPCP's own constant value
            // (ExperienceContext::LANDING_PAGE_GUEST_CHECKOUT).
            $data['payment_source']['paypal']['experience_context']['landing_page'] = 'GUEST_CHECKOUT';
            return $data;
        };
        add_filter('ppcp_create_order_request_body_data', $filter, 10, 1);
        return $filter;
    }
```

- [ ] **Step 2: Wrap the `process_payment()` call**

In `create_order()`, replace this single line:

```php
        $result = $gateway->process_payment($order->get_id());
```

with:

```php
        $card_filter = $method === 'card' ? $this->force_card_landing_page() : null;
        try {
            $result = $gateway->process_payment($order->get_id());
        } finally {
            // Remove it in `finally`, not after the call: PHP-FPM reuses a process
            // across requests, so a leaked filter would push a later PayPal order
            // onto the card form too.
            if ($card_filter !== null) {
                remove_filter('ppcp_create_order_request_body_data', $card_filter, 10);
            }
        }
```

- [ ] **Step 3: Lint every PHP file**

Run the `php -l` command from the plan's command list.
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add Wordpress-Plugin/praktiqu-endpoint/includes/class-praktiqu-endpoint-payments.php
git commit -m "feat(payments): open PayPal on the card form for the card method

On-site card fields are not available: the PPCP country matrix omits ID and
this merchant holds only PPCP_STANDARD, so no Advanced Card Processing. Cards
go through PayPal's hosted page, where the active GUEST_CHECKOUT capability
lets a payer without a PayPal account pay by card. The card method only
chooses which form that page opens on.

Done through PPCP's documented ppcp_create_order_request_body_data filter so
it survives plugin updates, and removed in a finally block because PHP-FPM
reuses processes and a leaked filter would affect later PayPal orders."
```

---

### Task 7: Plugin — currency-aware webhook payload

**Files:**
- Modify: `Wordpress-Plugin/praktiqu-endpoint/includes/class-praktiqu-endpoint-payments.php` (`get_order_status()` around line 185; `dispatch_payment_webhook()` around line 255)
- Modify: `Wordpress-Plugin/praktiqu-endpoint/praktiqu-endpoint.php` (version, lines 6 and 19)

**Interfaces:**
- Consumes: the `praktiqu_charge_currency` order meta written in Task 5.
- Produces: the webhook payload and the order-status response each gain `currency: string`, and their `amount`/`amountPaid` keep 2 decimals for non-IDR orders. Tasks 8 and 10 rely on `WcOrderStatus.currency` and the webhook's `currency` field.

- [ ] **Step 1: Add a shared amount formatter**

Add this private method immediately before `dispatch_payment_webhook()`:

```php
    /**
     * An order's charge currency and its amount at that currency's precision.
     *
     * Rupiah has no fractional subunit in practice, so IDR amounts stay integers
     * exactly as before. Anything else keeps 2 decimals -- rounding a $12.35 USD
     * order to 12 would fail the app's amount check and leave the appointment
     * stuck in PENDING.
     *
     * @return array{0: float|int, 1: string}
     */
    private function order_amount_and_currency(\WC_Order $order): array
    {
        $currency = (string) ($order->get_meta('praktiqu_charge_currency') ?: $order->get_currency());
        $total    = (float) $order->get_total();
        return $currency === 'IDR'
            ? [(int) round($total), $currency]
            : [round($total, 2), $currency];
    }
```

Reading the currency from our own meta first, with `get_currency()` as the fallback, keeps orders created before this change working: they have no meta and their order currency is IDR.

- [ ] **Step 2: Use it in the webhook payload**

In `dispatch_payment_webhook()`, replace:

```php
        $payload = [
            'event'         => $event,
            'wcOrderId'     => $order->get_id(),
            'amountPaid'    => (int) round((float) $order->get_total()),
```

with:

```php
        [$amount, $currency] = $this->order_amount_and_currency($order);

        $payload = [
            'event'         => $event,
            'wcOrderId'     => $order->get_id(),
            'amountPaid'    => $amount,
            'currency'      => $currency,
```

- [ ] **Step 3: Use it in the order-status response**

In `get_order_status()`, replace:

```php
        return [
            'orderId'       => $order_id,
            'status'        => $order->get_status(),
            'isPaid'        => $order->is_paid(),
            'transactionId' => $order->get_transaction_id() ?: null,
            'amount'        => (int) round((float) $order->get_total()),
        ];
```

with:

```php
        [$amount, $currency] = $this->order_amount_and_currency($order);

        return [
            'orderId'       => $order_id,
            'status'        => $order->get_status(),
            'isPaid'        => $order->is_paid(),
            'transactionId' => $order->get_transaction_id() ?: null,
            'amount'        => $amount,
            'currency'      => $currency,
        ];
```

- [ ] **Step 4: Bump the plugin version**

In `Wordpress-Plugin/praktiqu-endpoint/praktiqu-endpoint.php`:
- line 6: ` * Version:           1.4.0` → ` * Version:           1.5.0`
- line 19: `define('PRAKTIQU_ENDPOINT_VERSION', '1.4.0');` → `define('PRAKTIQU_ENDPOINT_VERSION', '1.5.0');`

- [ ] **Step 5: Verify no stale integer cast on a total remains**

Run: `grep -rn "round((float) \$order->get_total())" Wordpress-Plugin/praktiqu-endpoint/`
Expected: no matches.

- [ ] **Step 6: Verify the version bump landed in both places**

Run: `grep -rn "1\.4\.0\|1\.5\.0" Wordpress-Plugin/praktiqu-endpoint/praktiqu-endpoint.php`
Expected: two lines, both `1.5.0`.

- [ ] **Step 7: Lint every PHP file**

Run the `php -l` command from the plan's command list.
Expected: no output.

- [ ] **Step 8: Commit**

```bash
git add Wordpress-Plugin/praktiqu-endpoint/includes/class-praktiqu-endpoint-payments.php Wordpress-Plugin/praktiqu-endpoint/praktiqu-endpoint.php
git commit -m "fix(payments): send the charge currency and keep cents on the wire

amountPaid was cast to an integer, which is correct for rupiah and wrong for
anything else: a \$12.35 order transmitted 12, the app compared that against a
rupiah expectedAmount, and the appointment would never leave PENDING. The
verify-fallback status response carried the same bug.

Both now report the currency alongside an amount at that currency's precision.
IDR keeps the integer cast, so existing behaviour is byte-for-byte unchanged.
The currency is read from our own order meta with get_currency() as fallback,
so orders predating this change still resolve to IDR.

Bumps the plugin to 1.5.0."
```

---

### Task 8: Next.js — the wp-endpoint bridge

**Files:**
- Modify: `src/lib/wp-endpoint.ts` (`CreateWcOrderInput` line 19, `CreateWcOrderResult` line 32, `WcOrderStatus` line 37, `createWcOrder` line 155, `getWcOrderStatus` line 174)
- Test: `tests/payments/wp-endpoint.test.ts`

**Interfaces:**
- Consumes: the plugin response shape from Tasks 5 and 7.
- Produces:
  - `export type PaymentMethod = 'xendit' | 'paypal' | 'card'`
  - `CreateWcOrderInput` gains `method?: PaymentMethod`
  - `CreateWcOrderResult` gains `chargedAmount: number | null`, `chargedCurrency: string`, `fxRate: number | null`
  - `WcOrderStatus` gains `currency: string`
  Tasks 9, 10 and 11 import `PaymentMethod` from `@/lib/wp-endpoint`.

- [ ] **Step 1: Write the failing tests**

This file's established style matters: it stubs `fetch` with a **plain object**
(`{ ok: true, json: async () => ({…}) }`), not a real `Response`, and it imports the
module **dynamically inside each test** (`const { createWcOrder } = await import('@/lib/wp-endpoint')`)
so the `WORDPRESS_URL` set in `beforeEach` is picked up. Follow that; do not introduce a
second pattern.

Add these tests **inside** the existing `describe('wp-endpoint payments client', …)` block,
so they inherit its `beforeEach`/`afterEach` env stubbing:

```ts
  it('createWcOrder forwards the method in the request body', async () => {
    (fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        orderId: 42, checkoutUrl: 'https://paypal.com/checkout/abc',
        chargedAmount: 11.12, chargedCurrency: 'USD', fxRate: 18000,
      }),
    });
    const { createWcOrder } = await import('@/lib/wp-endpoint');
    await createWcOrder({
      source: 'public', customerName: 'A', customerEmail: 'a@x.com',
      items: [{ name: 'Svc', price: 200000 }], taxes: [],
      returnUrl: 'https://app/success', cancelUrl: 'https://app/cancel',
      method: 'paypal',
    });
    const body = JSON.parse((fetch as any).mock.calls[0][1].body);
    expect(body.method).toBe('paypal');
  });

  it('createWcOrder returns the charged figures the plugin reports', async () => {
    (fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        orderId: 42, checkoutUrl: 'https://paypal.com/checkout/abc',
        chargedAmount: 11.12, chargedCurrency: 'USD', fxRate: 18000,
      }),
    });
    const { createWcOrder } = await import('@/lib/wp-endpoint');
    const result = await createWcOrder({
      source: 'public', customerName: 'A', customerEmail: 'a@x.com',
      items: [{ name: 'Svc', price: 200000 }], taxes: [],
      returnUrl: 'https://app/success', cancelUrl: 'https://app/cancel',
      method: 'paypal',
    });
    expect(result).toEqual({
      orderId: 42, checkoutUrl: 'https://paypal.com/checkout/abc',
      chargedAmount: 11.12, chargedCurrency: 'USD', fxRate: 18000,
    });
  });

  it('createWcOrder falls back to IDR when the plugin omits the charged figures', async () => {
    // A plugin still on 1.4.0 returns only orderId and checkoutUrl. A .next-only
    // deploy can put a new app in front of an old plugin, and undefined must not
    // reach the database as NaN.
    (fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ orderId: 7, checkoutUrl: 'https://wp.test/checkout/7' }),
    });
    const { createWcOrder } = await import('@/lib/wp-endpoint');
    const result = await createWcOrder({
      source: 'public', customerName: 'A', customerEmail: 'a@x.com',
      items: [{ name: 'Svc', price: 200000 }], taxes: [],
      returnUrl: 'https://app/success', cancelUrl: 'https://app/cancel',
    });
    expect(result.chargedCurrency).toBe('IDR');
    expect(result.fxRate).toBeNull();
    // Null, not 0: the service substitutes the rupiah expectedAmount for null,
    // while a 0 would be stored as a genuine charge of nothing.
    expect(result.chargedAmount).toBeNull();
  });

  it('getWcOrderStatus reports USD when the plugin sends it', async () => {
    (fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        orderId: 42, status: 'processing', isPaid: true,
        transactionId: 'PP-1', amount: 11.12, currency: 'USD',
      }),
    });
    const { getWcOrderStatus } = await import('@/lib/wp-endpoint');
    const status = await getWcOrderStatus(42);
    expect(status.currency).toBe('USD');
    expect(status.amount).toBe(11.12);
  });

  it('getWcOrderStatus defaults the currency to IDR when absent', async () => {
    (fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        orderId: 43, status: 'processing', isPaid: true,
        transactionId: 'X-1', amount: 200000,
      }),
    });
    const { getWcOrderStatus } = await import('@/lib/wp-endpoint');
    const status = await getWcOrderStatus(43);
    expect(status.currency).toBe('IDR');
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/payments/wp-endpoint.test.ts`
Expected: FAIL — TypeScript rejects `method` as not assignable to `CreateWcOrderInput`, and the returned object lacks `chargedAmount`/`currency`.

- [ ] **Step 3: Extend the types**

In `src/lib/wp-endpoint.ts`, add above `CreateWcOrderInput`:

```ts
/** Payment methods the WP plugin's create_order() accepts. */
export type PaymentMethod = 'xendit' | 'paypal' | 'card';
```

Add to `CreateWcOrderInput`, after `cancelUrl`:

```ts
  /** Omitted means 'xendit' — the plugin applies the same default. */
  method?: PaymentMethod;
```

Replace `CreateWcOrderResult` with:

```ts
export interface CreateWcOrderResult {
  orderId: number;
  checkoutUrl: string;
  /** What the payer will actually be billed, in `chargedCurrency`. Null from a
   *  pre-1.5.0 plugin, which does not report it. */
  chargedAmount: number | null;
  /** ISO 4217 code. 'IDR' for Xendit; 'USD' for paypal/card. */
  chargedCurrency: string;
  /** Rupiah per 1 unit of `chargedCurrency`; null when no conversion happened. */
  fxRate: number | null;
}
```

Add to `WcOrderStatus`, after `amount`:

```ts
  /** ISO 4217 code. Absent from a pre-1.5.0 plugin, in which case 'IDR'. */
  currency: string;
```

- [ ] **Step 4: Extend the two response mappers**

In `createWcOrder`, replace the return with:

```ts
  // A plugin older than 1.5.0 omits these three. Report chargedAmount as null
  // rather than coercing it to 0 — the service layer substitutes the rupiah
  // expectedAmount for null, whereas a 0 would be stored as a real charge of nothing.
  return {
    orderId: data.orderId,
    checkoutUrl: data.checkoutUrl,
    chargedAmount: data.chargedAmount === null || data.chargedAmount === undefined ? null : toNum(data.chargedAmount),
    chargedCurrency: typeof data.chargedCurrency === 'string' ? data.chargedCurrency : 'IDR',
    fxRate: data.fxRate === null || data.fxRate === undefined ? null : toNum(data.fxRate),
  };
```

In `getWcOrderStatus`, add one line to the returned object, after `amount`:

```ts
    currency: typeof data.currency === 'string' ? data.currency : 'IDR',
```

Add the import at the top of the file if it is not already present:

```ts
import { toNum } from '@/lib/kc-num';
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/payments/wp-endpoint.test.ts`
Expected: PASS — 9 tests (the 4 that were there plus the 5 new ones).

- [ ] **Step 6: Run the whole payment suite**

Run: `npx vitest run tests/payments/`
Expected: all files passing.

- [ ] **Step 7: Commit**

```bash
git add src/lib/wp-endpoint.ts tests/payments/wp-endpoint.test.ts
git commit -m "feat(payments): carry a method in and charged figures out of the WP bridge

createWcOrder forwards an optional method (the plugin defaults it to xendit,
same as we do) and returns what the payer will actually be billed, in which
currency, at what rate.

Both mappers tolerate a pre-1.5.0 plugin: missing charged figures fall back to
the rupiah reading rather than letting undefined reach the database as NaN,
because a .next-only deploy can put a new app in front of an old plugin."
```

---

### Task 9: Next.js — method plumbing and charged-figure persistence

**Files:**
- Modify: `src/services/payments/payment.service.ts` (`PaymentStatusView` ~line 213, `CreatePaymentOrderInput` ~line 105, `createPaymentOrder` ~line 118, `initiatePublicPayment` ~line 218, `checkPublicPaymentStatus` ~line 423, `checkSessionPaymentStatus` ~line 430, `ensureSessionPayment` ~line 437)
- Test: `tests/payments/payment-service.test.ts`

**Interfaces:**
- Consumes: `PaymentMethod`, `CreateWcOrderResult` (Task 8); the Prisma fields (Task 1).
- Produces:
  - `initiatePublicPayment(appointmentId: number, method?: PaymentMethod): Promise<{ checkoutUrl: string; chargedAmount: number; chargedCurrency: string }>`
  - `ensureSessionPayment(billId: string, method?: PaymentMethod): Promise<{ checkoutUrl: string | null; status: PaymentStatus; expectedAmount: number; chargedAmount: number; chargedCurrency: string }>`
  - `PaymentStatusView = { status: PaymentStatus; expectedAmount: number; chargedAmount: number; chargedCurrency: string }`
  - `chargedView(order: PaymentOrder): { chargedAmount: number; chargedCurrency: string }`
  Task 10 uses `chargedView`; Task 11 uses the two initiation signatures.

- [ ] **Step 1: Write the failing test**

Append to `tests/payments/payment-service.test.ts`:

```ts
import { chargedView } from '@/services/payments/payment.service';

describe('chargedView', () => {
  it('reads the stored USD charge', () => {
    const view = chargedView({ expectedAmount: 200000, chargedAmount: 11.12, chargedCurrency: 'USD' } as any);
    expect(view).toEqual({ chargedAmount: 11.12, chargedCurrency: 'USD' });
  });

  it('falls back to the rupiah expectedAmount on a row that predates the column', () => {
    // Rows written before 2026-09-01 have chargedAmount NULL; they are all Xendit
    // orders, so expectedAmount already is the charge.
    const view = chargedView({ expectedAmount: 200000, chargedAmount: null, chargedCurrency: 'IDR' } as any);
    expect(view).toEqual({ chargedAmount: 200000, chargedCurrency: 'IDR' });
  });

  it('converts a Prisma Decimal, which is an object rather than a number', () => {
    // Prisma returns DECIMAL columns as Decimal instances; toNum() handles them
    // via String(), and a bare `as number` would silently produce NaN downstream.
    const decimalLike = { toString: () => '11.12' };
    const view = chargedView({ expectedAmount: 200000, chargedAmount: decimalLike, chargedCurrency: 'USD' } as any);
    expect(view.chargedAmount).toBe(11.12);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/payments/payment-service.test.ts`
Expected: FAIL — `chargedView` is not exported from the service.

- [ ] **Step 3: Add `chargedView` and extend `PaymentStatusView`**

In `src/services/payments/payment.service.ts`, replace `PaymentStatusView` with:

```ts
export interface PaymentStatusView {
  status: PaymentStatus;
  /** Always integer rupiah — the app's own source of truth. */
  expectedAmount: number;
  /** What the payer was billed, in `chargedCurrency`. */
  chargedAmount: number;
  chargedCurrency: string;
}
```

Add immediately below it:

```ts
/**
 * What the payer was actually billed, for display.
 *
 * `chargedAmount` is NULL on rows written before the column existed. Those are
 * all Xendit orders in rupiah, where `expectedAmount` already is the charge, so
 * that is the fallback. Prisma hands back a `Decimal` object rather than a
 * number, which is why this goes through `toNum` instead of a cast.
 */
export function chargedView(order: PaymentOrder): { chargedAmount: number; chargedCurrency: string } {
  return {
    chargedAmount: order.chargedAmount === null ? order.expectedAmount : toNum(order.chargedAmount),
    chargedCurrency: order.chargedCurrency || 'IDR',
  };
}
```

`toNum` is already imported at the top of this file.

- [ ] **Step 4: Persist the new fields on create**

Add to `CreatePaymentOrderInput`, after `expectedAmount`:

```ts
  gateway?: PaymentMethod;
  chargedAmount?: number | null;
  chargedCurrency?: string;
  fxRate?: number | null;
```

And in `createPaymentOrder`'s `data` object, after the `expectedAmount` line:

```ts
      gateway: input.gateway ?? 'xendit',
      chargedAmount: input.chargedAmount ?? input.expectedAmount, // null/undefined -> the rupiah figure
      chargedCurrency: input.chargedCurrency ?? 'IDR',
      fxRate: input.fxRate ?? null,
```

Add `PaymentMethod` to the existing `@/lib/wp-endpoint` import:

```ts
import { createWcOrder, getWcOrderStatus, type PaymentMethod } from '@/lib/wp-endpoint';
```

- [ ] **Step 5: Thread the method through `initiatePublicPayment`**

Change the signature:

```ts
export async function initiatePublicPayment(
  appointmentId: number,
  method: PaymentMethod = 'xendit',
): Promise<{ checkoutUrl: string; chargedAmount: number; chargedCurrency: string }> {
```

Add `method,` to the `createWcOrder({ … })` call (after `cancelUrl`).

Add the charged fields to the `createPaymentOrder({ … })` call (after `expectedAmount`):

```ts
    gateway: method,
    chargedAmount: wcOrder.chargedAmount,
    chargedCurrency: wcOrder.chargedCurrency,
    fxRate: wcOrder.fxRate,
```

And replace the function's return with:

```ts
  return {
    checkoutUrl: wcOrder.checkoutUrl,
    chargedAmount: wcOrder.chargedAmount ?? expectedAmount,
    chargedCurrency: wcOrder.chargedCurrency,
  };
```

- [ ] **Step 6: Thread the method through `ensureSessionPayment`**

Change the signature:

```ts
export async function ensureSessionPayment(
  billId: string,
  method: PaymentMethod = 'xendit',
): Promise<{ checkoutUrl: string | null; status: PaymentStatus; expectedAmount: number; chargedAmount: number; chargedCurrency: string }> {
```

In the early-return branch for an existing usable order, replace:

```ts
      return { checkoutUrl: null, status: reconciled.status as PaymentStatus, expectedAmount: reconciled.expectedAmount };
```

with:

```ts
      return {
        checkoutUrl: null,
        status: reconciled.status as PaymentStatus,
        expectedAmount: reconciled.expectedAmount,
        ...chargedView(reconciled),
      };
```

Add `method,` to the `createWcOrder({ … })` call (after `cancelUrl`), and the same four charged fields to `createPaymentOrder({ … })` as in Step 5.

Replace the final return with:

```ts
  return {
    checkoutUrl: wcOrder.checkoutUrl,
    status: 'pending',
    expectedAmount,
    chargedAmount: wcOrder.chargedAmount ?? expectedAmount,
    chargedCurrency: wcOrder.chargedCurrency,
  };
```

- [ ] **Step 7: Extend both status readers**

In `checkPublicPaymentStatus` and `checkSessionPaymentStatus`, replace each return:

```ts
  return { status: reconciled.status as PaymentStatus, expectedAmount: reconciled.expectedAmount };
```

with:

```ts
  return {
    status: reconciled.status as PaymentStatus,
    expectedAmount: reconciled.expectedAmount,
    ...chargedView(reconciled),
  };
```

- [ ] **Step 8: Update the existing `createPaymentOrder` assertion**

`tests/payments/state-machine.test.ts` asserts the `create` call with an exact `toEqual`
on the `data` object. Step 4 adds four keys to it, so that test **will** fail — expected,
not a regression. Replace its expectation with:

```ts
    expect(mockPrisma.paymentOrder.create).toHaveBeenCalledWith({
      data: {
        source: 'public', appointmentId: 'appt_1', billId: null, encounterId: null,
        wcOrderId: 42, expectedAmount: 100000, status: 'pending',
        gateway: 'xendit', chargedAmount: 100000, chargedCurrency: 'IDR', fxRate: null,
      },
    });
```

The defaults are the point: a caller that passes no method still writes a rupiah Xendit
row whose charge equals its expected amount.

- [ ] **Step 9: Run the tests**

Run: `npx vitest run tests/payments/`
Expected: all passing. `payment-service.test.ts` now has 11 tests.

`session-routes.test.ts` and `public-routes.test.ts` assert on individual response keys
rather than a whole-body `toEqual`, so the two extra fields do not break them. If any
assertion does fail on an unexpected extra key, the extra fields are the intended change —
widen the assertion, do not narrow the response.

- [ ] **Step 10: Commit**

```bash
git add src/services/payments/payment.service.ts tests/payments/payment-service.test.ts tests/payments/state-machine.test.ts
git commit -m "feat(payments): thread the method through and record what was charged

Both initiation paths take a method that defaults to xendit, and store the
gateway, charged amount, charged currency and FX rate on the payment_orders
row they create.

Status views now carry the charged figures too. Without them the front-end can
only show a rupiah number the PayPal payer was never billed.

chargedView() centralises two easy mistakes: a NULL chargedAmount on a row
predating the column means 'expectedAmount, in rupiah', and Prisma hands back
DECIMAL as a Decimal object, so a bare cast yields NaN."
```

---

### Task 10: Next.js — currency-aware amount verification

**Files:**
- Modify: `src/services/payments/payment.service.ts` (`markPaid` ~line 160, `reconcileIfStale` ~line 383)
- Test: `tests/payments/state-machine.test.ts`

**Interfaces:**
- Consumes: `chargedView` (Task 9); `WcOrderStatus.currency` (Task 8).
- Produces: `MarkPaidInput` gains `currency?: string`. Behaviour: IDR keeps the ±2 rupiah tolerance; anything else compares against `chargedAmount` with a ±0.01 tolerance.

- [ ] **Step 1: Write the failing tests**

Append to `tests/payments/state-machine.test.ts`:

```ts
describe('markPaid — currency-aware amount check', () => {
  it('accepts a USD payment that matches the stored charge', async () => {
    mockPrisma.paymentOrder.findUnique.mockResolvedValue({
      wcOrderId: 42,
      status: 'pending',
      expectedAmount: 200000,
      chargedAmount: 11.12,
      chargedCurrency: 'USD',
      source: 'public',
    } as any);
    mockPrisma.paymentOrder.updateMany.mockResolvedValue({ count: 1 } as any);

    await expect(
      markPaid({ wcOrderId: 42, amountPaid: 11.12, currency: 'USD', transactionId: 'PP-1', webhookPayload: {} }),
    ).resolves.not.toThrow();
  });

  it('rejects a USD payment short by more than a cent', async () => {
    mockPrisma.paymentOrder.findUnique.mockResolvedValue({
      wcOrderId: 42,
      status: 'pending',
      expectedAmount: 200000,
      chargedAmount: 11.12,
      chargedCurrency: 'USD',
      source: 'public',
    } as any);

    await expect(
      markPaid({ wcOrderId: 42, amountPaid: 10.0, currency: 'USD', transactionId: 'PP-1', webhookPayload: {} }),
    ).rejects.toThrow(AmountMismatchError);
  });

  it('does not compare a USD payment against the rupiah expectedAmount', async () => {
    // The bug this guards: 11.12 vs 200000 would look like a catastrophic
    // mismatch and leave a genuinely-paid appointment stuck in PENDING.
    mockPrisma.paymentOrder.findUnique.mockResolvedValue({
      wcOrderId: 42,
      status: 'pending',
      expectedAmount: 200000,
      chargedAmount: 11.12,
      chargedCurrency: 'USD',
      source: 'public',
    } as any);
    mockPrisma.paymentOrder.updateMany.mockResolvedValue({ count: 1 } as any);

    await expect(
      markPaid({ wcOrderId: 42, amountPaid: 11.12, currency: 'USD', transactionId: 'PP-1', webhookPayload: {} }),
    ).resolves.not.toThrow();
  });

  it('keeps the rupiah tolerance for an IDR order', async () => {
    mockPrisma.paymentOrder.findUnique.mockResolvedValue({
      wcOrderId: 43,
      status: 'pending',
      expectedAmount: 200000,
      chargedAmount: 200000,
      chargedCurrency: 'IDR',
      source: 'public',
    } as any);
    mockPrisma.paymentOrder.updateMany.mockResolvedValue({ count: 1 } as any);

    // Within ±2 rupiah: accepted, exactly as before this change.
    await expect(
      markPaid({ wcOrderId: 43, amountPaid: 199999, transactionId: 'X-1', webhookPayload: {} }),
    ).resolves.not.toThrow();
  });

  it('treats a missing currency as IDR, so a pre-1.5.0 plugin still works', async () => {
    mockPrisma.paymentOrder.findUnique.mockResolvedValue({
      wcOrderId: 43,
      status: 'pending',
      expectedAmount: 200000,
      chargedAmount: null,
      chargedCurrency: 'IDR',
      source: 'public',
    } as any);
    mockPrisma.paymentOrder.updateMany.mockResolvedValue({ count: 1 } as any);

    await expect(
      markPaid({ wcOrderId: 43, amountPaid: 200000, transactionId: 'X-1', webhookPayload: {} }),
    ).resolves.not.toThrow();
  });
});
```

This file already does `vi.mock('@/lib/db')` and exposes the client as
`const mockPrisma = prisma as any`, re-seeding `mockPrisma.paymentOrder` with fresh `vi.fn()`s
in `beforeEach`. The tests above use that same handle. `markPaid` and `AmountMismatchError`
are already imported there — do not add duplicate imports.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/payments/state-machine.test.ts`
Expected: FAIL — TypeScript rejects `currency` on `MarkPaidInput`, and the USD cases throw `AmountMismatchError` because 11.12 is compared against 200000.

- [ ] **Step 3: Extend `MarkPaidInput`**

```ts
export interface MarkPaidInput {
  wcOrderId: number;
  amountPaid: number;
  /** ISO 4217 code from the webhook. Omitted means IDR (pre-1.5.0 plugin). */
  currency?: string;
  transactionId: string;
  webhookPayload: unknown;
}
```

- [ ] **Step 4: Make the amount check currency-aware**

Add this constant next to `AMOUNT_TOLERANCE_RUPIAH`:

```ts
/** One cent. USD is charged to 2 decimals, so anything beyond this is a real mismatch. */
const AMOUNT_TOLERANCE_MINOR_UNIT = 0.01;
```

In `markPaid`, replace the mismatch guard:

```ts
  if (order.status === 'pending' && Math.abs(order.expectedAmount - input.amountPaid) > AMOUNT_TOLERANCE_RUPIAH) {
    throw new AmountMismatchError(`Expected ${order.expectedAmount} (±${AMOUNT_TOLERANCE_RUPIAH}), got ${input.amountPaid}`);
  }
```

with:

```ts
  if (order.status === 'pending') {
    // A PayPal order is charged in USD, so comparing against the rupiah
    // expectedAmount would read 11.12 vs 200000 as a catastrophic mismatch and
    // leave a genuinely-paid appointment stuck in PENDING.
    const { chargedAmount, chargedCurrency } = chargedView(order);
    const currency = input.currency ?? chargedCurrency;
    const tolerance = currency === 'IDR' ? AMOUNT_TOLERANCE_RUPIAH : AMOUNT_TOLERANCE_MINOR_UNIT;
    const expected = currency === 'IDR' ? order.expectedAmount : chargedAmount;
    if (Math.abs(expected - input.amountPaid) > tolerance) {
      throw new AmountMismatchError(
        `Expected ${expected} ${currency} (±${tolerance}), got ${input.amountPaid}`,
      );
    }
  }
```

- [ ] **Step 5: Pass the currency through the verify-fallback path**

In `reconcileIfStale`, in the `markPaid({ … })` call, add one line after `amountPaid`:

```ts
        currency: wcStatus.currency,
```

- [ ] **Step 6: Pass the currency through the webhook route**

In `src/app/api/v1/sessions/payment-webhook/route.ts`, add to `payloadSchema` after `amountPaid`:

```ts
  currency: z.string().optional(),
```

Destructure it:

```ts
  const { event, wcOrderId, amountPaid, currency, transactionId } = parsed.data;
```

And add it to the `markPaid({ … })` call after `amountPaid`:

```ts
        currency,
```

- [ ] **Step 7: Run the tests**

Run: `npx vitest run tests/payments/`
Expected: all passing. `state-machine.test.ts` now has 11 tests.

- [ ] **Step 8: Commit**

```bash
git add src/services/payments/payment.service.ts src/app/api/v1/sessions/payment-webhook/route.ts tests/payments/state-machine.test.ts
git commit -m "fix(payments): verify a payment against its own currency

A PayPal order is charged in USD, so checking \$11.12 against a rupiah
expectedAmount of 200000 read as a catastrophic mismatch: a 409, and a
genuinely-paid appointment stuck in PENDING.

Non-IDR payments now compare against the stored chargedAmount within one cent.
IDR keeps its +/-2 rupiah tolerance, so the Xendit path is unchanged. A missing
currency is treated as IDR, so a pre-1.5.0 plugin still reconciles."
```

---

### Task 11: Next.js — routes accept a method

**Files:**
- Modify: `src/app/api/v1/public/payments/route.ts` (`bodySchema` line 14, the `initiatePublicPayment` call line 31)
- Modify: `src/app/api/v1/sessions/payment-verify/route.ts`
- Test: `tests/payments/public-routes.test.ts`, `tests/payments/session-routes.test.ts`

**Interfaces:**
- Consumes: `initiatePublicPayment(appointmentId, method)` and `ensureSessionPayment(billId, method)` (Task 9).
- Produces: both routes accept an optional `method` in the JSON body; an invalid value is a 400. This is the shape Task 12 documents.

- [ ] **Step 1: Write the failing tests**

Append to `tests/payments/public-routes.test.ts`:

```ts
describe('POST /public/payments — method', () => {
  it('defaults to xendit when the body omits a method', async () => {
    (svc.initiatePublicPayment as any).mockResolvedValue({
      checkoutUrl: 'https://wp/checkout/1',
      chargedAmount: 200000,
      chargedCurrency: 'IDR',
    });
    const res = await initiate(req({ token: 'good' }));
    expect(res.status).toBe(201);
    expect(svc.initiatePublicPayment).toHaveBeenCalledWith(5150, 'xendit');
  });

  it('forwards paypal and returns the charged figures', async () => {
    (svc.initiatePublicPayment as any).mockResolvedValue({
      checkoutUrl: 'https://paypal.com/checkout/abc',
      chargedAmount: 11.12,
      chargedCurrency: 'USD',
    });
    const res = await initiate(req({ token: 'good', method: 'paypal' }));
    expect(res.status).toBe(201);
    expect(svc.initiatePublicPayment).toHaveBeenCalledWith(5150, 'paypal');
    const body = await res.json();
    expect(body.data.chargedAmount).toBe(11.12);
    expect(body.data.chargedCurrency).toBe('USD');
  });

  it('forwards card', async () => {
    (svc.initiatePublicPayment as any).mockResolvedValue({
      checkoutUrl: 'https://paypal.com/checkout/abc',
      chargedAmount: 11.12,
      chargedCurrency: 'USD',
    });
    await initiate(req({ token: 'good', method: 'card' }));
    expect(svc.initiatePublicPayment).toHaveBeenCalledWith(5150, 'card');
  });

  it('400 on an unknown method, without calling the service', async () => {
    const res = await initiate(req({ token: 'good', method: 'gopay' }));
    expect(res.status).toBe(400);
    expect(svc.initiatePublicPayment).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/payments/public-routes.test.ts`
Expected: FAIL — the service is called with one argument, and `method: 'gopay'` returns 201 instead of 400.

- [ ] **Step 3: Update the public route**

In `src/app/api/v1/public/payments/route.ts`, replace `bodySchema`:

```ts
const bodySchema = z.object({
  token: z.string().min(1),
  method: z.enum(['xendit', 'paypal', 'card']).default('xendit'),
});
```

And replace the service call:

```ts
    const result = await initiatePublicPayment(appointmentId, parsed.data.method);
```

The route already returns `{ data: result }`, so the charged figures reach the client with no further change.

- [ ] **Step 4: Update the session route**

In `src/app/api/v1/sessions/payment-verify/route.ts`, replace line 11:

```ts
const bodySchema = z.object({ billId: z.string().min(1) });
```

with:

```ts
const bodySchema = z.object({
  billId: z.string().min(1),
  method: z.enum(['xendit', 'paypal', 'card']).default('xendit'),
});
```

and replace the service call:

```ts
    const result = await ensureSessionPayment(parsed.data.billId);
```

with:

```ts
    const result = await ensureSessionPayment(parsed.data.billId, parsed.data.method);
```

Leave everything else alone — the `requireRoles` gate, the `KcError` mapping, and the
`{ data: result }` / 200 response all still apply, and the extra response fields ride
along automatically.

Note the error message on a schema failure is `'billId is required'`. An invalid `method`
now also lands there, which is slightly misleading but not worth a second branch; the
status code is right and the body names the field set.

- [ ] **Step 5: Add the matching session-route tests**

This route is behind `requireRoles`, so **every** test must mock it first or the handler
returns 401 before the schema is ever reached. The file's existing helpers are
`paymentVerify` (the handler) and `req` (the request builder); reuse them.

Append to `tests/payments/session-routes.test.ts`:

```ts
describe('POST /sessions/payment-verify — method', () => {
  const staff = { actor: { id: 'u1', role: 'RECEPTIONIST', practiceId: 'p1' } };

  it('defaults to xendit when the body omits a method', async () => {
    (requireRoles as any).mockResolvedValue(staff);
    (svc.ensureSessionPayment as any).mockResolvedValue({
      checkoutUrl: 'https://wp/checkout/9', status: 'pending',
      expectedAmount: 200000, chargedAmount: 200000, chargedCurrency: 'IDR',
    });
    await paymentVerify(req({ billId: '9' }));
    expect(svc.ensureSessionPayment).toHaveBeenCalledWith('9', 'xendit');
  });

  it('forwards paypal and returns the charged figures', async () => {
    (requireRoles as any).mockResolvedValue(staff);
    (svc.ensureSessionPayment as any).mockResolvedValue({
      checkoutUrl: 'https://paypal.com/checkout/abc', status: 'pending',
      expectedAmount: 200000, chargedAmount: 11.12, chargedCurrency: 'USD',
    });
    const res = await paymentVerify(req({ billId: '9', method: 'paypal' }));
    expect(svc.ensureSessionPayment).toHaveBeenCalledWith('9', 'paypal');
    const body = await res.json();
    expect(body.data.chargedAmount).toBe(11.12);
    expect(body.data.chargedCurrency).toBe('USD');
  });

  it('400 on an unknown method, without calling the service', async () => {
    (requireRoles as any).mockResolvedValue(staff);
    const res = await paymentVerify(req({ billId: '9', method: 'gopay' }));
    expect(res.status).toBe(400);
    expect(svc.ensureSessionPayment).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: Run the whole payment suite**

Run: `npx vitest run tests/payments/`
Expected: all files passing, with the new tests included.

- [ ] **Step 7: Typecheck the whole app**

Run: `npx tsc --noEmit`
Expected: no errors. Any error here means a caller of the changed signatures was missed.

- [ ] **Step 8: Commit**

```bash
git add src/app/api/v1/public/payments/route.ts src/app/api/v1/sessions/payment-verify/route.ts tests/payments/public-routes.test.ts tests/payments/session-routes.test.ts
git commit -m "feat(payments): accept a payment method on both initiation routes

method is optional and defaults to xendit, so existing front-end callers are
unaffected. An unrecognised value is a 400 before the service is reached
rather than a silent fallback that would charge rupiah for a dollar payment.

Both responses now include chargedAmount and chargedCurrency so the front-end
can show the figure the payer will actually be billed."
```

---

### Task 12: API contract — OpenAPI spec and front-end guide

**Files:**
- Modify: `docs/api/openapi.yaml` (`/api/v1/public/payments` ~line 8760, `/api/v1/sessions/payment-verify`, `PaymentStatusView` line 12706, `CheckoutUrlResult` line 12724)
- Create: `docs/api/PAYMENT-METHODS-GUIDE.md`

**Interfaces:**
- Consumes: the route shapes from Task 11.
- Produces: nothing in code. `docs/api/` uses SCREAMING-KEBAB names for guides (`OTP-LOGIN-GUIDE.md`, `PASSWORD-RESET-GUIDE.md`) — follow it.

- [ ] **Step 1: Add `method` to both request bodies in `openapi.yaml`**

Under `/api/v1/public/payments` → `post` → `requestBody`, add a second property beside `token`:

```yaml
                method:
                  type: string
                  enum: [xendit, paypal, card]
                  default: xendit
                  description: >-
                    Omitted means `xendit` (IDR). `paypal` and `card` both charge in USD via
                    PayPal's hosted page and differ only in which form it opens on. An
                    unrecognised value is a 400, never a silent fallback.
```

Under `/api/v1/sessions/payment-verify` → `post` → `requestBody`, add the same block beside `billId`. Leave both `required:` lists unchanged — `method` is optional.

- [ ] **Step 2: Add the charged figures to both response schemas**

Replace `CheckoutUrlResult` (line 12724) with:

```yaml
    CheckoutUrlResult:
      type: object
      properties:
        checkoutUrl:
          type: string
        chargedAmount:
          type: number
          description: What the payer will be billed, in `chargedCurrency`.
        chargedCurrency:
          type: string
          description: ISO 4217. `IDR` for Xendit; `USD` for paypal/card.
      required:
        - checkoutUrl
        - chargedAmount
        - chargedCurrency
```

And add to `PaymentStatusView`'s `properties` (line 12709), after `expectedAmount`:

```yaml
        chargedAmount:
          type: number
          description: >-
            What the payer was actually billed, in `chargedCurrency`. Display THIS, not
            `expectedAmount` — for a PayPal payment `expectedAmount` is a rupiah figure the
            payer never saw.
        chargedCurrency:
          type: string
          description: ISO 4217. `IDR` for Xendit; `USD` for paypal/card.
```

`SessionPaymentEnsureResult` inherits these through its `allOf` on `PaymentStatusView`, so it needs no edit.

- [ ] **Step 3: Correct the two path descriptions**

Both descriptions say "WooCommerce/Xendit checkout". Change each to "WooCommerce checkout (Xendit, PayPal, or card — see `method`)", and in the public one change the envelope line to:

```
        **Response envelope:** `{ data: { checkoutUrl, chargedAmount, chargedCurrency } }` / RFC-7807 problem+json.
```

- [ ] **Step 4: Verify the YAML still parses**

Run: `python3 -c "import yaml,sys; yaml.safe_load(open('docs/api/openapi.yaml')); print('openapi.yaml parses')"`
Expected: `openapi.yaml parses`

- [ ] **Step 5: Write the front-end guide**

Create `docs/api/PAYMENT-METHODS-GUIDE.md`:

```markdown
# Payment Methods — Front-End Guide

**Backend:** plugin 1.5.0 + app from 2026-09-01.
**Spec:** `docs/superpowers/specs/2026-09-01-paypal-payment-design.md`

## What changed

Both payment-initiation endpoints now accept an optional `method`. Omitting it keeps
today's behaviour exactly, so **no front-end change is required to keep working**.

| method | Charged in | Patient sees |
| --- | --- | --- |
| `xendit` (default) | IDR | Xendit hosted page: VA, QRIS, e-wallets |
| `paypal` | USD | PayPal hosted page, opening on the PayPal login |
| `card` | USD | The same PayPal page, opening on the debit/credit card form |

`paypal` and `card` reach the same PayPal page; they differ only in which form it opens
on. A payer with no PayPal account can pay by card on either.

## Requests

```http
POST /api/v1/public/payments
Content-Type: application/json

{ "token": "<appointment token>", "method": "card" }
```

```http
POST /api/v1/sessions/payment-verify
Authorization: Bearer <jwt>
Content-Type: application/json

{ "billId": "9", "method": "paypal" }
```

`method` is one of `xendit` | `paypal` | `card`. Anything else is **400**; it is not
silently defaulted, because falling back to Xendit would charge rupiah for a payment the
patient chose to make in dollars.

## Responses

`POST /public/payments` → **201**

```json
{
  "data": {
    "checkoutUrl": "https://www.paypal.com/checkoutnow?token=...",
    "chargedAmount": 11.12,
    "chargedCurrency": "USD"
  }
}
```

The status endpoints (`POST /public/payment-verify`, `/sessions/payment-success`,
`/sessions/payment-cancel`) return `chargedAmount` and `chargedCurrency` alongside the
existing `status` and `expectedAmount`.

## Displaying the amount — please read

`expectedAmount` is **always integer rupiah**. It is the clinic's internal figure and is
**not** what a PayPal payer was billed.

Show `chargedAmount` formatted by `chargedCurrency`:

- `IDR` → `Rp 200.000` (no decimals)
- `USD` → `$11.12` (2 decimals)

Showing `expectedAmount` on a PayPal payment displays a rupiah number the patient never
saw on their statement.

## Redirect behaviour

- **Success** → the `returnUrl` the backend supplied; the patient lands back on the
  front-end.
- **Failure or cancel** → the **WooCommerce checkout page**, not the front-end. Both the
  Xendit and PayPal plugins hardcode this and neither exposes a filter. Known technical
  debt, unchanged by this work. Keep polling `/public/payment-verify`; an unpaid
  appointment auto-cancels after 1 hour regardless.

## Not available

Card fields rendered inside our own pages, Apple Pay, Google Pay, and PayPal Fastlane all
require PayPal's Advanced Card Processing, for which **Indonesia is not eligible**. These
are unavailable, not merely unbuilt — do not design UI that assumes them.
```

- [ ] **Step 6: Commit**

```bash
git add docs/api/openapi.yaml docs/api/PAYMENT-METHODS-GUIDE.md
git commit -m "docs(payments): document the method parameter and charged figures

The Laravel front-end is maintained separately, so the API side ships a written
contract rather than a UI change, and openapi.yaml is updated so the generated
Postman collection carries the new field too.

Both documents lead with the thing easiest to get wrong: expectedAmount is
always rupiah and is not what a PayPal payer was billed. They also state that
on-site card fields are unavailable in Indonesia rather than simply unbuilt, so
nobody designs UI around them."
```

---

### Task 13: Deployment runbook and sandbox verification

**Files:**
- Create: `docs/deploy/paypal-payment-runbook.md`

**Interfaces:**
- Consumes: everything above.
- Produces: nothing in code.

- [ ] **Step 1: Confirm the whole suite and typecheck are green**

Run: `npx vitest run tests/payments/ && npx tsc --noEmit`
Expected: all tests pass, no type errors.

- [ ] **Step 2: Lint every PHP file one final time**

Run the `php -l` command from the plan's command list.
Expected: no output.

- [ ] **Step 3: Write the runbook**

Create `docs/deploy/paypal-payment-runbook.md`:

```markdown
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
```

- [ ] **Step 4: Commit**

```bash
git add docs/deploy/paypal-payment-runbook.md
git commit -m "docs(payments): runbook for deploying and sandbox-testing PayPal

Leads with the live-mode warning: the box is connected with production
credentials, so a careless test moves real money.

Records the two traps that have each cost a debugging session already -- a
.next-only deploy leaves the Prisma client stale, and curl from a local machine
gets a WAF bot-check page instead of JSON, so verification runs on the server."
```

---

## Notes for whoever executes this

**Ordering matters in two places.** Tasks 2–7 (plugin) come before 8–11 (Next.js) because the app reads response fields the plugin has to be sending first. And Task 1 comes before Task 9, which writes to the columns it adds.

**The plugin cannot be tested end-to-end locally.** There is no PHP binary in WSL and no local WordPress. `php -l` plus the pure-PHP `test-money.php` is the full extent of local verification; the rest is Task 13's sandbox run. That is exactly why the conversion was pulled into a WordPress-free class — it is the one piece of plugin logic that can be proven before deploying, and a fatal in a WordPress plugin takes the whole site down.

**Two hazards to keep in mind while editing:**
- `wp_kc_*` tables are MyISAM on staging and production. Do not add a `prisma.$transaction` wrapper around anything touching them; it compiles, runs, and guarantees nothing.
- The staging box's runtime env comes from the cPanel Node.js Selector, not `.env` or `.htaccess`. This plan deliberately adds no new env var, which is why the FX rate lives in wp-admin.
