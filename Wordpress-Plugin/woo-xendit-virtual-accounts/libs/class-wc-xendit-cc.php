<?php
if (!defined('ABSPATH')) {
    exit;
}

/**
 * WC_Xendit_CC class.
 *
 * @extends WC_Payment_Gateway_CC
 */
class WC_Xendit_CC extends WC_Payment_Gateway_CC
{
    const DEFAULT_CHECKOUT_FLOW = 'CHECKOUT_PAGE';
    const DEFAULT_CARD_ICONS = ['visa', 'mastercard'];

    const XENDIT_METHOD_CODE = 'CREDIT_CARD';

    /**
     * External ID
     * @var string
     */
    const DEFAULT_EXTERNAL_ID_VALUE = 'woocommerce-xendit';

    /**
     * Should we capture Credit cards
     *
     * @var bool
     */
    public $capture;

    /**
     * Alternate credit card statement name
     *
     * @var bool
     */
    public $statement_descriptor;

    /**
     * Checkout enabled
     *
     * @var bool
     */
    public $xendit_checkout;

    /**
     * Checkout Locale
     *
     * @var string
     */
    public $xendit_checkout_locale;

    /**
     * Credit card image
     *
     * @var string
     */
    public $xendit_checkout_image;

    /**
     * Should we store the users credit cards?
     *
     * @var bool
     */
    public $saved_cards;

    /**
     * Is test mode active?
     *
     * @var bool
     */
    public $testmode;

    /**
     * @var string
     */
    public $environment = '';

    /**
     * @var string
     */
    public $method_code = '';

    /**
     * @var string
     */
    public $default_title = 'Credit Card (Xendit)';

    /**
     * @var string
     */
    public $generic_error_message = 'We encountered an issue while processing the checkout. Please contact us.';

    /**
     * @var mixed|string
     */
    public $developmentmode = '';

    /**
     * @var mixed|string
     */
    public $external_id_format = '';

    /**
     * @var string
     */
    public $xendit_status = '';

    /**
     * @var string
     */
    public $xendit_callback_url = '';

    /**
     * @var string
     */
    public $xendit_invoice_callback_url = '';

    /**
     * @var mixed|string
     */
    public $success_payment_xendit = '';

    /**
     * @var mixed|string
     */
    public $for_user_id = '';

    /**
     * @var mixed|string
     */
    public $publishable_key = '';

    /**
     * @var WC_Xendit_PG_API
     */
    public $xenditClass;

    /**
     * if there is any subscription product in order then will be set to 1
     *
     * @var int
     */
    public $subscription_items_available = 0;

    /** @var string[] $supported_currencies */
    public $supported_currencies = array(
        'IDR',
        'PHP',
        'VND',
        'MYR',
        'THB',
        'USD',
        'SGD'
    );

    /**
     * @var WC_Xendit_CC
     */
    private static $_instance;

    /**
     * Constructor
     * @throws Exception
     */
    public function __construct()
    {
        $this->id = 'xendit_cc';
        $this->method_code = self::XENDIT_METHOD_CODE;
        $this->method_title = __('Xendit Credit Card', 'woocommerce-xendit');
        $this->method_description = sprintf(wp_kses(__('Collect payment from %1$s on checkout page and get the report realtime on your Xendit Dashboard. <a href=\"%2$s\" target=\"_blank\">Sign In</a> or <a href=\"%3$s\" target=\"_blank\">sign up</a> on Xendit and integrate with your <a href=\"%4$s\" target=\"_blank\">Xendit keys</a>', 'woocommerce-xendit'), ['a' => ['href' => true, 'target' => true]]), 'Credit Cards', 'https://dashboard.xendit.co/auth/login', 'https://dashboard.xendit.co/register', 'https://dashboard.xendit.co/settings/developers#api-keys');
        $this->has_fields = true;
        $this->view_transaction_url = 'https://dashboard.xendit.co/dashboard/credit_cards';
        $this->supports = array(
                'subscriptions',
                'products',
                'refunds',
                'subscription_cancellation',
                'subscription_reactivation',
                'subscription_suspension',
                'subscription_amount_changes',
                'subscription_payment_method_change', // Subs 1.n compatibility.
                'subscription_payment_method_change_customer',
                'subscription_payment_method_change_admin',
                'subscription_date_changes',
                'multiple_subscriptions',
                'tokenization',
                'add_payment_method',
        );

        // Load the form fields.
        $this->init_form_fields();

        // Load the settings.
        $this->init_settings();

        // Get setting values.
        $this->title = !empty($this->get_option('channel_name')) ? $this->get_option('channel_name') : $this->default_title;
        $this->description = !empty($this->get_option('payment_description')) ? nl2br($this->get_option('payment_description')) : esc_html(__('Pay with your credit card via Xendit', 'woocommerce-xendit'));

        $main_settings = get_option('woocommerce_xendit_gateway_settings');
        $this->developmentmode = $main_settings['developmentmode'] ?? '';
        $this->testmode = 'yes' === $this->developmentmode;
        $this->environment = $this->testmode ? 'development' : 'production';
        $this->capture = true;
        $this->statement_descriptor = $this->get_option('statement_descriptor');
        $this->xendit_checkout = 'yes' === $this->get_option('xendit_checkout');
        $this->xendit_checkout_locale = $this->get_option('xendit_checkout_locale');
        $this->xendit_checkout_image = '';
        $this->saved_cards = true;
        $this->external_id_format = !empty($main_settings['external_id_format']) ? $main_settings['external_id_format'] : self::DEFAULT_EXTERNAL_ID_VALUE;
        $this->xendit_status = $this->developmentmode == 'yes' ? "[Development]" : "[Production]";
        $this->xendit_callback_url = home_url() . '/?wc-api=wc_xendit_callback&xendit_mode=xendit_cc_callback';
        $this->xendit_invoice_callback_url = home_url() . '/?wc-api=wc_xendit_callback&xendit_mode=xendit_invoice_callback';
        $this->success_payment_xendit = $main_settings['success_payment_xendit'] ?? '';
        $this->for_user_id = $main_settings['on_behalf_of'] ?? '';
        $this->publishable_key = $this->testmode ? ($main_settings['api_key_dev'] ?? '') : ($main_settings['api_key'] ?? '');

        if ($this->xendit_checkout) {
            $this->order_button_text = __('Continue to payment', 'woocommerce-gateway-xendit');
        }

        if ($this->testmode) {
            $this->description .= '<br/><br/>' . '<p style="color: red; font-size:80%; margin-top:10px;">' . wp_kses(__('<strong>TEST MODE</strong> - Real payment will not be detected', 'woocommerce-xendit'), ['strong' => []]) . '</p>' . '<br/><br/>';
            $this->description = trim($this->description);
        }

        $this->xenditClass = new WC_Xendit_PG_API();

        // Hooks.
        add_action('wp_enqueue_scripts', array($this, 'payment_scripts'));
        add_action('woocommerce_update_options_payment_gateways_' . $this->id, array($this, 'process_admin_options'));
        add_action('woocommerce_checkout_billing', array($this, 'show_checkout_error'), 10, 0);
        add_filter('woocommerce_available_payment_gateways', array(&$this, 'check_gateway_status'));

        // Remove the saved token on xendit_cc & if cart has no subscription items
        add_filter('woocommerce_get_customer_payment_tokens', array(&$this, 'handle_woocommerce_get_customer_payment_tokens'), 10, 1);

        // Init CC icons setting. It works only for woocommerce manager
        $this->init_icon_settings();
    }

