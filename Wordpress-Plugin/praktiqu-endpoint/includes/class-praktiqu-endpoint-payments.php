<?php
/**
 * Payments — WooCommerce order bridge for the Xendit-via-WooCommerce
 * payment feature (2026-07-14 design).
 *
 * Creates WC orders directly (KiviCare `create_wc_direct_order` pattern:
 * one virtual product per line item, taxes as WC_Order_Item_Fee), exposes
 * order status for the verify-fallback path, and dispatches a dedicated,
 * separately-secreted signed webhook on completion/failure/expiry — kept
 * apart from Hooks::dispatch_webhook() (which serves user-lifecycle events)
 * so payment webhook trust can be rotated independently.
 *
 * @package PraktiQU\Endpoint
 */

declare(strict_types=1);

namespace PraktiQU\Endpoint;

defined('ABSPATH') || exit;

final class Payments
{
    public function register(): void
    {
        add_action('woocommerce_order_status_changed', [$this, 'on_order_status_changed'], 10, 4);
        add_action('woocommerce_payment_complete', [$this, 'on_payment_complete'], 10, 1);
        add_filter('woocommerce_get_return_url', [$this, 'filter_return_url'], 10, 2);
    }

    /**
     * Create a WooCommerce order for an appointment (public) or bill (session).
     *
     * @param array $input {
     *   source: 'public'|'session', appointmentId?: string, billId?: string,
     *   encounterId?: string, customerEmail: string,
     *   items: array<{name:string,price:number}>, taxes: array<{name:string,amount:number}>,
     *   returnUrl: string, cancelUrl: string
     * }
     */
    public function create_order(array $input): array|\WP_Error
    {
        if (!class_exists('WooCommerce')) {
            return new \WP_Error('woocommerce_missing', 'WooCommerce is not active', ['status' => 503]);
        }

        $method = (string) ($input['method'] ?? 'xendit');
        if (!in_array($method, ['xendit', 'paypal', 'card'], true)) {
            return new \WP_Error(
                'unknown_method',
                sprintf('Unknown payment method "%s"', $method),
                ['status' => 400]
            );
        }

        // PayPal has no IDR (verified against the PPCP plugin's own supported list),
        // so paypal/card orders are priced in USD from a rate the clinic maintains
        // in wp-admin. Xendit orders stay in the store currency, untouched.
        //
        // Resolved before wc_create_order(): it needs nothing from the order, and a
        // missing rate is a request-level failure like the unknown-method check
        // above. Doing this after order creation meant a missing rate cancelled the
        // order it had just created — correctly not treated as ours by
        // is_praktiqu_order() (no praktiqu_* meta is written yet, so no spurious
        // webhook), but still an unsweepable, unidentifiable cancelled order sitting
        // in WooCommerce with debt this project already carries too much of. Now a
        // missing rate creates no order at all.
        $is_foreign = ($method === 'paypal' || $method === 'card');
        $rate       = 0.0;
        $markup     = 0.0;
        if ($is_foreign) {
            $rate = (float) get_option('praktiqu_endpoint_paypal_idr_rate', '0');
            if ($rate <= 0) {
                return new \WP_Error(
                    'paypal_rate_missing',
                    'PayPal FX rate is not configured (Settings -> PraktiQU Endpoint)',
                    ['status' => 503]
                );
            }

            // Unlike the rate, an absent/invalid markup is not a hard failure:
            // "no markup configured" is a legitimate state (clamp to 0.0 and
            // proceed), whereas an absent rate makes the charge itself
            // undefined (hard-fails above). sanitize_markup_percent() keeps the
            // stored option within [0, 100] on save, but that guard only covers
            // values that went through the settings form — wp-cli, another
            // plugin, or a direct DB edit can still write something out of
            // range. So both ends are re-clamped here too, defence-in-depth,
            // not validation: an out-of-range value is silently clamped into
            // [0, 100] and the request proceeds, it never becomes a 503 (only
            // a missing/non-positive rate does that, above).
            $markup_raw = get_option('praktiqu_endpoint_paypal_markup_percent', '0');
            $markup     = is_numeric($markup_raw) ? (float) $markup_raw : 0.0;
            if ($markup < 0) {
                $markup = 0.0;
            } elseif ($markup > 100) {
                $markup = 100.0;
            }
        }

        $order = wc_create_order();
        if (is_wp_error($order)) {
            return new \WP_Error(
                'order_create_failed',
                'Failed to create WooCommerce order: ' . $order->get_error_message(),
                ['status' => 500]
            );
        }

        if ($is_foreign) {
            $order->set_currency('USD');
        }

        // Computed once so the metadata and both return paths below cannot
        // disagree about what currency/rate the patient was actually charged.
        $charge_currency = $is_foreign ? 'USD' : get_woocommerce_currency();

        // fxRate returned to the caller is the EFFECTIVE rate (rate adjusted
        // for markup), deliberately different from the raw market rate saved
        // as praktiqu_fx_rate meta below: expectedAmount / fxRate approximately
        // reconstructs chargedAmount for reconciliation months later, and
        // chargedAmount already has the markup baked in, so fxRate must too.
        // "Approximately" is not hand-waving: per-line ceiling rounding (decision
        // 6) means a multi-line order's chargedAmount is always a little above the
        // unrounded conversion, so the two figures never match to the cent — that
        // gap is the accumulated per-line ceiling remainder, and it accrues to the
        // clinic by design. Do not "fix" one of these two figures to match the
        // other; the gap is expected, not a bug.
        // $markup is clamped to >= 0 above, so this denominator is always
        // >= 1 — no divide-by-zero guard needed.
        $fx_rate = $is_foreign ? $rate / (1 + $markup / 100) : null;

        foreach ((array) ($input['items'] ?? []) as $item) {
            $price = (float) ($item['price'] ?? 0);
            if ($is_foreign) {
                $price = Money::idr_to_foreign($price, $rate, $markup);
            }
            $product = new \WC_Product_Simple();
            $product->set_name((string) ($item['name'] ?? 'Service'));
            $product->set_status('publish');
            $product->set_price((string) $price);
            $product->set_regular_price((string) $price);
            $product->set_virtual(true);
            $product->set_sold_individually(true);
            $product->set_catalog_visibility('hidden');
            $product->set_manage_stock(false);
            $product->set_stock_status('instock');
            $product_id = $product->save();
            $order->add_product(wc_get_product($product_id), 1);
        }

        foreach ((array) ($input['taxes'] ?? []) as $tax) {
            $amount = (float) ($tax['amount'] ?? 0);
            if ($amount <= 0) {
                continue;
            }
            if ($is_foreign) {
                $amount = Money::idr_to_foreign($amount, $rate, $markup);
            }
            $fee = new \WC_Order_Item_Fee();
            $fee->set_name((string) ($tax['name'] ?? 'Tax'));
            $fee->set_amount((string) $amount);
            $fee->set_total((string) $amount);
            $order->add_item($fee);
        }

        $order->set_billing_email((string) ($input['customerEmail'] ?? ''));
        $order->update_meta_data('praktiqu_source', (string) ($input['source'] ?? 'public'));
        $order->update_meta_data('praktiqu_method', $method);
        // The raw rupiah figure the clinic's disbursement reconciles against —
        // computed plainly (rather than via array_map/array_merge) because
        // this is the number that has to be obviously correct.
        $expected_idr = 0.0;
        foreach ((array) ($input['items'] ?? []) as $row) {
            $expected_idr += (float) ($row['price'] ?? $row['amount'] ?? 0);
        }
        foreach ((array) ($input['taxes'] ?? []) as $row) {
            $expected_idr += (float) ($row['price'] ?? $row['amount'] ?? 0);
        }

        $order->update_meta_data('praktiqu_charge_currency', $charge_currency);
        $order->update_meta_data('praktiqu_expected_idr', (string) $expected_idr);
        if ($is_foreign) {
            // praktiqu_fx_rate is the RAW market rate, not the effective rate
            // returned as fxRate above — disbursement reads WooCommerce order
            // data rather than our database, so both the raw rate and the raw
            // markup have to survive here on their own, even though fxRate
            // already folds them together for reconciliation. Deliberately
            // different figures; do not "fix" one to match the other.
            $order->update_meta_data('praktiqu_fx_rate', (string) $rate);
            $order->update_meta_data('praktiqu_markup_percent', (string) $markup);
        }
        if (!empty($input['appointmentId'])) {
            $order->update_meta_data('praktiqu_appointment_id', (string) $input['appointmentId']);
        }
        if (!empty($input['billId'])) {
            $order->update_meta_data('praktiqu_bill_id', (string) $input['billId']);
        }
        if (!empty($input['encounterId'])) {
            $order->update_meta_data('praktiqu_encounter_id', (string) $input['encounterId']);
        }
        if (!empty($input['returnUrl'])) {
            $order->update_meta_data('praktiqu_return_url', esc_url_raw((string) $input['returnUrl']));
        }
        if (!empty($input['cancelUrl'])) {
            $order->update_meta_data('praktiqu_cancel_url', esc_url_raw((string) $input['cancelUrl']));
        }

        // wc_get_price_decimals() reads the store-wide woocommerce_price_num_decimals
        // option, not a per-order setting. calculate_totals() rounds every line and
        // the final total to that many decimals, which can erase the per-line ceil
        // Money::idr_to_foreign() just applied (e.g. store set to 0 decimals turns
        // a $0.28 foreign total into $0 — see the invariant check below). Pin 2
        // decimals for the duration of this order's calculation only, and only for
        // a foreign (USD) order; a domestic Xendit order keeps the store's own
        // setting, unchanged. The filter is removed in `finally` so an exception
        // thrown by calculate_totals()/save() can't leave it registered for the
        // rest of THIS request. It does not need to guard against leaking into a
        // later, separate request: WordPress rebuilds $wp_filter on every
        // bootstrap, so a PHP-FPM worker reusing a process carries compiled code
        // across requests, never filter state.
        $decimals_filter = static fn (): int => 2;
        if ($is_foreign) {
            add_filter('wc_get_price_decimals', $decimals_filter);
        }
        try {
            $order->calculate_totals();
            $order->save();
        } finally {
            if ($is_foreign) {
                remove_filter('wc_get_price_decimals', $decimals_filter);
            }
        }

        // Guard against a rounding failure being mistaken for a free service:
        // if the input priced out to a non-zero rupiah figure but the order's
        // total collapsed to <= 0 anyway (e.g. the decimals assumption above
        // fails for some other reason), that is a bug, not a free booking —
        // don't let it fall into payment_complete() below.
        if ($expected_idr > 0 && (float) $order->get_total() <= 0) {
            $order->update_status(
                'cancelled',
                'PraktiQU: rounding collapsed a non-zero charge to a zero total'
            );
            return new \WP_Error(
                'amount_collapsed',
                sprintf(
                    'Charge collapsed to zero: expected Rp %d but the WooCommerce order total came out to %s. This is a rounding failure, not a free service.',
                    (int) round($expected_idr),
                    (string) $order->get_total()
                ),
                ['status' => 500]
            );
        }

        // Free service (total 0, below Xendit's minimum): no invoice. Complete
        // the order so our woocommerce_order_status_changed hook books the slot,
        // and send the patient straight to the return URL.
        if ((float) $order->get_total() <= 0) {
            $order->payment_complete();
            return [
                'orderId'         => $order->get_id(),
                'checkoutUrl'     => (string) ($input['returnUrl'] ?? $order->get_checkout_order_received_url()),
                'chargedAmount'   => 0.0,
                'chargedCurrency' => $charge_currency,
                'fxRate'          => $fx_rate,
            ];
        }

        $gateway = $this->resolve_gateway($method);
        if ($gateway === null) {
            $order->update_status('cancelled', sprintf('PraktiQU: no enabled gateway for method "%s"', $method));
            return new \WP_Error(
                'gateway_missing',
                sprintf('No enabled payment gateway for method "%s"', $method),
                ['status' => 503]
            );
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

        $card_filter = $method === 'card' ? $this->force_card_landing_page() : null;
        try {
            $result = $gateway->process_payment($order->get_id());
        } finally {
            // Remove it in `finally`, not after the call: process_payment() can
            // throw, and without `finally` that would leave the filter registered
            // for the rest of THIS request, pushing a later PayPal order in the
            // same request onto the card form too. (A separate, later HTTP request
            // is not at risk either way: WordPress rebuilds $wp_filter on every
            // bootstrap, so a PHP-FPM worker reusing a process carries compiled
            // code across requests, never filter state.)
            if ($card_filter !== null) {
                remove_filter('ppcp_create_order_request_body_data', $card_filter, 10);
            }
        }

        if (!is_array($result) || ($result['result'] ?? '') !== 'success' || empty($result['redirect'])) {
            $message = sprintf('Failed to start payment via "%s"', $method);
            if (function_exists('wc_get_notices')) {
                $errors = wc_get_notices('error');
                if (!empty($errors)) {
                    $first = $errors[0];
                    $message = is_array($first) ? ($first['notice'] ?? $message) : (string) $first;
                }
                wc_clear_notices();
            }
            $order->update_status('cancelled', sprintf('PraktiQU: payment start failed for method "%s"', $method));
            return new \WP_Error('payment_start_failed', $message, ['status' => 502]);
        }

        return [
            'orderId'         => $order->get_id(),
            'checkoutUrl'     => (string) $result['redirect'],
            'chargedAmount'   => (float) $order->get_total(),
            'chargedCurrency' => $charge_currency,
            'fxRate'          => $fx_rate,
        ];
    }

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

    public function get_order_status(int $order_id): array|\WP_Error
    {
        if (!class_exists('WooCommerce')) {
            return new \WP_Error('woocommerce_missing', 'WooCommerce is not active', ['status' => 503]);
        }
        $order = wc_get_order($order_id);
        if (!$order instanceof \WC_Order) {
            return new \WP_Error('order_not_found', 'WooCommerce order not found', ['status' => 404]);
        }
        [$amount, $currency] = $this->order_amount_and_currency($order);

        return [
            'orderId'       => $order_id,
            'status'        => $order->get_status(),
            'isPaid'        => $order->is_paid(),
            'transactionId' => $order->get_transaction_id() ?: null,
            'amount'        => $amount,
            'currency'      => $currency,
        ];
    }

    /**
     * Cancel a WC order that never completed payment. Called by
     * Jobs::handle_payment_auto_cancel. Never cancels an already-paid order.
     */
    public function cancel_order(int $order_id): void
    {
        $order = wc_get_order($order_id);
        if (!$order instanceof \WC_Order || $order->is_paid()) {
            return;
        }
        $order->update_status('cancelled', 'PraktiQU auto-cancel: payment window expired.');
    }

    public function on_order_status_changed(int $order_id, string $old_status, string $new_status, \WC_Order $order): void
    {
        if (!$this->is_praktiqu_order($order)) {
            return;
        }
        // Distinguish the two outcomes so exactly one webhook fires per
        // transition. A cancelled order maps to 'payment.expired' (whether
        // cancelled by the auto-cancel job or manually in wp-admin) — the
        // Next.js side treats both the same way (release the held slot). A
        // failed order (e.g. a declined card) maps to 'payment.failed'. These
        // must NOT both fire for a 'cancelled' transition — see
        // Jobs::handle_payment_auto_cancel(), which used to also explicitly
        // dispatch 'payment.expired' after this hook already fired
        // 'payment.failed' for the same event, causing a double-dispatch race.
        if ($new_status === 'cancelled') {
            $this->dispatch_payment_webhook('payment.expired', $order);
        } elseif ($new_status === 'failed') {
            $this->dispatch_payment_webhook('payment.failed', $order);
        }
    }

    public function on_payment_complete(int $order_id): void
    {
        $order = wc_get_order($order_id);
        if (!$order instanceof \WC_Order || !$this->is_praktiqu_order($order)) {
            return;
        }
        $this->dispatch_payment_webhook('payment.completed', $order);
    }

    private function is_praktiqu_order(\WC_Order $order): bool
    {
        return (bool) ($order->get_meta('praktiqu_appointment_id') || $order->get_meta('praktiqu_bill_id'));
    }

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

    /**
     * Fire a payment-specific webhook, signed with the dedicated payment
     * webhook secret (see Settings — kept separate from the general secret
     * used for password/user events).
     */
    public function dispatch_payment_webhook(string $event, \WC_Order $order): void
    {
        $url = (string) get_option('praktiqu_endpoint_payment_webhook_url', '');
        if ($url === '') {
            return;
        }
        $secret = (string) get_option('praktiqu_endpoint_payment_webhook_secret', '');

        [$amount, $currency] = $this->order_amount_and_currency($order);

        $payload = [
            'event'         => $event,
            'wcOrderId'     => $order->get_id(),
            'amountPaid'    => $amount,
            'currency'      => $currency,
            'transactionId' => $order->get_transaction_id() ?: null,
            'source'        => $order->get_meta('praktiqu_source') ?: 'public',
            'issuedAt'      => gmdate('c'),
        ];
        $body = wp_json_encode($payload);
        if ($body === false) {
            return;
        }
        $signature = $secret !== '' ? hash_hmac('sha256', $body, $secret) : '';

        $response = wp_remote_post($url, [
            'method'      => 'POST',
            'timeout'     => 5,
            'redirection' => 0,
            'headers'     => [
                'Content-Type'                 => 'application/json',
                'X-PraktiQU-Webhook-Signature' => $signature,
            ],
            'body'        => $body,
            'blocking'    => false,
        ]);
        if (is_wp_error($response) && defined('WP_DEBUG') && WP_DEBUG) {
            error_log('[praktiqu-endpoint] payment webhook dispatch failed: ' . $response->get_error_message());
        }
    }
}
