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

        $order = wc_create_order();

        foreach ((array) ($input['items'] ?? []) as $item) {
            $product = new \WC_Product_Simple();
            $product->set_name((string) ($item['name'] ?? 'Service'));
            $product->set_status('publish');
            $product->set_price((string) ($item['price'] ?? 0));
            $product->set_regular_price((string) ($item['price'] ?? 0));
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
            $fee = new \WC_Order_Item_Fee();
            $fee->set_name((string) ($tax['name'] ?? 'Tax'));
            $fee->set_amount((string) $amount);
            $fee->set_total((string) $amount);
            $order->add_item($fee);
        }

        $order->set_billing_email((string) ($input['customerEmail'] ?? ''));
        $order->update_meta_data('praktiqu_source', (string) ($input['source'] ?? 'public'));
        $order->update_meta_data('praktiqu_method', $method);
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

        $order->calculate_totals();
        $order->save();

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

        $result = $gateway->process_payment($order->get_id());

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
            'orderId'     => $order->get_id(),
            'checkoutUrl' => (string) $result['redirect'],
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
        return [
            'orderId'       => $order_id,
            'status'        => $order->get_status(),
            'isPaid'        => $order->is_paid(),
            'transactionId' => $order->get_transaction_id() ?: null,
            'amount'        => (int) round((float) $order->get_total()),
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

        $payload = [
            'event'         => $event,
            'wcOrderId'     => $order->get_id(),
            'amountPaid'    => (int) round((float) $order->get_total()),
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