    /**
     * @return WC_Xendit_CC
     */
    public static function instance()
    {
        if (is_null(self::$_instance)) {
            self::$_instance = new self();
        }
        return self::$_instance;
    }

    /**
     * Init CC icons setting
     *
     * @return void
     * @throws Exception
     */
    protected function init_icon_settings()
    {
        if (!empty(get_option('xendit_onboarding_cc') || !$this->xenditClass->isCredentialExist())) {
            return;
        }

        /**
         * In case the icons setting exists, we should avoid override it
         */
        if (!empty($this->get_option('credit_card_icons')) && empty(get_option('xendit_onboarding_cc'))) {
            update_option('xendit_onboarding_cc', 1);
        }

        try {
            $icons = [];
            $cc_settings = get_transient('cc_settings_xendit_pg');
            if (empty($cc_settings) || empty($cc_settings['supported_card_brands'])) {
                $cc_settings = $this->xenditClass->getMIDSettings();
            }

            if (is_array($cc_settings) && !empty($cc_settings['supported_card_brands'])) {
                $icons = array_map('strtolower', $cc_settings['supported_card_brands']);
            }

            $this->update_option('credit_card_icons', !empty($icons) ? $icons : self::DEFAULT_CARD_ICONS);
            update_option('xendit_onboarding_cc', 1);
        } catch (\Exception $e) {
            // Should not interrupt Xendit PG setting even getting mid setting failed
            update_option('xendit_onboarding_cc', 1);
        }
    }

    /**
     * @return bool
     */
    public function is_valid_for_use(): bool
    {
        return in_array(get_woocommerce_currency(), apply_filters(
            'woocommerce_' . $this->id . '_supported_currencies',
            $this->supported_currencies
        ));
    }

    /**
     * Get current woo version
     *
     * @return void
     */
    public function get_woocommerce_version()
    {
        if (defined('WC_VERSION')) {
            return WC_VERSION;
        }
    }

    /**
     * Check if cart has subscription items
     * @return int
     */
    public function set_subscription_items(): int
    {
        if (!function_exists('WC') || empty(WC()->cart)) {
            $this->subscription_items_available = 0;
            return $this->subscription_items_available;
        }

        foreach (WC()->cart->get_cart() as $cart_item) {
            if (in_array($cart_item['data']->get_type(), ['subscription', 'subscription_variation'])) {
                $this->subscription_items_available = 1;
                break;
            }
        }
        return $this->subscription_items_available;
    }

    /**
     * Get_icon function. This is called by WC_Payment_Gateway_CC when displaying payment option
     * on checkout page.
     *
     * @access public
     * @return string
     */
    public function get_icon()
    {
        $credit_card_icons = $this->get_option('credit_card_icons');
        $credit_card_icons = !empty($credit_card_icons) ? $credit_card_icons : self::DEFAULT_CARD_ICONS; // default card is visa, mastercard
        $icon_html = '<img src="%s" alt="%s" style="max-height:24px;margin-right:3px;" />';
        $icon = '';
        foreach ($credit_card_icons as $card_icon) {
            $img = 'assets/images/' . strtolower($card_icon) . '.svg';
            $icon .= sprintf($icon_html, plugins_url($img, WC_XENDIT_PG_MAIN_FILE), strtoupper($card_icon));
        }
        return apply_filters('woocommerce_gateway_icon', sprintf('<div class="xendit-cc-icons">%s</div>', $icon), $this->id);
    }

    /**
     * Render admin settings HTML
     *
     * Host some PHP reliant JS to make the form dynamic
     */
    public function admin_options()
    {
        ?>
        <script>
            jQuery(document).ready(function ($) {
                $('.channel-name-format').text('<?=$this->title;?>');
                $('#woocommerce_<?=$this->id;?>_channel_name').change(
                    function () {
                        $('.channel-name-format').text($(this).val());
                    }
                );

                var isSubmitCheckDone = false;

                $("button[name='save']").on('click', function (e) {
                    if (isSubmitCheckDone) {
                        isSubmitCheckDone = false;
                        return;
                    }

                    e.preventDefault();

                    var paymentDescription = $('#woocommerce_<?=$this->id;?>_payment_description').val();
                    if (paymentDescription.length > 250) {
                        return new swal({
                            text: 'Text is too long, please reduce the message and ensure that the length of the character is less than 250.',
                            buttons: {
                                cancel: 'Cancel'
                            }
                        });
                    } else {
                        isSubmitCheckDone = true;
                    }

                    $("button[name='save']").trigger('click');
                });
            });
        </script>
        <table class="form-table">
            <?php $this->generate_settings_html(); ?>
        </table>
        <?php
    }

    /**
     * Initialise Gateway Settings Form Fields
     */
    public function init_form_fields()
    {
        $this->form_fields = require(WC_XENDIT_PG_PLUGIN_PATH . '/libs/forms/wc-xendit-cc-settings.php');
    }

