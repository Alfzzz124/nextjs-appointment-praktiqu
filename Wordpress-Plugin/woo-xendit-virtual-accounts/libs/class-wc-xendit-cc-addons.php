<?php
if (! defined('ABSPATH')) {
    exit;
}

/**
 * WC_Gateway_Xendit_Addons class.
 *
 * @extends WC_Gateway_Xendit
 */
class WC_Xendit_CC_Addons extends WC_Xendit_CC
{
    /**
     * Constructor
     */
    public function __construct()
    {
        parent::__construct();

        // subscribe action and filter if Woocommerce Subscription plugins exist
        if (class_exists('WC_Subscriptions_Order')) {
            // Trigger a hook for gateways to charge recurring payments.
            add_action('woocommerce_scheduled_subscription_payment', array( $this, 'gateway_scheduled_subscription_payment' ), 10, 1);
            // action that is initiated by renewal
            add_action('woocommerce_scheduled_subscription_payment_' . $this->id, array( $this, 'scheduled_subscription_payment' ), 10, 2);
            add_action('wcs_resubscribe_order_created', array( $this, 'delete_resubscribe_meta' ), 10);
            add_action('wcs_renewal_order_created', array( $this, 'delete_renewal_meta' ), 10);
            add_action('woocommerce_subscription_failing_payment_method_updated_xendit', array( $this, 'update_failing_payment_method' ), 10, 2);
            add_action('woocommerce_checkout_create_subscription', array($this, 'handle_woocommerce_checkout_create_subscription'), 10, 4);

            // display the credit card used for a subscription in the "My Subscriptions" table
            add_filter('woocommerce_my_subscriptions_payment_method', array( $this, 'maybe_render_subscription_payment_method' ), 10, 2);

            // allow store managers to manually set Xendit as the payment method on a subscription
            add_filter('woocommerce_subscription_payment_meta', array( $this, 'add_subscription_payment_meta' ), 10, 2);
            add_filter('woocommerce_subscription_validate_payment_meta', array( $this, 'validate_subscription_payment_meta' ), 10, 2);
        }

        // subscribe action and filter if Woocommerce Pre Order plugins exist
        if (class_exists('WC_Pre_Orders_Order')) {
            add_action('wc_pre_orders_process_pre_order_completion_payment_' . $this->id, array( $this, 'process_pre_order_release_payment' ));
        }
    }

    /**
     * Is $order_id a subscription?
     * @param  int  $order_id
     * @return boolean
     */
    protected function is_subscription($order_id)
    {
        $this->log('[Method] is_subscription called' . PHP_EOL);
        return ( function_exists('wcs_order_contains_subscription') && ( wcs_order_contains_subscription($order_id) || wcs_is_subscription($order_id) || wcs_order_contains_renewal($order_id) ) );
    }

    /**
     * Is $order_id a pre-order?
     * @param  int  $order_id
     * @return boolean
     */
    protected function is_pre_order($order_id)
    {
        $this->log('[Method] is_pre_order called' . PHP_EOL);
        return ( class_exists('WC_Pre_Orders_Order') && WC_Pre_Orders_Order::order_contains_pre_order($order_id) );
    }

    /**
     * Process the payment based on type.
     * @param  int $order_id
     * @return array
     */
    public function process_payment($order_id, bool $retry = true)
    {
        $this->log('[Method] process_payment called' . PHP_EOL);
        if ($this->is_subscription($order_id)) {
            // Regular payment with force subscription enabled
            $this->log('this order ' . print_r($order_id, true) . ' is a subscription' . PHP_EOL);
            return parent::process_payment($order_id, true);
        } elseif ($this->is_pre_order($order_id)) {
            $this->log('this order ' . print_r($order_id, true) . ' is a pre order' . PHP_EOL);
            return $this->process_pre_order($order_id, $retry);
        } else {
            return parent::process_payment($order_id, $retry);
        }
    }

