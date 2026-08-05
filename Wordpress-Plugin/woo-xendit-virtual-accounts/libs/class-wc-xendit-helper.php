<?php

if (!defined('ABSPATH')) {
    exit;
}

final class WC_Xendit_PG_Helper
{
    public static function get_order_id($order)
    {
        return $order->get_id();
    }

    /**
     * Generate items and customers
     *
     * @param WC_Order $order
     * @return array
     */
    public static function generate_items_and_customer(WC_Order $order): array
    {
        if (!is_object($order)) {
            return [];
        }

        $items = array();

        // If order is deposit then using parent order to generate invoice data
        if (self::is_deposit_order($order)) {
            $parent = wc_get_order($order->get_parent_id());
            if ($parent) {
                $order = $parent;
            }
        }

        foreach ($order->get_items() as $item_data) {
            if (!is_object($item_data)) {
                continue;
            }

            // Get an instance of WC_Product object
            /** @var WC_Product $product */
            $product = $item_data->get_product();
            if (!is_object($product)) {
                continue;
            }

            // Get all category names of item
            $category_names = wp_get_post_terms($item_data->get_product_id(), 'product_cat', ['fields' => 'names']);

            $item = array();
            $item['id']         = $product->get_id();
            $item['name']       = $product->get_name();
            $item['price']      = $order->get_item_subtotal($item_data);
            $item['type']       = "PRODUCT";
            $item['quantity']   = $item_data->get_quantity();

            if (!empty(get_permalink($item['id']))) {
                $item['url']    = get_permalink($item['id']);
            }

            if (!empty($category_names)) {
                $item['category']   = implode(', ', $category_names);
            }

            $items[] = json_encode(array_map('strval', $item));
        }

        $customer = array();
        $email = $order->get_billing_email();
        $phone_number = WC_Xendit_Phone_Number_Format::formatNumber($order->get_billing_phone(), $order->get_billing_country());
        $customer['given_names']            = $order->get_billing_first_name();
        $customer['surname']                = $order->get_billing_last_name();

        if (!empty($email)) {
            $customer['email']                  = $email;
        }

        if (!empty($phone_number)) {
            $customer['mobile_number']          = $phone_number;
        }

        $address_details = array_filter(
            array(
            'country'       => $order->get_billing_country(),
            'street_line1'  => $order->get_billing_address_1(),
            'street_line2'  => $order->get_billing_address_2(),
            'city'          => $order->get_billing_city(),
            'state'         => $order->get_billing_state(),
            'postal_code'   => $order->get_billing_postcode()
            )
        );

        if (!empty($address_details)) {
            $customer['addresses']              = array(
                    (object) $address_details
            );
        }

        return array(
            'items' => '[' . implode(",", $items) . ']',
            'customer' => json_encode($customer)
        );
    }

    /**
     * @param $transaction_id
     * @param $status
     * @param $payment_method
     * @param $currency
     * @param $amount
     * @param $installment
     * @return string
     */
    public static function build_order_notes($transaction_id, $status, $payment_method, $currency, $amount, $installment = '')
    {
        $notes  = "Transaction ID: " . $transaction_id . "<br>";
        $notes .= "Status: " . $status . "<br>";
        $notes .= "Payment Method: " . str_replace("_", " ", $payment_method) . "<br>";
        $notes .= "Amount: " . $currency . " " . number_format($amount);

        if ($installment) {
            $notes .= " (" . $installment . " installment)";
        }

        return $notes;
    }

    /**
     * @param WC_Order $order
     * @param $notes
     * @param $success_payment_status
     * @param $transaction_id
     * @return void
     */
    public static function complete_payment(WC_Order $order, $notes, $success_payment_status = 'processing', $transaction_id = '')
    {
        // Add a default payment status.
        // Our default value doesn't working properly on some merchant's site.
        if (empty($success_payment_status)) {
            $success_payment_status = "processing";
        }

        $order->add_order_note('<b>Xendit payment successful.</b><br>' . $notes);
        $order->payment_complete($transaction_id);

        if ($success_payment_status != 'default' && $order->get_status() != $success_payment_status) {
            $order->set_status($success_payment_status, '--');
            $order->save();
        }

        // Reduce stock levels
        wc_reduce_stock_levels($order->get_id());
    }

    public static function cancel_order($order, $note)
    {
        $order->update_status('wc-cancelled');
        $order->add_order_note($note);
    }

    public function validate_form($data)
    {
        global $wpdb, $woocommerce;

        $countries = new WC_Countries();
        $result = [];
        $billlingfields = $countries->get_address_fields($countries->get_base_country(), 'billing_');
        $shippingfields = $countries->get_address_fields($countries->get_base_country(), 'shipping_');
        foreach ($billlingfields as $key => $val) {
            if ($val['required'] == 1) {
                if (empty($data[$key])) {
                    array_push($result, 'Billing '.$val['label'].' is a required field.');
                }
            }
        }

        foreach ($shippingfields as $key => $val) {
            if ($val['required'] === 1) {
                if (empty($data[$key])) {
                    array_push($result, 'Shipping '.$val['label'].' is a required field.');
                }
            }
        }

        return (count($result) > 0) ? array('error_code' => 'VALIDATION_ERROR', 'message' => $result) : $result;
    }

    /**
     * Checks if subscriptions are enabled on the site.
     *
     * @return bool Whether subscriptions is enabled or not.
     * @since  5.6.0
     */
    public static function is_subscriptions_enabled()
    {
        return class_exists('WC_Subscriptions') && version_compare(WC_Subscriptions::$version, '2.2.0', '>=');
    }