    /**
     * Payment form on checkout page. This is called by WC_Payment_Gateway_CC when displaying
     * payment form on checkout page.
     */
    public function payment_fields()
    {
        global $wp;
        $this->set_subscription_items();

        if (!$this->show_add_new_card()) {
            echo apply_filters('wc_xendit_description', wpautop(wp_kses_post($this->description)));
            return;
        }

        $user = wp_get_current_user();
        $display_tokenization = $this->supports('tokenization') && is_checkout() && $this->saved_cards;
        $total = WC()->cart->total;

        // If paying from order, we need to get total from order not cart.
        if (isset($_GET['pay_for_order']) && !empty($_GET['key'])) {
            $order = wc_get_order(wc_clean($wp->query_vars['order-pay']));
            $total = $order->get_total();
            $user_email = $order->get_billing_email();
        } else {
            if ($user->ID) {
                $user_email = get_user_meta($user->ID, 'billing_email', true);
                $user_email = $user_email ?: $user->user_email;
            } else {
                $user_email = '';
            }
        }

        echo '<div
                id="xendit-payment-cc-data"
                data-description=""
                data-email="' . esc_attr($user_email) . '"
                data-amount="' . esc_attr($total) . '"
                data-name="' . esc_attr($this->statement_descriptor) . '"
                data-currency="' . esc_attr(strtolower(get_woocommerce_currency())) . '"
                data-locale="' . esc_attr('en') . '"
                data-image="' . esc_attr($this->xendit_checkout_image) . '"
                data-allow-remember-me="' . esc_attr($this->saved_cards ? 'true' : 'false') . '">';

        if ($this->description && !is_add_payment_method_page()) {
            echo apply_filters('wc_xendit_description', wpautop(wp_kses_post($this->description)));
        }

        if ($display_tokenization) {
            $this->tokenization_script();
            $this->saved_payment_methods();
        }

        // Only show CC fields for payment method page
        if ((WC_Xendit_PG_Helper::is_subscriptions_enabled() && WC_Xendit_PG_Helper::is_changing_payment_method_for_subscription())
                || is_add_payment_method_page()) {
            // Load the fields. Source: https://woocommerce.wp-a2z.org/oik_api/wc_payment_gateway_ccform/
            $this->form();
            do_action('wc_' . $this->id . '_cards_payment_fields', $this->id);
        }

        echo '</div>';
    }

    /**
     * Localize Xendit messages based on code
     *
     * @return array
     * @version 3.0.6
     * @since 3.0.6
     */
    public function get_frontend_error_message()
    {
        return apply_filters('wc_xendit_localized_messages', array(
                'invalid_number' => __('Invalid Card Number. Please make sure the card number is correct. Code: 200030', 'woocommerce-gateway-xendit'),
                'invalid_expiry' => __('The card expiry that you entered does not meet the expected format. Please try again by entering the 2 digits of the month (MM) and the last 2 digits of the year (YY). Code: 200031', 'woocommerce-gateway-xendit'),
                'invalid_cvc' => __('The CVC that you entered is less than 3 digits. Please enter the correct value and try again. Code: 200032', 'woocommerce-gateway-xendit'),
                'incorrect_number' => __('The card number that you entered must be 16 digits long. Please re-enter the correct card number and try again. Code: 200033', 'woocommerce-gateway-xendit'),
                'missing_card_information' => __('Card information is incomplete. Please complete it and try again. Code: 200034', 'woocommerce-gateway-xendit'),
        ));
    }

    /**
     * @return bool
     */
    public function show_add_new_card(): bool
    {
        return is_add_payment_method_page() ||
                WC_Xendit_PG_Helper::is_changing_payment_method_for_subscription() ||
                (is_checkout() && $this->subscription_items_available);
    }

    /**
     * payment_scripts function.
     *
     * Outputs scripts used for xendit payment
     *
     * @access public
     */
    public function payment_scripts()
    {
        global $wp;
        if (!is_cart() &&
                !is_checkout() &&
                !isset($_GET['pay_for_order']) &&
                !is_add_payment_method_page() &&
                !isset($_GET['change_payment_method'])
        ) {
            return;
        }

        $this->set_subscription_items();
        if ($this->show_add_new_card()) {
            wp_enqueue_script('xendit', 'https://js.xendit.co/v1/xendit.min.js', '', WC_XENDIT_PG_VERSION, true);
            wp_enqueue_script('woocommerce_' . $this->id, plugins_url('assets/js/frontend/xendit.min.js', WC_XENDIT_PG_MAIN_FILE), array('jquery', 'xendit'), WC_XENDIT_PG_VERSION, true);

            $this->generate_xendit_params();
        }
    }

    /**
     * @return void
     */
    protected function generate_xendit_params()
    {
        global $wp;
        $xendit_params = array(
                'key' => $this->publishable_key,
                'on_behalf_of' => $this->for_user_id,
                'amount' => WC()->cart->cart_contents_total + WC()->cart->tax_total + WC()->cart->shipping_total,
                'currency' => get_woocommerce_currency()
        );

        // If we're on the pay page we need to pass xendit.js the address of the order.
        if (isset($_GET['pay_for_order']) && 'true' === $_GET['pay_for_order']) {
            $order_id = wc_clean($wp->query_vars['order-pay']);
            $order = wc_get_order($order_id);

            $xendit_params['billing_first_name'] = $order->get_billing_first_name();
            $xendit_params['billing_last_name'] = $order->get_billing_last_name();
            $xendit_params['billing_address_1'] = $order->get_billing_address_1();
            $xendit_params['billing_address_2'] = $order->get_billing_address_2();
            $xendit_params['billing_state'] = $order->get_billing_state();
            $xendit_params['billing_city'] = $order->get_billing_city();
            $xendit_params['billing_postcode'] = $order->get_billing_postcode();
            $xendit_params['billing_country'] = $order->get_billing_country();
        }

        $cc_settings = $this->get_cc_settings();
        $xendit_params['can_use_dynamic_3ds'] = !empty($cc_settings['can_use_dynamic_3ds']) ? 1 : 0;
        $xendit_params['has_saved_cards'] = $this->saved_cards;

        // merge localized messages to be used in JS
        $xendit_params = array_merge($xendit_params, $this->get_frontend_error_message());

        wp_localize_script('woocommerce_' . $this->id, 'wc_xendit_params', apply_filters('wc_xendit_params', $xendit_params));
    }

    /**
     * Add payment method via account screen.
     * We store the token locally.
     */
    public function add_payment_method()
    {
        $error_msg = __('There was a problem adding the payment method.', 'woocommerce-gateway-xendit');

        /*
         * Check if it has error while changing payment method
         * Show the error message
         */
        if (isset($_POST['xendit_failure_reason'])) {
            $xendit_failure_reason = wc_clean($_POST['xendit_failure_reason']);
            wc_add_notice($xendit_failure_reason, 'error');
            return;
        }

        /*
         * If it does have cc token
         * Show the error message
         */
        if (empty($_POST['xendit_token']) || !is_user_logged_in()) {
            wc_add_notice($error_msg, 'error');
            return;
        }

        $token = wc_clean($_POST['xendit_token']);
        $source = array(
                "card_last_four" => substr(wc_clean($_POST['xendit_card_number']), -4),
                "card_expiry_year" => wc_clean($_POST['xendit_card_exp_year']),
                "card_expiry_month" => wc_clean($_POST['xendit_card_exp_month']),
                "card_type" => wc_clean($_POST['xendit_card_type'])
        );

        $this->save_payment_token($token, null, $source);

        return array(
                'result' => 'success',
                'redirect' => wc_get_endpoint_url('payment-methods'),
        );
    }