    /**
     * Updates other subscription sources.
     */
    protected function save_source($order, $source)
    {
        $this->log('[Method] save_source called' . PHP_EOL);
        parent::save_source($order, $source);

        $order_id  = $order->get_id();
        // Also store it on the subscriptions being purchased or paid for in the order
        if (function_exists('wcs_order_contains_subscription') && wcs_order_contains_subscription($order_id)) {
            $this->log('save_source contains subscription' . PHP_EOL);
            $subscriptions = wcs_get_subscriptions_for_order($order_id);
        } elseif (function_exists('wcs_order_contains_renewal') && wcs_order_contains_renewal($order_id)) {
            $this->log('save_source contains renewal' . PHP_EOL);
            $subscriptions = wcs_get_subscriptions_for_renewal_order($order_id);
        } else {
            $subscriptions = array();
        }

        foreach ($subscriptions as $subscription) {
            $this->log('first subscription.getID() -> ' . print_r($subscription->get_id(), true) . PHP_EOL);
            $subscription->update_meta_data('_xendit_card_id', $source->source);
        }
    }

    /**
     * process_subscription_payment function.
     * @param mixed $order
     * @param int $amount (default: 0)
     * @return Exception|object|WP_Error
     */
    public function process_subscription_payment($order, $amount = 0)
    {
        $this->log('[Method] process_subscription_payment called' . PHP_EOL);

        try {
            // Get source from order
            $response = null;
            $should_use_default_customer_token = false;
            $source = $this->get_order_source($order);
            $this->log('process_subscription_payment -> get_order_source -> ' . print_r($source, true) . PHP_EOL);

            // If subscription token not exists
            // Using customer default token
            if (!empty($source->source)) {
                $this->log("Info: Begin processing subscription payment for order {$order->get_id()} for the amount of {$amount}");

                // Make the request
                $request = $this->generate_payment_request($order, $source->source, '', false, true);
                $this->log('subscription request is -> ' . print_r($request, true));

                $response = $this->xenditClass->createCharge($request);
            } else {
                $should_use_default_customer_token = true;
            }

            /**
             * API Error handler
             */
            if (!empty($response['error_code'])) {
                // If CC charge external id has been used then it will
                if ($response['error_code'] == 'EXTERNAL_ID_ALREADY_USED_ERROR') {
                    $response = $this->xenditClass->createCharge(
                        $this->generate_payment_request($order, $source->source, '', true, true)
                    );
                } else {
                    $should_use_default_customer_token = true;
                }
            }

            /**
             * Re-charge using Customer default token
             */
            if ($should_use_default_customer_token) {
                $response = $this->process_subscription_payment_by_default_token($order);
            }

            if (!is_wp_error($response) && !empty($response['error_code'])) {
                // throw error if all payments processed failed
                $response['message'] = !empty($response['code']) ? $response['message'] . ' Code: ' . $response['code'] : $response['message'];
                throw new Exception($this->get_localized_error_message($response['error_code'], $response['message']));
            } else {
                // Process valid response
                $this->process_response($response, $order);
            }

            return $response;
        } catch (Exception $e) {
            return new WP_Error('xendit_error', __($e->getMessage(), 'woocommerce-xendit'));
        }
    }

    /**
     * @param $order
     * @return Exception|object|WP_Error
     * @throws Exception
     */
    public function process_subscription_payment_by_default_token($order)
    {
        $this->log('[Method] process_subscription_payment_by_default_token called' . PHP_EOL);

        $error_message = __('Process payment by default customer payment failed.', 'woocommerce-gateway-xendit');
        if (empty($order) || empty($order->get_user_id())) {
            return new WP_Error('xendit_error', $error_message);
        }

        $customer_default_payments = WC_Payment_Tokens::get_customer_tokens($order->get_user_id(), 'xendit_cc');
        $default_token = '';
        foreach ($customer_default_payments as $customer_default_payment) {
            if ($customer_default_payment->is_default()) {
                $default_token = $customer_default_payment->get_token();
            }
        }
        if (empty($default_token)) {
            return new WP_Error('xendit_error', $error_message);
        }

        $request = $this->generate_payment_request($order, $default_token, '', true, true);
        $this->log('subscription request is -> ' . print_r($request, true));
        $response = $this->xenditClass->createCharge($request);

        if (!empty($response['error_code'])) {
            throw new Exception($this->get_localized_error_message($response['error_code'], $response['message']));
        }
        return $response;
    }