    /**
     * Is $order_id a subscription?
     *
     * @param  int $order_id
     * @return boolean
     * @since  5.6.0
     */
    public static function has_subscription($order_id)
    {
        return (function_exists('wcs_order_contains_subscription') && (wcs_order_contains_subscription($order_id) || wcs_is_subscription($order_id) || wcs_order_contains_renewal($order_id)));
    }

    /**
     * Returns whether this user is changing the payment method for a subscription.
     *
     * @return bool
     * @since  5.6.0
     */
    public static function is_changing_payment_method_for_subscription()
    {
        if (isset($_GET['change_payment_method'])) { // phpcs:ignore WordPress.Security.NonceVerification
            return wcs_is_subscription(wc_clean(wp_unslash($_GET['change_payment_method']))); // phpcs:ignore WordPress.Security.NonceVerification
        }
        return false;
    }

    /**
     * Maybe process payment method change for subscriptions.
     *
     * @param  int $order_id
     * @return bool
     * @since  5.6.0
     */
    public static function order_contains_subscription($order_id)
    {
        return (
            self::is_subscriptions_enabled() &&
            self::has_subscription($order_id)
        );
    }

    /**
     * Check if order is subscription
     *
     * @param  $order
     * @return bool
     */
    public static function is_subscription($order)
    {
        return (
            self::is_subscriptions_enabled() &&
            wcs_is_subscription($order)
        );
    }

    /**
     * Maybe process payment method change for subscriptions.
     *
     * @param  int $order_id
     * @return bool
     * @since  5.6.0
     */
    public static function maybe_change_subscription_payment_method($order_id)
    {
        return (
            self::is_subscriptions_enabled() &&
            self::has_subscription($order_id) &&
            self::is_changing_payment_method_for_subscription()
        );
    }

    /**
     * @param string $payment_class
     * @return string
     */
    public static function generate_setting_key_by_payment_class(string $payment_class): string
    {
        $payment_id = strtolower(str_replace('WC_', '', $payment_class));
        return sprintf('woocommerce_%s_settings', $payment_id);
    }

    /**
     * Extract all enabled Xendit payment channel in WC
     *
     * @return array
     */
    public static function extract_enabled_payments(): array
    {
        global $wc_xendit_pg;
        $payment_methods = [];

        $xendit_payments = $wc_xendit_pg->woocommerce_xendit_payment_settings();
        foreach ($xendit_payments as $payment_class) {
            // WC_Xendit_CC_Addons used for subscription
            // but the main class is WC_Xendit_CC
            if ($payment_class === 'WC_Xendit_CC_Addons') {
                $payment_class = 'WC_Xendit_CC';
            }

            // Make sure const XENDIT_METHOD_CODE defined in Payment method class
            if (!defined("$payment_class::XENDIT_METHOD_CODE")) {
                continue;
            }

            $option_key = self::generate_setting_key_by_payment_class($payment_class);
            $settings = get_option($option_key);
            if (!empty($settings['enabled']) && $settings['enabled'] === 'yes') {
                $payment_methods[] = strtoupper($payment_class::XENDIT_METHOD_CODE);
            }
        }

        return $payment_methods;
    }

    /**
     * Check if order is deposit
     *
     * @param WC_Order $order
     * @return bool
     */
    public static function is_deposit_order(WC_Order $order): bool
    {
        // Plugin URL: https://wordpress.org/plugins/deposits-partial-payments-for-woocommerce/
        if (in_array($order->get_meta('_awcdp_deposits_payment_type', true), ['deposit', 'second_payment'])) {
            return true;
        }

        return false;
    }

    /**
     * Generate invoice description
     *
     * @param WC_Order $order
     * @return string
     */
    public static function generate_invoice_description(WC_Order $order): string
    {
        $blog_name = html_entity_decode(get_option('blogname'), ENT_QUOTES | ENT_HTML5);
        $identifier = $order->get_id();

        if (self::is_advanced_order_number_active()) {
            if (method_exists($order, 'get_order_number')) {
                $identifier = $order->get_order_number();
            }
        }

        // Return deposit description
        if (self::is_deposit_order($order) && !empty($order->get_parent_id())) {
            $parent = wc_get_order($order->get_parent_id());
            return sprintf('Partial Payment for order #%s at %s', $identifier, $blog_name);
        }

        return sprintf("Payment for Order #%s at %s", $identifier, $blog_name);
    }

    /**
     * Generate external id
     *
     * @param WC_Order $order
     * @param $external_id_format
     * @return string
     */
    public static function generate_external_id(WC_Order $order, $external_id_format): string
    {
        $identifier = $order->get_id();
        if (self::is_advanced_order_number_active()) {
            if (method_exists($order, 'get_order_number')) {
                $identifier = $order->get_order_number();
            }
        }
        return sprintf('%s-%s', $external_id_format, $identifier);
    }

    /**
     * Check if Advanced Order Number plugin is active and class exists
     * 
     * @return bool
     */
    public static function is_advanced_order_number_active(): bool
    {
        if (!class_exists('Wt_Advanced_Order_Number')) {
            return false;
        }
    
        // Check if plugin is actually active in WordPress
        if (!in_array('wt-woocommerce-sequential-order-numbers/wt-advanced-order-number.php', apply_filters('active_plugins', get_option('active_plugins')))) {
            return false;
        }
    
        return true;
    }
}