    /**
     *  Store the payment token when saving card.
     *
     * @param $tokenId
     * @param $userId
     * @param array $source
     * @return void
     */
    public function save_payment_token($tokenId, $userId, array $source)
    {
        $user_id = !empty($userId) ? $userId : get_current_user_id();

        $token = new WC_Payment_Token_CC();
        $token->set_token($tokenId);
        $token->set_gateway_id($this->id);
        $token->set_last4($source['card_last_four']);
        $token->set_expiry_year($source['card_expiry_year']);
        $token->set_expiry_month($source['card_expiry_month']);
        $token->set_card_type($source['card_type']);
        $token->set_user_id($user_id);
        $token->save();

        // Set this token as the users new default token
        WC_Payment_Tokens::set_users_default($user_id, $token->get_id());
    }

    /**
     * Generate the request for the payment.
     *
     * @param $order
     * @param $xendit_token
     * @param string $auth_id
     * @param bool $duplicated
     * @param bool $is_recurring
     * @param bool $check_ccpromo
     * @return array
     * @throws Exception
     */
    public function generate_payment_request(
        $order,
        $xendit_token,
        string $auth_id = '',
        bool $duplicated = false,
        bool $is_recurring = false,
        bool $check_ccpromo = true
    ) {
        global $woocommerce;

        $amount = $order->get_total();

        //TODO: Find out how can we pass CVN on redirected flow
        $cvn = isset($_POST['xendit_card_cvn']) ? wc_clean($_POST['xendit_card_cvn']) : '';

        $default_external_id = $this->external_id_format . '-' . $order->get_id();
        $external_id = $duplicated ? sprintf("%s-%s-%s", $this->external_id_format, uniqid(), $order->get_id()) : $default_external_id;
        $additional_data = WC_Xendit_PG_Helper::generate_items_and_customer($order);

        $post_data = array();
        $post_data['amount'] = $amount;
        $post_data['currency'] = $order->get_currency();
        $post_data['token_id'] = $xendit_token;
        $post_data['external_id'] = $external_id;
        $post_data['store_name'] = get_option('blogname');
        $post_data['items'] = $additional_data['items'] ?? '';
        $post_data['customer'] = $this->get_customer_details($order);

        if ($cvn) {
            $post_data['card_cvn'] = $cvn;
        }
        if ($auth_id) {
            $post_data['authentication_id'] = $auth_id;
        }
        if ($is_recurring) {
            $post_data['is_recurring'] = $is_recurring;
        }
        if (!empty($_POST['xendit_installment'])) { //JSON string
            $installment_data = stripslashes(wc_clean($_POST['xendit_installment']));
            $post_data['installment'] = json_decode($installment_data);
        }

        // get charge option by token ID
        if ($check_ccpromo) {
            $ccOption = $this->xenditClass->getChargeOption($xendit_token, $amount, $post_data['currency']);
            if (!is_wp_error($ccOption) && !empty($ccOption['promotions'][0])) { //charge with discounted amount
                $post_data['amount'] = $ccOption['promotions'][0]['final_amount'];
                $discount = $amount - $post_data['amount'];
                $order->add_order_note('Card promotion applied. Total discounted amount: ' . $post_data['currency'] . ' ' . number_format($discount));

                // add card promotion discount by add virtual coupon on order
                // add prefix xendit_card_promotion to differentiate it with other coupon
                $coupon_name = 'xendit_card_promotion_' . $ccOption['promotions'][0]['reference_id'];
                $coupon = new WC_Coupon($coupon_name);
                $coupon->set_virtual(true);
                $coupon->set_discount_type('fixed_cart');
                $coupon->set_amount($discount);

                $order->apply_coupon($coupon);
                $order->calculate_totals(false); //no taxes
                $order->save();
            }
        }

        return $post_data;
    }

    /**
     * Get payment source. This can be a new token or existing token.
     *
     * @return object
     * @throws Exception When card was not added or for and invalid card.
     */
    protected function get_source()
    {
        $xendit_source = false;
        $token_id = false;

        // New CC info was entered, and we have a new token to process
        if (isset($_POST['xendit_token'])) {
            $xendit_token = wc_clean($_POST['xendit_token']);
            // Not saving token, so don't define customer either.
            $xendit_source = $xendit_token;
        } elseif (isset($_POST['wc-' . $this->id . '-payment-token']) && 'new' !== $_POST['wc-' . $this->id . '-payment-token']) {
            // Use an EXISTING multiple use token, and then process the payment
            $token_id = wc_clean($_POST['wc-' . $this->id . '-payment-token']);
            $token = WC_Payment_Tokens::get($token_id);

            // associates payment token with WP user_id
            if (!$token || $token->get_user_id() !== get_current_user_id()) {
                WC()->session->set('refresh_totals', true);
                throw new Exception(__('Invalid payment method. Please input a new card number. Code: 200036', 'woocommerce-gateway-xendit'));
            }

            $xendit_source = $token->get_token();
        }

        return (object)array(
                'token_id' => $token_id,
                'source' => $xendit_source,
        );
    }

    /**
     * Get payment source from an order. This could be used in the future for
     * a subscription as an example, therefore using the current user ID would
     * not work - the customer won't be logged in :)
     *
     * Not using 2.6 tokens for this part since we need a customer AND a card
     * token, and not just one.
     *
     * @param object $order
     * @return object
     */
    protected function get_order_source($order = null)
    {
        return (object)array(
                'token_id' => false,
                'source' => !empty($order) ? $order->get_meta('_xendit_card_id') : false,
        );
    }

    /**
     * Process the payment method change for subscriptions.
     *
     * @param $order_id
     * @return array|void
     * @throws Exception
     */
    public function process_change_subscription_payment_method($order_id)
    {
        try {
            $error_msg = __('We encountered an issue while processing the checkout. Please contact us. Code: 200018', 'woocommerce-gateway-xendit');
            $subscription = wc_get_order($order_id);

            /*
             * Check if it has error while changing payment method
             * Show the error message
             */
            if (isset($_POST['xendit_failure_reason'])) {
                $xendit_failure_reason = wc_clean($_POST['xendit_failure_reason']);
                wc_add_notice($xendit_failure_reason, 'error');
                return;
            }

            /*
             * If it does not have cc token
             * Show tht error message
             */
            $payment_token = wc_clean($_POST[sprintf('wc-%s-payment-token', $this->id)]) ?? null;
            if (empty($payment_token)) {
                wc_add_notice($error_msg, 'error');
                return;
            }

            // If using saved credit card
            if ($payment_token != 'new') {
                $token_id = wc_clean($payment_token);
                $token = WC_Payment_Tokens::get($token_id);
                if (empty($token)) {
                    throw new Exception($error_msg);
                }
                $xendit_token = $token->get_token();
            } // If add new credit card
            elseif (!empty($_POST['xendit_token'])) {
                $xendit_token = wc_clean($_POST['xendit_token']);
                $this->add_payment_method();
            }

            // If does not exist xendit token
            if (empty($xendit_token)) {
                throw new Exception($error_msg);
            }

            // Save token into subscription
            $source = new stdClass();
            $source->source = $xendit_token;
            $this->save_source($subscription, $source);

            return [
                    'result' => 'success',
                    'redirect' => $this->get_return_url($subscription),
            ];
        } catch (WC_Stripe_Exception $e) {
            wc_add_notice($e->getLocalizedMessage(), 'error');
        }
    }