    /**
     * Process the pre-order
     *
     * @param $order_id
     * @param $retry
     * @return array|void
     * @throws Exception
     */
    public function process_pre_order($order_id, $retry)
    {
        $this->log('[Method] process_pre_order called' . PHP_EOL);
        if (WC_Pre_Orders_Order::order_requires_payment_tokenization($order_id)) {
            try {
                $order = wc_get_order($order_id);

                $source = $this->get_source(get_current_user_id(), true);

                // We need a source on file to continue.
                if (empty($source->customer) || empty($source->source)) {
                    throw new Exception(__('Unable to store payment details. Please try again.', 'woocommerce-gateway-xendit'));
                }

                // Store source to order meta
                $this->save_source($order, $source);

                // Remove cart
                WC()->cart->empty_cart();

                // Is pre ordered!
                WC_Pre_Orders_Order::mark_order_as_pre_ordered($order);

                // Return thank you page redirect
                return array(
                    'result'   => 'success',
                    'redirect' => $this->get_return_url($order),
                );
            } catch (Exception $e) {
                wc_add_notice($e->getMessage(), 'error');
                return;
            }
        } else {
            return parent::process_payment($order_id, $retry);
        }
    }

    /**
     * Process a pre-order payment when the pre-order is released
     * @param WC_Order $order
     * @return void
     */
    public function process_pre_order_release_payment($order)
    {
        $this->log('[Method] process_pre_order_release_payment called' . PHP_EOL);
        try {
            // Define some callbacks if the first attempt fails.
            $retry_callbacks = array(
                'remove_order_source_before_retry',
                'remove_order_customer_before_retry',
            );

            while (1) {
                $source   = $this->get_order_source($order);
                $response = $this->xenditClass->createCharge($this->generate_payment_request($order, $source->token_id));

                if (!empty($response['error_code'])) {
                    if ($response['error_code'] == 'EXTERNAL_ID_ALREADY_USED_ERROR') {
                        $response = $this->xenditClass->createCharge($this->generate_payment_request($order, $source->token_id, '', true));
                    } else {
                        $response['message'] = !empty($response['code']) ? $response['message'] . ' Code: ' . $response['code'] : $response['message'];
                        throw new Exception($this->get_localized_error_message($response['error_code'], $response['message']));
                    }
                }

                if (is_wp_error($response)) {
                    if (0 === sizeof($retry_callbacks)) {
                        throw new Exception($response->get_error_message());
                    } else {
                        $retry_callback = array_shift($retry_callbacks);
                        call_user_func(array($this, $retry_callback), $order);
                    }
                } else {
                    // Successful
                    $this->process_response($response, $order);
                    break;
                }
            }
        } catch (Exception $e) {
            $order_note = sprintf(__('Xendit Transaction Failed (%s)', 'woocommerce-gateway-xendit'), $e->getMessage());

            // Mark order as failed if not already set,
            // otherwise, make sure we add the order note so we can detect when someone fails to check out multiple times
            if (!$order->has_status('failed')) {
                $order->update_status('failed', $order_note);
            } else {
                $order->add_order_note($order_note);
            }
        }
    }

    /**
     * Don't transfer Xendit customer/token meta to resubscribe orders.
     * @param int $resubscribe_order The order created for the customer to resubscribe to the old expired/cancelled subscription
     */
    public function delete_resubscribe_meta($resubscribe_order)
    {
        $this->log('[Method] delete_resubscribe_meta called' . PHP_EOL);

        /** @var WC_Order $resubscribe_order */
        $resubscribe_order->delete_meta_data('_xendit_card_id');
        $this->delete_renewal_meta($resubscribe_order);
    }

    /**
     * Don't transfer Xendit fee/ID meta to renewal orders.
     * @param int $resubscribe_order The order created for the customer to resubscribe to the old expired/cancelled subscription
     */
    public function delete_renewal_meta($renewal_order)
    {
        $this->log('[Method] delete_renewal_meta called' . PHP_EOL);
        /** @var WC_Order $renewal_order */
        $renewal_order->delete_meta_data('Xendit Fee');
        $renewal_order->delete_meta_data('Net Revenue From Xendit');
        $renewal_order->delete_meta_data('Xendit Payment ID');
        return $renewal_order;
    }