    /**
     * Process the payment.
     *
     * NOTE 2019/03/22: The key to have 3DS after order creation is calling it after this is called.
     * Currently still can't do it somehow. Need to dig deeper on this!
     *
     * @param int $order_id Reference.
     * @param bool $retry Should we retry on fail.
     *
     * @return array|void
     * @throws Exception If payment will not be accepted.
     *
     */
    public function process_payment($order_id, bool $retry = true)
    {
        try {
            // Check the 3ds authentication status
            if (isset($_POST['xendit_3ds_authentication_status']) && $_POST['xendit_3ds_authentication_status'] == 0) {
                throw new Exception(__("The 3DS authentication failed. Please try again.", "woocommerce-gateway-xendit"));
            }

            // Update payment method for subscription
            if (WC_Xendit_PG_Helper::maybe_change_subscription_payment_method($order_id)) {
                return $this->process_change_subscription_payment_method($order_id);
            }

            $order = wc_get_order($order_id);

            $this->set_subscription_items();
            if ($this->subscription_items_available) {
                // Handle error from tokenization phase here
                if (isset($_POST['xendit_failure_reason'])) {
                    $xendit_failure_reason = wc_clean($_POST['xendit_failure_reason']);
                    $order->add_order_note('Checkout with credit card unsuccessful. Reason: ' . $xendit_failure_reason);

                    throw new Exception(__($xendit_failure_reason, 'woocommerce-gateway-xendit'));
                }

                // If using saved card
                if (isset($_POST['wc-' . $this->id . '-payment-token']) && 'new' !== $_POST['wc-' . $this->id . '-payment-token']) {
                    $token_id = wc_clean($_POST['wc-' . $this->id . '-payment-token']);
                    $token = WC_Payment_Tokens::get($token_id);
                    $xendit_token = $token->get_token();

                    if (!$xendit_token) {
                        $error_msg = __('We encountered an issue while processing the checkout. Please contact us. Code: 200018', 'woocommerce-gateway-xendit');
                        throw new Exception($error_msg);
                    }

                    // Save Xendit token
                    $source = new stdClass();
                    $source->source = $xendit_token;
                    $this->save_source($order, $source);
                    return $this->process_payment_without_authenticate($order, $xendit_token);
                } else {
                    // Create new Xendit invoice
                    return $this->process_payment_via_xendit_invoice($order);
                }
            } else {
                return $this->process_payment_via_xendit_invoice($order);
            }
        } catch (Throwable $e) {
            if ($e instanceof Exception) {
                wc_add_notice($e->getMessage(), 'error');
            }

            if (!empty($order) && $order->has_status(array('pending', 'failed'))) {
                $this->send_failed_order_email($order_id);
            }

            // log error metrics
            $metrics = $this->xenditClass->constructMetricPayload('woocommerce_checkout', array(
                    'type' => 'error',
                    'payment_method' => strtoupper($this->method_code),
                    'error_message' => $e->getMessage()
            ));
            $this->xenditClass->trackMetricCount($metrics);
            return;
        }
    }

    /**
     * Payment flow using invoice for the order doesn't have subscription products
     *
     * @param WC_Order $order
     * @return array|void
     * @throws Exception
     */
    private function process_payment_via_xendit_invoice(WC_Order $order)
    {
        $order_id = $order->get_id();
        $amount = $order->get_total();
        $currency = $order->get_currency();
        $blog_name = html_entity_decode(get_option('blogname'), ENT_QUOTES | ENT_HTML5);
        $description = WC_Xendit_PG_Helper::generate_invoice_description($order);

        $payer_email = !empty($order->get_billing_email()) ? $order->get_billing_email() : 'noreply@mail.com';
        $payment_gateway = wc_get_payment_gateway_by_order($order_id);

        if ($payment_gateway->id != $this->id) {
            return;
        }

        $invoice = $order->get_meta('Xendit_invoice');
        $invoice_exp = $order->get_meta('Xendit_expiry');

        $additional_data = WC_Xendit_PG_Helper::generate_items_and_customer($order);
        $redirect_after = WC_Xendit_Invoice::instance()->get_xendit_option('redirect_after');

        $invoice_data = array(
            'external_id' => WC_Xendit_PG_Helper::generate_external_id($order, $this->external_id_format),
            'amount' => $amount,
            'currency' => $currency,
            'payer_email' => $payer_email,
            'description' => $description,
            'client_type' => 'INTEGRATION',
            'success_redirect_url' => $this->get_return_url($order),
            'failure_redirect_url' => wc_get_checkout_url(),
            'platform_callback_url' => $this->xendit_invoice_callback_url,
            'checkout_redirect_flow' => $redirect_after,
            'items' => !empty($additional_data['items']) ? $additional_data['items'] : '',
            'customer' => !empty($additional_data['customer']) ? $additional_data['customer'] : '',
            'payment_methods' => WC_Xendit_PG_Helper::extract_enabled_payments()
        );

        // Only show CC payment & different webhook for subscription order
        if (WC_Xendit_PG_Helper::order_contains_subscription($order->get_id())) {
            $invoice_data['payment_methods'] = [$this->method_code];
            $invoice_data['platform_callback_url'] = $this->xendit_callback_url;
            $invoice_data['should_charge_multiple_use_token'] = true;
        }

        // Generate Xendit payment fees
        $fees = WC_Xendit_Payment_Fees::generatePaymentFees($order);
        if (!empty($fees)) {
            $invoice_data['fees'] = $fees;
        }

        $header = array(
                'x-plugin-method' => strtoupper($this->method_code),
                'x-plugin-store-name' => $blog_name
        );

        if ($invoice && $invoice_exp > time()) {
            $response = $this->xenditClass->getInvoice($invoice);
        } else {
            $response = $this->xenditClass->createInvoice($invoice_data, $header);
        }

        if (!empty($response['error_code'])) {
            $response['message'] = !empty($response['code']) ? $response['message'] . ' Code: ' . $response['code'] : $response['message'];
            $message = $this->get_localized_error_message($response['error_code'], $response['message']);
            $order->add_order_note('Checkout with invoice unsuccessful. Reason: ' . $message);

            throw new Exception($message);
        }

        if ($response['status'] == 'PAID' || $response['status'] == 'COMPLETED') {
            return;
        }

        $xendit_invoice_url = esc_attr($response['invoice_url'] . '#' . $this->method_code);
        $order->update_meta_data('Xendit_invoice', esc_attr($response['id']));
        $order->update_meta_data('Xendit_invoice_url', $xendit_invoice_url);
        $order->update_meta_data('Xendit_expiry', esc_attr(strtotime($response['expiry_date'])));
        $order->save();

        switch ($redirect_after) {
            case 'ORDER_RECEIVED_PAGE':
                $args = array(
                        'utm_nooverride' => '1',
                        'order_id' => $order_id,
                );
                $return_url = esc_url_raw(add_query_arg($args, $this->get_return_url($order)));
                break;
            case 'CHECKOUT_PAGE':
            default:
                $return_url = $xendit_invoice_url;
        }

        // clear cart session
        if (WC()->cart) {
            WC()->cart->empty_cart();
        }

        // Return thankyou redirect
        return array(
            'result' => 'success',
            'redirect' => $return_url,
        );
    }

    /**
     * @param $order
     * @param $xendit_token
     * @return Exception|object
     * @throws Exception
     */
    public function retry_process_payment($order, $xendit_token)
    {
        $request_payload = $this->generate_payment_request($order, $xendit_token, '', true, true);
        return $this->xenditClass->createCharge($request_payload);
    }

    /**
     * Payment without authenticate flow.
     *
     * @param WC_Order $order
     * @param $xendit_token
     * @return array
     * @throws Exception
     */
    private function process_payment_without_authenticate(WC_Order $order, $xendit_token)
    {
        try {
            $request_payload = $this->generate_payment_request($order, $xendit_token, '', false, true);
            $response = $this->xenditClass->createCharge($request_payload);
            if (isset($response['error_code'])) {
                // If external_id does not exist
                if ($response['error_code'] == 'EXTERNAL_ID_ALREADY_USED_ERROR') {
                    $response = $this->retry_process_payment($order, $xendit_token);
                }

                // If token not found
                if ($response['error_code'] == 'TOKEN_NOT_FOUND_ERROR') {
                    throw new Exception(__('There was an error processing your card details, please enter another card and try again', 'woocommerce-gateway-xendit'));
                }
            }

            if (!empty($_POST['xendit_installment'])) {
                $installment_data = stripslashes(wc_clean($_POST['xendit_installment']));
                $installment = json_decode($installment_data, true);
                $order->update_meta_data('_xendit_cards_installment', $installment['count'] . ' ' . $installment['interval']);
                $order->save();
            }

            $this->process_response($response, $order);

            // clear cart session
            if (WC()->cart) {
                WC()->cart->empty_cart();
            }

            do_action('wc_' . $this->id . '_process_payment', $response, $order);

            // Return thank you page redirect.
            return array(
                    'result' => 'success',
                    'redirect' => $this->get_return_url($order)
            );
        } catch (Throwable $e) {
            $metrics = $this->xenditClass->constructMetricPayload('woocommerce_checkout', array(
                    'type' => 'error',
                    'payment_method' => strtoupper($this->method_code),
                    'error_message' => $e->getMessage()
            ));
            $this->xenditClass->trackMetricCount($metrics);

            if ($e instanceof Exception) {
                throw new Exception($e->getMessage());
            }
        }
    }

    /**
     * Store extra meta data for an order from a Xendit Response.
     *
     * @param $response
     * @param $order
     * @return mixed
     * @throws Exception
     */
    public function process_response($response, $order)
    {
        if (is_wp_error($response)) {
            $localized_messages = $this->get_frontend_error_message();
            $message = isset($localized_messages[$response->get_error_code()]) ? $localized_messages[$response->get_error_code()] : $response->get_error_message();
            $order->add_order_note('Card charge error. Reason: ' . $message);

            throw new Exception($message);
        }

        if (!empty($response['error_code'])) {
            $response['message'] = !empty($response['code']) ? $response['message'] . ' Code: ' . $response['code'] : $response['message'];
            $message = $this->get_localized_error_message($response['error_code'], $response['message']);
            $order->add_order_note('Card charge error. Reason: ' . $message);

            throw new Exception($message);
        }

        if (empty($response['id'])) { //for merchant who uses old API version
            throw new Exception($this->generic_error_message . 'Code: 200040');
        }

        if ($response['status'] !== 'CAPTURED') {
            $order->update_status('failed', sprintf(__('Xendit charges (Charge ID:' . $response['id'] . ').', 'woocommerce-xendit'), $response['id']));
            $message = $this->get_localized_error_message($response['failure_reason']);
            $order->add_order_note('Card charge error. Reason: ' . $message);

            throw new Exception($message);
        }

        // Store other data such as fees
        if (isset($response['balance_transaction']['fee'])) {
            // Fees and Net need to both come from Xendit to be accurate as the returned
            // values are in the local currency of the Xendit account, not from WC.
            $fee = !empty($response['balance_transaction']['fee']) ? number_format($response['balance_transaction']['fee']) : 0;
            $net = !empty($response['balance_transaction']['net']) ? number_format($response['balance_transaction']['net']) : 0;

            /** @var WC_Order $order */
            $order->update_meta_data('Xendit Fee', $fee);
            $order->update_meta_data('Net Revenue From Xendit', $net);
            $order->save();
        }

        // Save the CC token on _xendit_cart_id
        if (!empty($response['credit_card_token_id']) && empty($order->get_meta('_xendit_card_id'))) {
            $order->update_meta_data('_xendit_card_id', $response['credit_card_token_id']);
            $order->save();
        }

        // Update the order status
        // No need to store the CC token on recurring payment
        $this->complete_cc_payment($order, $response['id'], $response['status'], $response['capture_amount']);

        do_action('wc_gateway_xendit_process_response', $response, $order);

        return $response;
    }

    /**
     * Get CC Setting
     *
     * @return array|mixed|WP_Error
     */
    private function get_cc_settings()
    {
        $cc_settings = get_transient('cc_settings_xendit_pg');

        if (empty($cc_settings) && $this->xenditClass->isCredentialExist() === true) {
            $cc_settings = $this->xenditClass->getCCSettings();
            set_transient('cc_settings_xendit_pg', $cc_settings, 86400);
        }

        return $cc_settings;
    }