    /**
     * Force set payment gateway for the recurring orders that used xendit_cc
     * to avoid missing auto charge for recurring payment
     *
     * @param $subscription_id
     * @param $deprecated
     * @return void
     * @throws WC_Data_Exception
     */
    public function gateway_scheduled_subscription_payment($subscription_id, $deprecated = null)
    {
        if (! is_object($subscription_id)) {
            $subscription = wcs_get_subscription($subscription_id);
        } else {
            $subscription = $subscription_id;
        }

        if (false === $subscription) {
            // translators: %d: subscription ID.
            throw new InvalidArgumentException(sprintf(__('Subscription doesn\'t exist in scheduled action: %d', 'woocommerce-subscriptions'), $subscription_id));
        }

        if (! $subscription->is_manual() && ! $subscription->has_status(wcs_get_subscription_ended_statuses())) {
            /** @var WC_Order $last_order */
            $last_order = $subscription->get_last_order('all', 'renewal');

            // Ignore the order already has the payment method
            if (!empty($last_order->get_payment_method())) {
                return;
            }

            // Assign payment gateway to the last order
            $payment_gateway = wc_get_payment_gateway_by_order($subscription);
            if (!empty($payment_gateway->id) && $payment_gateway->id == $this->id) {
                $last_order->set_payment_method($payment_gateway);
                $last_order->save();
            }
        }
    }

    /**
     * scheduled_subscription_payment function.
     *
     * This function is called when renewal order is triggered.
     *
     * @param $amount_to_charge float The amount to charge.
     * @param $renewal_order WC_Order A WC_Order object created to record the renewal payment.
     */
    public function scheduled_subscription_payment($amount_to_charge, $renewal_order)
    {
        $this->log('[Method] scheduled_subscription_payment called. Amount: ' . $amount_to_charge . PHP_EOL);
        $response = $this->process_subscription_payment($renewal_order, $amount_to_charge);

        if (is_wp_error($response)) {
            $renewal_order->update_status('failed', sprintf(__('Xendit Transaction Failed (%s)', 'woocommerce-gateway-xendit'), $response->get_error_message()));
        }
    }

    /**
     * Remove order meta
     * @param  object $order
     */
    public function remove_order_source_before_retry($order)
    {
        $this->log('[Method] remove_order_source_before_retry called' . PHP_EOL);
        /** @var WC_Order $order */
        $order->delete_meta_data('_xendit_card_id');
    }

    /**
     * Remove order meta
     * @param  object $order
     */
    public function remove_order_customer_before_retry($order)
    {
        $this->log('[Method] remove_order_customer_before_retry called' . PHP_EOL);
    }

    /**
     * Update the customer_id for a subscription after using Xendit to complete a payment to make up for
     * an automatic renewal payment which previously failed.
     *
     * @access public
     * @param WC_Subscription $subscription The subscription for which the failing payment method relates.
     * @param WC_Order $renewal_order The order which recorded the successful payment (to make up for the failed automatic payment).
     * @return void
     */
    public function update_failing_payment_method($subscription, $renewal_order)
    {
        $this->log('[Method] update_failing_payment_method called' . PHP_EOL);
        $subscription->update_meta_data('_xendit_card_id', $renewal_order->get_meta('_xendit_card_id'));
    }

    /**
     * Include the payment meta data required to process automatic recurring payments so that store managers can
     * manually set up automatic recurring payments for a customer via the Edit Subscriptions screen in 2.0+.
     *
     * @since 2.5
     * @param array $payment_meta associative array of meta data required for automatic payments
     * @param WC_Subscription $subscription An instance of a subscription object
     * @return array
     */
    public function add_subscription_payment_meta($payment_meta, $subscription)
    {
        $this->log('[Method] add_subscription_payment_meta called' . PHP_EOL);

        // Save xendit card id to order
        $xendit_card_id = $subscription->get_meta('_xendit_card_id');
        if (empty($xendit_card_id) && !empty($subscription->get_parent())) {
            $xendit_card_id = $subscription->get_parent()->get_meta('_xendit_card_id');
        }

        $payment_meta[ $this->id ] = array(
            'post_meta' => array(
                '_xendit_card_id' => array(
                    'value' => $xendit_card_id,
                    'label' => 'Xendit Card ID',
                ),
            ),
        );
        return $payment_meta;
    }