    /**
     * Save source to order.
     *
     * @param $order For to which the source applies.
     * @param stdClass $source Source information.
     */
    protected function save_source($order, $source)
    {
        // Store source in the order.
        if (is_object($source) && $source->source) {
            $order->update_meta_data('_xendit_card_id', $source->source);
        }

        if (is_callable(array($order, 'save'))) {
            $order->save();
        }
    }

    /**
     * Refund a charge
     *
     * @param $order_id
     * @param $amount
     * @param $reason
     * @param $duplicated
     * @return bool|void
     * @throws Exception
     */
    public function process_refund($order_id, $amount = null, $reason = '', $duplicated = false)
    {
        try {
            $order = wc_get_order($order_id);

            if (!$order || !$order->get_transaction_id()) {
                return false;
            }

            $default_external_id = $this->external_id_format . '-' . $order->get_transaction_id();
            $body = array(
                    'store_name' => get_option('blogname'),
                    'external_id' => $duplicated ? sprintf("%s-%s-%s", $this->external_id_format, uniqid(), $order->get_transaction_id()) : $default_external_id
            );

            if (is_null($amount) || (float)$amount < 1) {
                return false;
            }

            if ($amount) {
                $body['amount'] = $amount;
            }

            if ($reason) {
                $body['metadata'] = array(
                        'reason' => $reason,
                );
            }

            $response = $this->xenditClass->createRefund($body, $order->get_transaction_id());
            if ($response instanceof WP_Error) {
                // log error metrics
                $metrics = $this->xenditClass->constructMetricPayload('woocommerce_refund', array(
                        'type' => 'error',
                        'payment_method' => strtoupper($this->method_code),
                        'error_code' => $response->get_error_code(),
                        'error_message' => $response->get_error_message()
                ));
                $this->xenditClass->trackMetricCount($metrics);

                return false;
            } elseif (!empty($response['error_code'])) {
                // log error metrics
                $metrics = $this->xenditClass->constructMetricPayload('woocommerce_refund', array(
                        'type' => 'error',
                        'payment_method' => strtoupper($this->method_code),
                        'error_code' => $response['error_code'],
                        'error_message' => $response['message'] ?? '',
                ));
                $this->xenditClass->trackMetricCount($metrics);

                // retry refund with new external_id
                if ($response['error_code'] === 'DUPLICATE_REFUND_ERROR') {
                    return $this->process_refund($order_id, $amount, $reason, true);
                }

                return false;
            } elseif (!empty($response['id'])) {
                $refund_message = sprintf(__('Refunded %1$s - Refund ID: %2$s - Reason: %3$s', 'woocommerce-xendit'), wc_price($response['amount']), $response['id'], $reason);
                $order->add_order_note($refund_message);

                return true;
            }
        } catch (Throwable $e) {
            $metrics = $this->xenditClass->constructMetricPayload('woocommerce_refund', array(
                    'type' => 'error',
                    'payment_method' => strtoupper($this->method_code),
                    'error_message' => $e->getMessage()
            ));
            $this->xenditClass->trackMetricCount($metrics);
            return false;
        }
    }

    /**
     * Sends the failed order email to admin
     *
     * @param int $order_id
     * @return null
     * @version 3.1.0
     * @since 3.1.0
     */
    public function send_failed_order_email(int $order_id)
    {
        $emails = WC()->mailer()->get_emails();
        if (!empty($emails) && !empty($order_id)) {
            $emails['WC_Email_Failed_Order']->trigger($order_id);
        }
    }

    /**
     * @param $gateways
     * @return mixed
     */
    public function check_gateway_status($gateways)
    {
        global $wpdb, $woocommerce;

        if (is_null($woocommerce->cart)) {
            return $gateways;
        }

        if ($this->enabled == 'no') {
            unset($gateways[$this->id]);
            return $gateways;
        }

        if (!$this->is_valid_for_use()) {
            unset($gateways[$this->id]);
            return $gateways;
        }

        if ($this->xenditClass->isCredentialExist() == false) {
            unset($gateways[$this->id]);
            return $gateways;
        }

        return $gateways;
    }

    /**
     * Map card's failure reason to more detailed explanation based on current insight.
     *
     * @param $failure_reason
     * @param $message
     * @return mixed|string
     */
    function get_localized_error_message($failure_reason, $message = "")
    {
        switch ($failure_reason) {
            // mapping failure_reason, while error_code has been mapped via TPI Service
            case 'AUTHENTICATION_FAILED':
                return 'Authentication process failed. Please try again. Code: 200001';
            case 'PROCESSOR_ERROR':
                return $this->generic_error_message . 'Code: 200009';
            case 'EXPIRED_CARD':
                return 'Card declined due to expiration. Please try again with another card. Code: 200010';
            case 'CARD_DECLINED':
                return 'Card declined by the issuer. Please try with another card or contact the bank directly. Code: 200011';
            case 'INSUFFICIENT_BALANCE':
                return 'Card declined due to insuficient balance. Ensure the sufficient balance is available, or try another card. Code: 200012';
            case 'STOLEN_CARD':
                return 'Card declined by the issuer. Please try with another card or contact the bank directly. Code: 200013';
            case 'INACTIVE_CARD':
                return 'Card declined due to eCommerce payments enablement. Please try with another card or contact the bank directly. Code: 200014';
            case 'INVALID_CVN':
                return 'Card declined due to incorrect card details entered. Please try again. Code: 200015';
            case 'UNSUPPORTED_CURRENCY':
                return str_replace('{{currency}}', get_woocommerce_currency(), $message);
            default:
                return $message ? $message : $failure_reason;
        }
    }

    /**
     * Retrieve customer details. Currently will intro this new structure
     * on cards endpoint only.
     *
     * Source: https://docs.woocommerce.com/wc-apidocs/class-WC_Order.html
     *
     * @param $order
     */
    private function get_customer_details($order)
    {
        $customer_details = array();

        $billing_details = array();
        $billing_details['first_name'] = $order->get_billing_first_name();
        $billing_details['last_name'] = $order->get_billing_last_name();
        $billing_details['email'] = $order->get_billing_email();
        $billing_details['phone_number'] = $order->get_billing_phone();
        $billing_details['address_city'] = $order->get_billing_city();
        $billing_details['address_postal_code'] = $order->get_billing_postcode();
        $billing_details['address_line_1'] = $order->get_billing_address_1();
        $billing_details['address_line_2'] = $order->get_billing_address_2();
        $billing_details['address_state'] = $order->get_billing_state();
        $billing_details['address_country'] = $order->get_billing_country();


        $shipping_details = array();
        $shipping_details['first_name'] = $order->get_shipping_first_name();
        $shipping_details['last_name'] = $order->get_shipping_last_name();
        $shipping_details['address_city'] = $order->get_shipping_city();
        $shipping_details['address_postal_code'] = $order->get_shipping_postcode();
        $shipping_details['address_line_1'] = $order->get_shipping_address_1();
        $shipping_details['address_line_2'] = $order->get_shipping_address_2();
        $shipping_details['address_state'] = $order->get_shipping_state();
        $shipping_details['address_country'] = $order->get_shipping_country();

        $customer_details['billing_details'] = $billing_details;
        $customer_details['shipping_details'] = $shipping_details;

        return json_encode($customer_details);
    }

    /**
     * @param WC_Order $order
     * @param $charge_id
     * @param $status
     * @param $amount
     * @param string $cc_token
     * @return void
     */
    public function complete_cc_payment(WC_Order $order, $charge_id, $status, $amount, string $cc_token = "")
    {
        $order_id = $order->get_id();
        if (!$order->is_paid()) {
            $notes = WC_Xendit_PG_Helper::build_order_notes(
                $charge_id,
                $status,
                'CREDIT CARD',
                $order->get_currency(),
                $amount,
                $order->get_meta('_xendit_cards_installment')
            );

            WC_Xendit_PG_Helper::complete_payment($order, $notes, $this->success_payment_xendit, $charge_id);

            $order->update_meta_data('_xendit_charge_id', $charge_id);
            $order->update_meta_data('_xendit_charge_captured', 'yes');
            $order->save();

            $message = sprintf(__('Xendit charge complete (Charge ID: %s)', 'woocommerce-xendit'), $charge_id);
            $order->add_order_note($message);

            // Add token to subscription
            if (!empty($cc_token) && wcs_order_contains_subscription($order->get_id())) {
                $subscription = current(wcs_get_subscriptions_for_order($order->get_id()));
                $source = new stdClass();
                $source->source = $cc_token;
                $this->save_source($subscription, $source);
            }

            // Reduce stock levels
            wc_reduce_stock_levels($order_id);
        }
    }

    /**
     * @param $response
     * @return void
     * @throws Exception
     */
    public function validate_payment($response)
    {
        global $wpdb, $woocommerce;

        try {
            $external_id = $response->external_id;

            if ($external_id) {
                $exploded_ext_id = explode("-", $external_id);
                $order_num = end($exploded_ext_id);

                if (!is_numeric($order_num)) {
                    $exploded_ext_id = explode("_", $external_id);
                    $order_num = end($exploded_ext_id);
                }

                $order = wc_get_order($order_num);
                $order_id = $order->get_id();

                if ($this->developmentmode != 'yes') {
                    $payment_gateway = wc_get_payment_gateway_by_order($order_id);
                    if (false === get_post_status($order_id) || strpos($payment_gateway->id, 'xendit')) {
                        header('HTTP/1.1 400 Invalid Data Received');
                        echo 'Xendit is live and require a valid order id';
                        exit;
                    }
                }

                // Get CC Charge
                $charge = $this->xenditClass->getCharge($response->credit_card_charge_id);
                if (!empty($charge['error_code'])) {
                    header('HTTP/1.1 400 Invalid Credit Card Charge Data Received');
                    echo 'Error in getting credit card charge. Error code: ' . $charge['error_code'];
                    exit;
                }

                // Update subscription if charge status = CAPTURED
                if ('CAPTURED' == $charge['status']) {
                    $this->complete_cc_payment(
                        $order,
                        $charge['id'],
                        $charge['status'],
                        $charge['capture_amount'],
                        $response->credit_card_token
                    );

                    // Save payment token
                    if (!empty($order->get_user_id())) {
                        // Get CC Token
                        $cardToken = $this->xenditClass->getCCToken($response->credit_card_token);
                        if (!empty($cardToken['error_code'])) {
                            header('HTTP/1.1 400 Invalid Credit Card Token Data Received');
                            echo 'Error in getting credit card token. Error code: ' . $charge['error_code'];
                            exit;
                        }

                        $this->save_payment_token(
                            $response->credit_card_token,
                            $order->get_user_id(),
                            array(
                                "card_last_four" => substr($charge['masked_card_number'], -4),
                                "card_expiry_year" => $cardToken['card_expiration_year'],
                                "card_expiry_month" => $cardToken['card_expiration_month'],
                                "card_type" => strtolower($charge['card_brand'])
                            )
                        );
                    }

                    $this->xenditClass->trackEvent(array(
                        'reference' => 'charge_id',
                        'reference_id' => $charge['id'],
                        'event' => 'ORDER_UPDATED_AT.CALLBACK'
                    ));

                    die('Success');
                } else {
                    if (empty($order->get_meta('Xendit_invoice_expired'))) {
                        $order->add_meta_data('Xendit_invoice_expired', 1);
                    }
                    $order->update_status('failed', sprintf(__('Xendit charges (Charge ID: %s).', 'woocommerce-xendit'), $charge['id']));

                    $message = $this->get_localized_error_message($charge['failure_reason']);
                    $order->add_order_note($message);

                    $notes = WC_Xendit_PG_Helper::build_order_notes(
                        $charge['id'],
                        $charge['status'],
                        'CREDIT CARD',
                        $order->get_currency(),
                        $charge['capture_amount']
                    );
                    $order->add_order_note("<b>Xendit payment failed.</b><br>" . $notes);

                    die('Credit card charge status is ' . $charge['status']);
                }
            } else {
                header('HTTP/1.1 400 Invalid Data Received');
                echo 'Xendit external id check not passed';
                exit;
            }
        } catch (Exception $e) {
            header('HTTP/1.1 500 Server Error');
            echo $e->getMessage();
            exit;
        }
    }

    /**
     * Show error base on query
     */
    public function show_checkout_error()
    {
        if (isset($_REQUEST['error'])) {
            wc_add_notice($this->get_localized_error_message($_REQUEST['error']), 'error');
            unset($_REQUEST['error']);
            wp_safe_redirect(wc_get_checkout_url());
        }
    }

    /**
     * We don't want to show Xendit CC saved cards on checkout if it has no subscription items
     * @param $tokens
     * @return array
     */
    public function handle_woocommerce_get_customer_payment_tokens($tokens): array
    {
        if (!has_block('woocommerce/checkout')) {
            return $tokens;
        }

        $subscription_item = $this->set_subscription_items();
        if (empty($subscription_item) && function_exists('WC') && !empty(WC()->cart)) {
            $tokens = array_map(function ($token) {
                if ($token->get_gateway_id() != $this->id) {
                    return $token;
                }
            }, $tokens);

            return array_filter($tokens);
        }


        return $tokens;
    }
}