    /**
     * Validate the payment meta data required to process automatic recurring payments so that store managers can
     * manually set up automatic recurring payments for a customer via the Edit Subscriptions screen in 2.0+.
     *
     * @since 2.5
     * @param string $payment_method_id The ID of the payment method to validate
     * @param array $payment_meta associative array of meta data required for automatic payments
     * @return array
     */
    public function validate_subscription_payment_meta($payment_method_id, $payment_meta)
    {
        $this->log('[Method] validate_subscription_payment_meta called' . PHP_EOL);
        if ($this->id === $payment_method_id) {
            $this->log('Payment method id sesuai ' . $payment_method_id . PHP_EOL);
            $this->log('Payment meta ' . print_r($payment_meta, true) . PHP_EOL);

            $card_id = $payment_meta['post_meta']['_xendit_card_id']['value'];
            if (! empty($card_id) && strlen($card_id) < 24) {
                throw new Exception('Invalid card ID. A valid "_xendit_card_id" has 24 characters.');
            }
        }
    }

    /**
     * Render the payment method used for a subscription in the "My Subscriptions" table
     *
     * @since 1.7.5
     * @param string $payment_method_to_display the default payment method text to display
     * @param WC_Subscription $subscription the subscription details
     * @return string the subscription payment method
     */
    public function maybe_render_subscription_payment_method($payment_method_to_display, $subscription)
    {
        $this->log('[Method] maybe_render_subscription_payment_method called' . PHP_EOL);
        $customer_user = $subscription->get_customer_id();

        // bail for other payment methods
        if ($this->id !== $subscription->get_payment_method() || ! $customer_user) {
            return $payment_method_to_display;
        }

        $xendit_card_id     = $subscription->get_meta('_xendit_card_id');

        // If we couldn't find a Xendit customer linked to the subscription, fallback to the user metadata.
        if (! $xendit_card_id || ! is_string($xendit_card_id)) {
            $user_id            = $customer_user;
            $xendit_card_id     = get_user_meta($user_id, '_xendit_card_id', true);
        }

        // If we couldn't find a Xendit customer linked to the account, fallback to the order metadata.
        if (( ! $xendit_card_id || ! is_string($xendit_card_id) ) && false !== $subscription->order) {
            /** @var WC_Order $parent_order */
            $parent_order       = $subscription->get_parent();
            $xendit_card_id     = $parent_order->get_meta('_xendit_card_id');
        }

        $cards = array();
        if ($cards) {
            $found_card = false;
            foreach ($cards as $card) {
                if ($card->id === $xendit_card_id) {
                    $found_card                = true;
                    $payment_method_to_display = sprintf(__('Via %1$s card ending in %2$s', 'woocommerce-gateway-xendit'), ( isset($card->type) ? $card->type : $card->brand ), $card->last4);
                    break;
                }
            }
            if (! $found_card) {
                $payment_method_to_display = sprintf(__('Via %1$s card ending in %2$s', 'woocommerce-gateway-xendit'), ( isset($cards[0]->type) ? $cards[0]->type : $cards[0]->brand ), $cards[0]->last4);
            }
        }

        return $payment_method_to_display;
    }

    /**
     * This function used to set the xendit_cc for subscription has recurring total = 0
     * Subscription default set this case to manual payment => cannot process recurring payment automatic
     *
     * @param WC_Subscription $subscription
     * @param $posted_data
     * @param WC_Order $order
     * @param $cart
     * @return void
     */
    public function handle_woocommerce_checkout_create_subscription(WC_Subscription $subscription, $posted_data, WC_Order $order, $cart)
    {
        $available_gateways   = WC()->payment_gateways->get_available_payment_gateways();
        $order_payment_method = $order->get_payment_method();
        if ($order_payment_method === $this->id && isset($available_gateways[ $order_payment_method ])) {
            $subscription->set_payment_method($available_gateways[ $order_payment_method ]);
        }
    }

    /**
     * Logs
     *
     * @since 3.1.0
     * @version 3.1.0
     *
     * @param string $message
     */
    // public function log( $message ) {
    //  $options = get_option( 'woocommerce_xendit_settings' );
    //
    //  if ( 'yes' === $options['logging'] ) {
    //      WC_Xendit_CC::log( $message );
    //  }
    // }
    public function log($message)
    {
        if (!file_exists(dirname(__FILE__).'/log.txt')) {
            file_put_contents(dirname(__FILE__).'/log.txt', 'Xendit Logs'."\r\n");
        }

        $debug_log_file_name = dirname(__FILE__) . '/log.txt';
        $fp = fopen($debug_log_file_name, "a");
        fwrite($fp, date('d/m/Y h:i:s') . "\r\n" . $message . PHP_EOL);
        fclose($fp);
    }
}
