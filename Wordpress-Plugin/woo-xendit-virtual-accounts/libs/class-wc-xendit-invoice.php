<?php
if (!defined('ABSPATH')) {
    exit;
}

class WC_Xendit_Invoice extends WC_Payment_Gateway
{
    const DEFAULT_MAXIMUM_AMOUNT = 1000000000;
    const DEFAULT_MINIMUM_AMOUNT = 10000;
    const DEFAULT_EXTERNAL_ID_VALUE = 'woocommerce-xendit';
    const DEFAULT_CHECKOUT_FLOW = 'CHECKOUT_PAGE';

    const API_KEY_FIELDS = array('dummy_api_key', 'dummy_secret_key', 'dummy_api_key_dev', 'dummy_secret_key_dev');

    /**
     * @var WC_Xendit_Invoice
     */
    private static $_instance;

    /** @var bool $isActionCalled */
    public $isActionCalled = false;

    /** @var string $method_code */
    public $method_code;

    /** @var string[] $supported_currencies */
    public $supported_currencies = array(
        'IDR',
        'PHP',
        'USD',
        'MYR',
        'THB',
        'VND',
        'SGD'
    );

    /** @var string $developmentmode */
    public $developmentmode = '';

    /** @var string $showlogo */
    public $showlogo = 'yes';

    /** @var string $success_response_xendit */
    public $success_response_xendit = 'COMPLETED';

    /** @var string $success_payment_xendit */
    public $success_payment_xendit;

    /** @var string $responce_url_sucess */
    public $responce_url_sucess;

    /** @var string $checkout_msg */
    public $checkout_msg = 'Thank you for your order, please follow the account numbers provided to pay with secured Xendit.';

    /** @var string $xendit_callback_url */
    public $xendit_callback_url;

    /** @var string $generic_error_message */
    public $generic_error_message = 'We encountered an issue while processing the checkout. Please contact us. ';

    /** @var string $xendit_status */
    public $xendit_status;

    /** @var array $msg */
    public $msg = ['message' => '', 'class' => ''];

    /** @var string $external_id_format */
    public $external_id_format;

    /** @var string $redirect_after */
    public $redirect_after;

    /** @var string $for_user_id */
    public $for_user_id;

    /** @var string $enable_xenplatform */
    public $enable_xenplatform;

    /** @var string $publishable_key */
    public $publishable_key;

    /** @var string $secret_key */
    public $secret_key;

    /** @var WC_Xendit_PG_API $xenditClass */
    public $xenditClass;

    /** @var false|mixed|null $oauth_data */
    public $oauth_data;

    /** @var string $oauth_link */
    public $oauth_link;

    /** @var bool $is_connected */
    public $is_connected = false;

    /** @var array|mixed $merchant_info */
    public $merchant_info;

    /** @var int $setting_processed */
    public static $setting_processed = 0;

    /**
     * @var string $method_type
     */
    public $method_type = '';

    /** @var string $default_title */
    public $default_title = '';

    /**
     * @var int $DEFAULT_MAXIMUM_AMOUNT
     */
    public $DEFAULT_MAXIMUM_AMOUNT = 0;

    /**
     * @var int $DEFAULT_MINIMUM_AMOUNT
     */
    public $DEFAULT_MINIMUM_AMOUNT = 0;

    /**
     * Constructor
     */
    public function __construct()
    {
        global $woocommerce;

        $this->id = 'xendit_gateway';
        $this->has_fields = true;
        $this->method_title = 'Xendit';
        $this->default_title = 'Xendit';
        $this->method_type = 'Xendit';
        $this->method_description = sprintf(wp_kses(__('Collect payment from %1$s on checkout page and get the report realtime on your Xendit Dashboard. <a href="%2$s" target="_blank">Sign In</a> or <a href="%3$s" target="_blank">sign up</a> on Xendit and integrate with your <a href="%4$s" target="_blank">Xendit keys</a>', 'woocommerce-xendit'), ['a' => ['href' => true, 'target' => true]]), 'Bank Transfer (Virtual Account)', 'https://dashboard.xendit.co/auth/login', 'https://dashboard.xendit.co/register', 'https://dashboard.xendit.co/settings/developers#api-keys');
        $this->method_code = $this->method_title;

        $this->init_form_fields();
        $this->init_settings();

        // user setting variables
        $this->title = 'Payment Gateway';
        $this->description = 'Pay with Xendit';

        $this->DEFAULT_MAXIMUM_AMOUNT = self::DEFAULT_MAXIMUM_AMOUNT;
        $this->DEFAULT_MINIMUM_AMOUNT = self::DEFAULT_MINIMUM_AMOUNT;

        $this->developmentmode = $this->get_option('developmentmode');

        $this->success_payment_xendit = $this->get_option('success_payment_xendit');
        $this->responce_url_sucess = $this->get_option('responce_url_calback');
        $this->xendit_callback_url = home_url() . '/?wc-api=wc_xendit_callback&xendit_mode=xendit_invoice_callback';

        $this->xendit_status = $this->developmentmode == 'yes' ? "[Development]" : "[Production]";

        $this->external_id_format = !empty($this->get_option('external_id_format')) ? $this->get_option('external_id_format') : self::DEFAULT_EXTERNAL_ID_VALUE;
        $this->redirect_after = !empty($this->get_option('redirect_after')) ? $this->get_option('redirect_after') : self::DEFAULT_CHECKOUT_FLOW;
        $this->for_user_id = $this->get_option('on_behalf_of');
        $this->enable_xenplatform = $this->for_user_id ? 'yes' : $this->get_option('enable_xenplatform');

        // API Key
        $this->publishable_key = $this->developmentmode == 'yes' ? $this->get_option('api_key_dev') : $this->get_option('api_key');
        $this->secret_key = $this->developmentmode == 'yes' ? $this->get_option('secret_key_dev') : $this->get_option('secret_key');

        $this->xenditClass = new WC_Xendit_PG_API();
        $this->oauth_data = WC_Xendit_Oauth::getXenditOAuth();

        // Generate Validation Key
        if (empty(WC_Xendit_Oauth::getValidationKey())) {
            $key = md5(rand());
            WC_Xendit_Oauth::updateValidationKey($key);
        }

        // Generate OAuth link
        $this->oauth_link = "https://dashboard.xendit.co/oauth/authorize";
        $this->oauth_link .= "?client_id=906468d0-fefd-4179-ba4e-407ef194ab85"; // initiate with prod client
        $this->oauth_link .= "&response_type=code&state=WOOCOMMERCE|"
            . WC_Xendit_Oauth::getValidationKey() . "|"
            . home_url() . "?wc-api=wc_xendit_oauth|".WC_XENDIT_PG_VERSION;
        $this->oauth_link .= "&redirect_uri=https://tpi-gateway.xendit.co/tpi/authorization/xendit/redirect/v2";

        add_action('woocommerce_update_options_payment_gateways_' . $this->id, array($this, 'process_admin_options'));
        add_action('woocommerce_receipt_' . $this->id, array(&$this, 'receipt_page'));

        add_filter('woocommerce_available_payment_gateways', array(&$this, 'check_gateway_status'));
        add_action('woocommerce_order_status_changed', array(&$this, 'expire_invoice_when_order_cancelled'), 10, 3);
        wp_register_script('sweetalert', 'https://unpkg.com/sweetalert@2.1.2/dist/sweetalert.min.js', null, null, true);
        wp_enqueue_script('sweetalert');

        // Init payment channels
        $this->init_activate_payment_channel();
    }

    /**
     * @return WC_Xendit_Invoice
     */
    public static function instance()
    {
        if (is_null(self::$_instance)) {
            self::$_instance = new self();
        }
        return self::$_instance;
    }

    /**
     * @return bool
     */
    protected function onboarded_payment_channel(): bool
    {
        if (get_option('xendit_onboarding_payment_channel') == 1) {
            return true;
        }
        $this->update_option('enabled', 'yes'); // Enable Xendit_Gateway
        return update_option('xendit_onboarding_payment_channel', 1);
    }

    /**
     * Check Xendit payment channels if it has any channels already enabled
     *
     * @return bool
     */
    protected function has_payment_channel_enabled(): bool
    {
        global $wc_xendit_pg;

        /**
         * The existing merchants already enabled payment channels in WC
         * no need to onboard
         */
        $xendit_payments = $wc_xendit_pg->woocommerce_xendit_payment_settings();
        foreach ($xendit_payments as $payment_class) {
            if ($payment_class === 'WC_Xendit_CC_Addons') {
                $payment_class = 'WC_Xendit_CC';
            }

            if ($payment_class === get_class($this) || !class_exists($payment_class)) {
                continue;
            }

            $option_key = WC_Xendit_PG_Helper::generate_setting_key_by_payment_class($payment_class);
            $settings = get_option($option_key);
            if (!empty($settings['enabled']) && $settings['enabled'] == 'yes') {
                return true;
            }
        }

        return false;
    }

    /**
     * Check new merchant should onboard
     *
     * @return bool
     */
    protected function should_onboard(): bool
    {
        $has_payment_channel_enabled = $this->has_payment_channel_enabled();
        if ($has_payment_channel_enabled) {
            $this->onboarded_payment_channel();
            return false;
        }

        /**
         * Merchant already onboarded
         * OR merchant not connect to Xendit
         */
        if (!empty(get_option('xendit_onboarding_payment_channel')) || !$this->xenditClass->isCredentialExist()) {
            return false;
        }

        return true;
    }

    /**
     * Used to enable the default activate channel when onboarding
     *
     * @return void
     */
    protected function init_activate_payment_channel()
    {
        global $wc_xendit_pg;

        try {
            if (!$this->should_onboard() || !is_admin()) {
                return;
            }

            $invoice_settings = $this->xenditClass->getInvoiceSettings();
            if (!empty($invoice_settings['error_code'])) {
                return;
            }

            if (empty($invoice_settings['available_method'])) {
                return $this->onboarded_payment_channel();
            }

            $onboarded = false;
            $xendit_payments = $wc_xendit_pg->woocommerce_xendit_payment_settings();
            foreach ($xendit_payments as $payment_class) {
                // Main CC payment gateway class is WC_Xendit_CC
                if ($payment_class === 'WC_Xendit_CC_Addons') {
                    $payment_class = 'WC_Xendit_CC';
                }

                if ($payment_class === get_class($this) || !class_exists($payment_class)) {
                    continue;
                }

                // Make sure const XENDIT_METHOD_CODE defined in Payment method class
                if (!defined("$payment_class::XENDIT_METHOD_CODE")) {
                    continue;
                }

                // Enable the payment channels that activated in Xendit
                if (in_array(strtoupper($payment_class::XENDIT_METHOD_CODE), $invoice_settings['available_method'])) {
                    $option_key = WC_Xendit_PG_Helper::generate_setting_key_by_payment_class($payment_class);
                    $settings = get_option($option_key);

                    $settings['enabled'] = 'yes';
                    update_option($option_key, $settings, 'yes');

                    if (!$onboarded) {
                        $onboarded = true;
                    }
                }
            }

            // Finish onboarding
            if ($onboarded) {
                $this->onboarded_payment_channel();
            }
        } catch (Exception $ex) {
            // Should not interrupt Xendit PG setting even getting invoice setting failed
            $this->onboarded_payment_channel();
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
     * @return string
     */
    protected function generate_api_key_settings_html(): string
    {
        $form_fields = $this->form_fields;

        foreach ($form_fields as $index => $field) {
            if (!in_array($index, array_merge(self::API_KEY_FIELDS, ['developmentmode', 'api_keys_help_text']))) {
                unset($form_fields[ $index ]);
            }
        }

        return $this->generate_settings_html($form_fields, false);
    }

    /**
     * @return void
     */
    protected function get_xendit_connection()
    {
        try {
            if (empty(get_transient('xendit_merchant_info'))) {
                $response = $this->xenditClass->getMerchant();
                if (!empty($response['error_code'])) {
                    throw new Exception($response['message']);
                }

                if (!empty($response['business_id'])) {
                    $this->merchant_info = $response;
                    set_transient('xendit_merchant_info', $response, 3600);
                    $this->is_connected = true;
                }
            } else {
                $this->merchant_info = get_transient('xendit_merchant_info');
                $this->is_connected = !empty($this->merchant_info['business_id']);
            }
        } catch (\Exception $e) {
            WC_Admin_Settings::add_error(esc_html__($e->getMessage(), 'woocommerce-xendit'));
        }
    }

    /**
     * @return void
     */
    protected function initialize_xendit_onboarding_info()
    {
        $output = "<h2>Xendit</h2>";
        $output .= '<p>' . wp_kses(__('Accept payments with Xendit. See our <a href="https://docs.xendit.co/integrations/woocommerce/steps-to-integrate" target="_blank">documentation</a> for the full guide', 'woocommerce-xendit'), ['a' => ['href' => true, 'target' => true]]). '</p>';

        if (!$this->is_connected) {
            $output .= '<div class="oauth-container">';
            $output .= "<button class='components-button is-primary' id='woocommerce_xendit_connect_button'>" . esc_html(__('Connect to Xendit', 'woocommerce-xendit')) . "</button>";
            $output .= '
        <ul>
        <li>'. __('1. Click "Connect to Xendit"', 'woocommerce-xendit') .'</li>
        <li>'. __('2. Log in to your Xendit dashboard (If you haven\'t)', 'woocommerce-xendit') .'</li>
        <li>'. __('3. Click "Allow"', 'woocommerce-xendit') .'</li>
        <li>'. __('4. Done', 'woocommerce-xendit') .'</li>
</ul>';
            $output .= '<em>'. wp_kses(__('If you\'re having trouble with the "Connect" button, click <a href="#" id="woocommerce_xendit_connect_api_key_button">here</a> to connect manually using your API keys.', 'woocommerce-xendit'), ['a' => ['href' => true, 'target' => true, 'id' => true]]) . '</em>';
            $output .= '</div>';

            $output .= '<div class="api-keys-container" style="display: none;"><table class="form-table">';
            $output .= '<a href="#" id="woocommerce_xendit_connect_oauth_button"><< '. __('Back', 'woocommerce-xendit') .'</a>';
            $output .= $this->generate_api_key_settings_html();
            $output .= '</table>';

            $output .= '</div>';

            $output .= '
        <style>
        .submit{display:none;}
</style>
        <script>
        jQuery(document).ready(function($) {
            $("#woocommerce_xendit_connect_api_key_button").on("click", function() {
                $(".oauth-container").hide();
                $(".api-keys-container").show();
                $(".submit").show();
            });
            $("#woocommerce_xendit_connect_oauth_button").on("click", function() {
                $(".oauth-container").show();
                $(".api-keys-container").hide();
                $(".submit").hide();
            });
        });
</script>
        ';
        } else {
            $output .= "<button class='components-button is-secondary' disabled>" . esc_html(__('Connected', 'woocommerce-xendit')) . "</button>";
            $output .= "<button class='components-button is-secondary' id='woocommerce_xendit_gateway_disconect_button'>" . esc_html(__('Disconnect', 'woocommerce-xendit')) . "</button>";
        }

        echo $output;
    }

    /**
     * @return void
     */
    protected function show_merchant_info()
    {
        if (empty($this->is_connected)) {
            return;
        }
        ?>
            <h3 class="wc-settings-sub-title"><?php echo __('Xendit Merchant Info', 'woocommerce-xendit')?></h3>
            <table class="form-table">
                <tbody>
                    <tr>
                        <th class="titledesc"><?php echo __('Merchant', 'woocommerce-xendit')?></th>
                        <td>
                            <table>
                                <tr>
                                    <th class="titledesc" style="padding: 0;width: 85px;"><?php echo __('Business ID', 'woocommerce-xendit')?></th>
                                    <td style="padding: 0;"><?php echo $this->merchant_info['business_id'] ?? ''?></td>
                                </tr>
                                <tr>
                                    <th class="titledesc" style="padding: 0;width: 85px;"><?php echo __('Name', 'woocommerce-xendit')?></th>
                                    <td style="padding: 0;"><?php echo $this->merchant_info['name'] ?? ''?></td>
                                </tr>
                            </table>
                        </td>
                    </tr>
            </table>
            <?php
    }

    /**
     * @return void
     * @throws Exception
     */
    public function admin_options()
    {
        $this->get_xendit_connection(); // Always check the Xendit connection on the top of admin_options
        $this->initialize_xendit_onboarding_info();
        ?>

        <?php if ($this->is_connected) : ?>
        <table class="form-table">
            <?php $this->show_merchant_info(); ?>

            <?php
            // Remove secret key settings if merchant connected via OAuth
            if (empty($this->get_option('secret_key')) && empty($this->get_option('secret_key_dev'))) {
                unset($this->form_fields['dummy_secret_key']);
                unset($this->form_fields['dummy_secret_key_dev']);
            }
            ?>

            <?php $this->generate_settings_html(); ?>
        </table>
        <?php endif ?>

        <style>
            .xendit-ttl-wrapper {
                width: 400px;
                position: relative;
            }

            .xendit-ttl,
            .xendit-ext-id {
                width: 320px !important;
            }

            .xendit-form-suffix {
                width: 70px;
                position: absolute;
                bottom: 6px;
                right: 0;
            }
        </style>

        <script>
            jQuery(document).ready(function ($) {
                // always hide oauth fields
                $(".xendit-oauth").parents("tr").hide();

                // Disconect action
                let disconect_button = $('#woocommerce_xendit_gateway_disconect_button');
                disconect_button.on('click', function (e) {
                    e.preventDefault();
                    new swal({
                        title: "Are you sure you want to disconnect Xendit payment?",
                        text: "Transactions can no longer be made, and all settings will be lost.",
                        icon: "warning",
                        dangerMode: true,
                        buttons: ["Cancel", "Disconnect"],
                    })
                        .then((willDelete) => {
                            if (willDelete) {
                                disconect_button.text('Loading, please wait a moment...').attr('disabled', true);

                                fetch("<?= home_url(); ?>/wp-json/xendit-wc/v1/disconnect", {
                                    method: "DELETE",
                                    headers: {
                                        "Content-Type": "application/json",
                                        "X-WP-Nonce": '<?php echo wp_create_nonce('wp_rest')?>'
                                    }
                                })
                                    .then((response) => response.json())
                                    .then(json => {
                                        switch (json.message) {
                                            case 'success':
                                                location.reload();
                                                break;
                                            case 'Sorry, you are not allowed to do that.':
                                                new swal({
                                                    type: 'error',
                                                    title: 'Failed',
                                                    text: 'Only Administrators and Shop Managers can disconnect'
                                                }).then(
                                                    function () {
                                                        location.reload();
                                                    }
                                                )
                                                break;
                                            default:
                                                new swal({
                                                    type: 'error',
                                                    title: 'Failed',
                                                    text: json.message
                                                }).then(
                                                    function () {
                                                        location.reload();
                                                    }
                                                )
                                                break;
                                        }
                                    })
                                    .catch(error => {
                                        new swal({
                                            type: 'error',
                                            title: 'Failed',
                                            text: 'Oops, something wrong happened! Please try again.'
                                        }).then(
                                            function () {
                                                location.reload();
                                            }
                                        )
                                    });
                            }
                        });
                });

                // Change send data value
                let send_data_button = $('#woocommerce_xendit_gateway_send_site_data_button');
                send_data_button.val('<?= esc_html(__('Send site data to Xendit', 'woocommerce-xendit')); ?>');

                send_data_button.on('click', function (e) {
                    <?php
                    try {
                        $site_data = WC_Xendit_Site_Data::retrieve();
                        $create_plugin = $this->xenditClass->createPluginInfo($site_data);
                        ?>
                    new swal({
                        type: 'success',
                        title: '<?= esc_html(__('Success', 'woocommerce-xendit')); ?>',
                        text: '<?= esc_html(__('Thank you! We have successfully collected all the basic information that we need to assist you with any issues you may have. All data will remain private & confidential', 'woocommerce-xendit')); ?>'
                    }).then(
                        function () {
                            location.reload();
                        }
                    )
                        <?php
                    } catch (\Throwable $th) {
                        ?>
                    new swal({
                        type: 'error',
                        title: '<?= esc_html(__('Failed', 'woocommerce-xendit')); ?>',
                        text: '<?= esc_html(__('Oops, something wrong happened! Please try again', 'woocommerce-xendit')); ?>'
                    }).then(
                        function () {
                            location.reload();
                        }
                    )
                        <?php
                    }
                    ?>
                });

                let xendit_connect_button = $('#woocommerce_xendit_connect_button');
                xendit_connect_button.on('click', function (e) {
                    e.preventDefault();
                    window.open("<?= $this->oauth_link; ?>", '_blank').focus();

                    new swal({
                        title: "<?= esc_html(__('Loading', 'woocommerce-xendit')); ?> ...",
                        text: "<?= esc_html(__('Please finish your integration on Xendit', 'woocommerce-xendit')); ?>",
                        buttons: ["Cancel", false],
                        closeOnClickOutside: false,
                    }).then(
                        function () {
                            location.reload();
                        }
                    );

                    // Check OAuth status every 5 seconds
                    let checkOauthStatusInterval = setInterval(() => {
                        fetch("<?= home_url(); ?>/wp-json/xendit-wc/v1/oauth_status", {
                            method: "GET",
                            headers: {
                                "Content-Type": "application/json",
                                "X-WP-Nonce": '<?php echo wp_create_nonce('wp_rest')?>'
                            }
                        })
                            .then((response) => response.json())
                            .then(json => {
                                if (json.is_connected) {
                                    location.reload();
                                }
                                if (!json.is_connected && json.error_code) {
                                    clearInterval(checkOauthStatusInterval);
                                    new swal({
                                        type: 'error',
                                        icon: "warning",
                                        dangerMode: true,
                                        title: json.error_code,
                                        text: "<?= esc_html(__('Integration has been declined. Please try again', 'woocommerce-xendit')); ?>",
                                        buttons: [false, true],
                                        closeOnClickOutside: false,
                                    });
                                }
                            });
                    }, 5000);
                });

                <?php if ($this->developmentmode == 'yes') { ?>
                $('.xendit_dev').parents('tr').show();
                $('.xendit_live').parents('tr').hide();
                <?php } else { ?>
                $('.xendit_dev').parents('tr').hide();
                $('.xendit_live').parents('tr').show();
                <?php } ?>

                <?php if ($this->for_user_id) { ?>
                $("#woocommerce_<?= $this->id; ?>_enable_xenplatform").prop('checked', true);
                $('.xendit-xenplatform').parents('tr').show();
                <?php } else { ?>
                $("#woocommerce_<?= $this->id; ?>_enable_xenplatform").prop('checked', false);
                $('.xendit-xenplatform').parents('tr').hide();
                <?php } ?>

                $(".xendit-ttl").wrap("<div class='xendit-ttl-wrapper'></div>");
                $("<span class='xendit-form-suffix'>Seconds</span>").insertAfter(".xendit-ttl");

                $(".xendit-ext-id").wrap("<div class='input-text regular-input xendit-ttl-wrapper'></div>");
                $("<span class='xendit-form-suffix'>-order_id</span>").insertAfter(".xendit-ext-id");

                $("#ext-id-example").text(
                    "<?= $this->external_id_format ?>-4245");

                $("#woocommerce_<?= $this->id; ?>_external_id_format").change(
                    function () {
                        $("#ext-id-example").text($(this).val() + "-4245");
                    });

                var isSubmitCheckDone = false;

                $('button[name="save"]').on('click', function (e) {
                    if (isSubmitCheckDone) {
                        isSubmitCheckDone = false;
                        return;
                    }

                    e.preventDefault();

                    //empty "on behalf of" if enable xenplatform is unchecked
                    if (!$("#woocommerce_<?= $this->id; ?>_enable_xenplatform").is(":checked")) {
                        $("#woocommerce_<?= $this->id; ?>_on_behalf_of").val('');
                    }

                    if ($("#woocommerce_<?= $this->id; ?>_external_id_format").length > 0) {
                        var externalIdValue = $("#woocommerce_<?= $this->id; ?>_external_id_format").val();
                        if (externalIdValue.length === 0) {
                            return new swal({
                                type: 'error',
                                title: 'Invalid External ID Format',
                                text: 'External ID cannot be empty, please input one or change it to woocommerce-xendit'
                            }).then(function () {
                                e.preventDefault();
                            });
                        }

                        if (/[^a-z0-9-]/gmi.test(externalIdValue)) {
                            return new swal({
                                type: 'error',
                                title: 'Unsupported Character',
                                text: 'The only supported characters in external ID are alphanumeric (a - z, 0 - 9) and dash (-)'
                            }).then(function () {
                                e.preventDefault();
                            });
                        }

                        if (externalIdValue.length <= 5 || externalIdValue.length > 54) {
                            return new swal({
                                type: 'error',
                                title: 'External ID length is outside range',
                                text: 'External ID must be between 6 to 54 characters'
                            }).then(function () {
                                e.preventDefault();
                            });
                        }
                    }

                    isSubmitCheckDone = true;
                    $("button[name='save']").trigger('click');
                });

                $("#woocommerce_<?= $this->id; ?>_enable_xenplatform").on('change',
                    function () {
                        if (this.checked) {
                            $(".xendit-xenplatform").parents("tr").show();
                        } else {
                            $(".xendit-xenplatform").parents("tr").hide();
                        }
                    }
                );

                $("#woocommerce_<?= $this->id; ?>_developmentmode").on('change',
                    function () {
                        if (this.checked) {
                            $(".xendit_dev").parents("tr").show();
                            $(".xendit_live").parents("tr").hide();
                        } else {
                            $(".xendit_dev").parents("tr").hide();
                            $(".xendit_live").parents("tr").show();
                        }
                    }
                );

                // Overwrite default value
                $("#woocommerce_<?= $this->id; ?>_dummy_api_key").val("<?= $this->generateStarChar(strlen($this->get_option('api_key'))); ?>");
                $("#woocommerce_<?= $this->id; ?>_dummy_secret_key").val("<?= $this->generateStarChar(strlen($this->get_option('secret_key'))); ?>");
                $("#woocommerce_<?= $this->id; ?>_dummy_api_key_dev").val("<?= $this->generateStarChar(strlen($this->get_option('api_key_dev'))); ?>");
                $("#woocommerce_<?= $this->id; ?>_dummy_secret_key_dev").val("<?= $this->generateStarChar(strlen($this->get_option('secret_key_dev'))); ?>");
            });
        </script>
        <?php
    }

    /**
     * @return void
     */
    public function init_form_fields()
    {
        $this->form_fields = array(
            'general_options' => array(
                'title' => esc_html(__('Xendit Payment Gateway Options', 'woocommerce-xendit')),
                'type' => 'title',
            ),

            'enabled' => array(
                'title' => esc_html(__('Enable', 'woocommerce-xendit')),
                'type' => 'checkbox',
                'label' => esc_html(__('Enable Xendit Gateway', 'woocommerce-xendit')),
                'default' => 'no',
            ),

            'developmentmode' => array(
                'title' => esc_html(__('Test Environment', 'woocommerce-xendit')),
                'type' => 'checkbox',
                'label' => esc_html(__('Enable Test Environment - Please uncheck for processing real transaction', 'woocommerce-xendit')),
                'default' => 'no',
            ),

            'dummy_api_key' => array(
                'class' => 'xendit_live',
                'title' => esc_html(__('Xendit Public API Key', 'woocommerce-xendit')) . '<br/>[' . esc_html(__('Live Mode', 'woocommerce-xendit'), []) . ']',
                'type' => 'password',
                'default' => esc_html(__('****', 'woocommerce-xendit')),
            ),

            'dummy_secret_key' => array(
                'class' => 'xendit_live',
                'title' => esc_html(__('Xendit Secret API Key', 'woocommerce-xendit')) . '<br/>[' . esc_html(__('Live Mode', 'woocommerce-xendit'), []) . ']',
                'type' => 'password',
                'default' => esc_html(__('****', 'woocommerce-xendit')),
            ),

            'dummy_api_key_dev' => array(
                'class' => 'xendit_dev',
                'title' => esc_html(__('Xendit Public API Key', 'woocommerce-xendit')) . '<br/>[' . esc_html(__('Test Mode', 'woocommerce-xendit'), []) . ']',
                'type' => 'password',
                'default' => esc_html(__('****', 'woocommerce-xendit')),
            ),

            'dummy_secret_key_dev' => array(
                'class' => 'xendit_dev',
                'title' => esc_html(__('Xendit Secret API Key', 'woocommerce-xendit')) . '<br/>[' . esc_html(__('Test Mode', 'woocommerce-xendit'), []) . ']',
                'type' => 'password',
                'default' => esc_html(__('****', 'woocommerce-xendit')),
            ),

            'api_keys_help_text' => array(
                'type' => 'title',
                'title' => '',
                'description' => wp_kses(
                    __('Find your API keys <a href="https://dashboard.xendit.co/settings/developers#api-keys" target="_blank">here</a> (switch between Test and Live modes using the options on the top left of your Xendit dashboard)', 'woocommerce-xendit'),
                    ['a' => ['href' => true, 'target' => true], 'br' => [], 'b' => []]
                ),
            ),

            'external_id_format' => array(
                'title' => esc_html(__('External ID Format', 'woocommerce-xendit')),
                'class' => 'xendit-ext-id',
                'type' => 'text',
                'description' => wp_kses(__('External ID of the payment that will be created on Xendit, for example <b><span id="ext-id-example"></span></b>.<br/> Must be between 6 to 54 characters', 'woocommerce-xendit'), ['b' => [], 'br' => [], 'span' => ['id' => true]]),
                'default' => esc_html(__(self::DEFAULT_EXTERNAL_ID_VALUE, 'woocommerce-xendit')),
            ),

            'send_site_data_button' => array(
                'title' => esc_html(__('Site Data Collection', 'woocommerce-xendit')),
                'type' => 'button',
                'description' => esc_html(__("Allow Xendit to retrieve this store's plugin and environment information for debugging purposes. E.g. WordPress version, WooCommerce version", 'woocommerce-xendit')),
                'class' => 'button-primary',
                'default' => esc_html(__('Send site data to Xendit', 'woocommerce-xendit'))
            ),

            'woocommerce_options' => array(
                'title' => esc_html(__('WooCommerce Order & Checkout Options', 'woocommerce-xendit')),
                'type' => 'title',
            ),

            'success_payment_xendit' => array(
                'title' => esc_html(__('Successful Payment Status', 'woocommerce-xendit')),
                'type' => 'select',
                'description' => esc_html(__('The status that WooCommerce should show when a payment is successful', 'woocommerce-xendit')),
                'default' => 'processing',
                'class' => 'form-control',
                'options' => array(
                        'default' => esc_html(__('Default', 'woocommerce-xendit')),
                        'pending' => esc_html(__('Pending payment', 'woocommerce-xendit')),
                        'processing' => esc_html(__('Processing', 'woocommerce-xendit')),
                        'completed' => esc_html(__('Completed', 'woocommerce-xendit')),
                        'on-hold' => esc_html(__('On Hold', 'woocommerce-xendit')),
                ),
            ),

            'redirect_after' => array(
                'title' => esc_html(__('Display Invoice Page After', 'woocommerce-xendit')),
                'type' => 'select',
                'description' => esc_html(__('Choose "Order received page" to get better tracking of your order conversion if you are using an analytic platform', 'woocommerce-xendit')),
                'default' => 'CHECKOUT_PAGE',
                'class' => 'form-control',
                'options' => array(
                        'CHECKOUT_PAGE' => esc_html(__('Checkout page', 'woocommerce-xendit')),
                        'ORDER_RECEIVED_PAGE' => esc_html(__('Order received page', 'woocommerce-xendit')),
                ),
            ),

            'xenplatform_options' => array(
                'title' => esc_html(__('XenPlatform Options', 'woocommerce-xendit')),
                'type' => 'title',
            ),

            'enable_xenplatform' => array(
                'title' => esc_html(__('XenPlatform User', 'woocommerce-xendit')),
                'type' => 'checkbox',
                'label' => esc_html(__('Enable your XenPlatform Sub Account in WooCommerce', 'woocommerce-xendit')),
                'default' => ''
            ),

            'on_behalf_of' => array(
                'title' => esc_html(__('On Behalf Of', 'woocommerce-xendit')),
                'class' => 'form-control xendit-xenplatform',
                'type' => 'text',
                'description' => esc_html(__('Your Xendit Sub Account Business ID. All transactions will be linked to this account', 'woocommerce-xendit')),
                'default' => esc_html(__('', 'woocommerce-xendit')),
                'placeholder' => 'e.g. 5f57be181c4ff635452d817d'
            ),
            'invoice_expire_duration' => array(
                'title' => esc_html(__('Invoice Expire Time', 'woocommerce-xendit')),
                'class' => 'form-control xendit-xenplatform',
                'type' => 'text',
                'default' => esc_html(__(1, 'woocommerce-xendit')),
                'placeholder' => 'e.g. 30'
            ),
            'invoice_expire_unit' => array(
                'title' => esc_html(__('', 'woocommerce-xendit')),
                'type' => 'select',
                'default' => 'DAYS',
                'class' => 'form-control xendit-xenplatform',
                'options' => array(
                    'MINUTES' => esc_html(__('Minutes', 'woocommerce-xendit')),
                    'HOURS' => esc_html(__('Hours', 'woocommerce-xendit')),
                    'DAYS' => esc_html(__('Days', 'woocommerce-xendit')),
                ),
            ),
        );
    }

    public function payment_fields()
    {
        if ($this->description) {
            $test_description = '';
            if ($this->developmentmode == 'yes') {
                $test_description = wp_kses(__('<strong>TEST MODE</strong> - Real payment will not be detected', 'woocommerce-xendit'), ['strong' => []]);
            }

            echo '<p>' . $this->description . '</p>
                <p style="color: red; font-size:80%; margin-top:10px;">' . $test_description . '</p>';
        }
    }

    public function receipt_page($order_id)
    {
        $payment_gateway = wc_get_payment_gateway_by_order($order_id);
        if ($payment_gateway->id != $this->id) {
            return;
        }

        $return = '<div style="text-align:left;"><strong>' . $this->checkout_msg . '</strong><br /><br /></div>';

        if ($this->developmentmode == 'yes') {
            $testDescription = sprintf(wp_kses(__('<strong>TEST MODE.</strong> The bank account numbers shown below are for testing only. Real payments will not be detected', 'woocommerce-xendit'), ['strong' => []]));
            $return .= '<div style="text-align:left;">' . $testDescription . '</div>';
        }

        echo $return;
    }

    public function get_success_redirect_url($order): string
    {
        $returnUrl = $this->get_return_url($order);

        if (strpos($returnUrl, home_url()) === false) {
            $returnUrl = rtrim(wc_get_checkout_url(), '/') . $returnUrl;
        }

        return $returnUrl;
    }

    /**
     * @param $order_id
     * @return array|void
     * @throws Exception
     */
    public function process_payment($order_id)
    {
        try {
            $order = wc_get_order($order_id);
            $amount = $order->get_total();
            $currency = $order->get_currency();

            if ($amount < $this->DEFAULT_MINIMUM_AMOUNT) {
                WC_Xendit_PG_Helper::cancel_order($order, 'Cancelled because amount is below minimum amount');

                $err_msg = sprintf(__(
                    'The minimum amount for using this payment is %1$s %2$s. Please put more item(s) to reach the minimum amount. Code: 100001',
                    'woocommerce-gateway-xendit'
                ), $currency, wc_price($this->DEFAULT_MINIMUM_AMOUNT));

                wc_add_notice($this->get_localized_error_message('INVALID_AMOUNT_ERROR', $err_msg), 'error');
                return;
            }

            if ($amount > $this->DEFAULT_MAXIMUM_AMOUNT) {
                WC_Xendit_PG_Helper::cancel_order($order, 'Cancelled because amount is above maximum amount');

                $err_msg = sprintf(__(
                    'The maximum amount for using this payment is %1$s %2$s. Please remove one or more item(s) from your cart. Code: 100002',
                    'woocommerce-gateway-xendit'
                ), $currency, wc_price($this->DEFAULT_MAXIMUM_AMOUNT));

                wc_add_notice($this->get_localized_error_message('INVALID_AMOUNT_ERROR', $err_msg), 'error');
                return;
            }

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
            $invoice_data = array(
                'external_id' => WC_Xendit_PG_Helper::generate_external_id($order, $this->external_id_format),
                'amount' => $amount,
                'currency' => $currency,
                'payer_email' => $payer_email,
                'description' => $description,
                'client_type' => 'INTEGRATION',
                'success_redirect_url' => $this->get_success_redirect_url($order),
                'failure_redirect_url' => wc_get_checkout_url(),
                'platform_callback_url' => $this->xendit_callback_url,
                'checkout_redirect_flow' => $this->redirect_after,
                'customer' => !empty($additional_data['customer']) ? $additional_data['customer'] : '',
                'items' => !empty($additional_data['items']) ? $additional_data['items'] : '',
                'payment_methods' => WC_Xendit_PG_Helper::extract_enabled_payments()
            );

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
                // Return thankyou redirect
                return array(
                    'result'    => 'success',
                    'redirect'  => $this->get_return_url($order)
                );
            }

            $xendit_invoice_url = esc_attr($response['invoice_url'] . '#' . strtolower($this->method_code));
            $order->update_meta_data('Xendit_invoice', esc_attr($response['id']));
            $order->update_meta_data('Xendit_invoice_url', $xendit_invoice_url);
            $order->update_meta_data('Xendit_expiry', esc_attr(strtotime($response['expiry_date'])));
            $order->save();

            switch ($this->redirect_after) {
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
        } catch (Throwable $e) {
            if ($e instanceof Exception) {
                wc_add_notice($e->getMessage(), 'error');
            }
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
     * @param $response
     * @return void
     */
    public function validate_payment($response)
    {
        global $wpdb, $woocommerce;

        try {
            $external_id = $response->external_id;
            $exploded_ext_id = explode("-", $external_id);
            $order_num = end($exploded_ext_id);

            if (!is_numeric($order_num)) {
                $exploded_ext_id = explode("_", $external_id);
                $order_num = end($exploded_ext_id);
            }

            if (WC_Xendit_PG_Helper::is_advanced_order_number_active()) {
                // 1. Try direct meta query
                $orders = wc_get_orders(array(
                    'meta_key' => '_order_number',
                    'meta_value' => $order_num,
                    'limit' => 1
                ));
                
                if (!empty($orders)) {
                    $order = $orders[0];
                    $order_num = $order->id;
                }
            }

            $order = wc_get_order($order_num);
            $order_id = $order->get_id();

            if ($this->developmentmode != 'yes') {
                $payment_gateway = wc_get_payment_gateway_by_order($order_id);
                if (false === get_post_status($order_id) || strpos($payment_gateway->id, 'xendit')) {
                    header('HTTP/1.1 400 Invalid Data Received');
                    die('Xendit is live and require a valid order id');
                }
            }

            if (in_array($response->status, array('PAID', 'SETTLED'))) {
                //update payment method in case customer change method after invoice is generated
                $method = $this->map_payment_channel($response->channel);
                if ($method) {
                    $order->set_payment_method($method['id']);
                    $order->set_payment_method_title($method['title']);

                    //save charge ID if paid by credit card
                    if ($method['id'] == 'xendit_cc' && !empty($response->credit_card_charge_id)) {
                        $order->set_transaction_id($response->credit_card_charge_id);
                    }

                    $order->save();
                }

                $notes = WC_Xendit_PG_Helper::build_order_notes(
                    $response->id,
                    $response->status,
                    $response->channel,
                    $order->get_currency(),
                    $order->get_total()
                );
                WC_Xendit_PG_Helper::complete_payment($order, $notes, $this->success_payment_xendit);

                // Empty cart in action
                $woocommerce->cart->empty_cart();

                die('Success');
            } else {
                if (empty($order->get_meta('Xendit_invoice_expired'))) {
                    $order->add_meta_data('Xendit_invoice_expired', 1);
                }
                $order->update_status('failed');

                $notes = WC_Xendit_PG_Helper::build_order_notes(
                    $response->id,
                    $response->status,
                    $response->channel,
                    $order->get_currency(),
                    $order->get_total()
                );

                $order->add_order_note("<b>Xendit payment failed.</b><br>" . $notes);
                die('Invoice ' . $response->channel . ' status is ' . $response->status);
            }
        } catch (Exception $e) {
            header('HTTP/1.1 500 Server Error');
            echo $e->getMessage();
            exit;
        }
    }

    public function check_gateway_status($gateways)
    {
        global $wpdb, $woocommerce;

        if (is_null($woocommerce->cart)) {
            return $gateways;
        }

        if ($this->enabled == 'no') {
            // Disable all Xendit payments
            if ($this->id == 'xendit_gateway') {
                return array_filter($gateways, function ($gateway) {
                    return strpos($gateway->id, 'xendit') === false;
                });
            }

            unset($gateways[$this->id]);
            return $gateways;
        }

        if (!$this->xenditClass->isCredentialExist()) {
            unset($gateways[$this->id]);
            return $gateways;
        }

        if ($this->id == 'xendit_gateway') {
            unset($gateways[$this->id]);
            return $gateways;
        }

        if (!$this->is_valid_for_use()) {
            unset($gateways[$this->id]);
            return $gateways;
        }

        /**
         * get_cart_contents_total() will give us just the final (float) amount after discounts.
         * Compatible with WC version 3.2.0 & above.
         * Source: https://woocommerce.github.io/code-reference/classes/WC-Cart.html#method_get_cart_contents_total
         */
        $amount = $woocommerce->cart->get_total('');
        if ($amount > $this->DEFAULT_MAXIMUM_AMOUNT) {
            unset($gateways[$this->id]);
            return $gateways;
        }

        return $gateways;
    }

    /**
     * Return filter of PG icon image in checkout page. Called by this class automatically.
     */
    public function get_icon()
    {
        if ($this->showlogo !== 'yes') {
            return;
        }
        $width = '65px';
        if ($this->method_code == 'Permata' || $this->method_code == 'GRABPAY') {
            $width = '75px';
        }
        $style = "style='margin-left: 0.3em; max-height: 28px; max-width: $width;'";
        $file_name = strtolower($this->method_code) . '.svg';
        $icon = '<img src="' . plugins_url('assets/images/' . $file_name, WC_XENDIT_PG_MAIN_FILE) . '" alt="Xendit" ' . $style . ' />';

        return apply_filters('woocommerce_gateway_icon', $icon, $this->id);
    }

    public function get_xendit_method_title()
    {
        return $this->method_type . ' - ' . str_replace('_', ' ', $this->method_code);
    }

    public function get_xendit_method_description()
    {
        switch (strtoupper($this->method_code)) {
            case 'ALFAMART':
                return sprintf(wp_kses(__('Pay at your nearest %1$s via <strong>Xendit</strong>', 'woocommerce-xendit'), ['strong' => []]), 'Alfa group (Alfamart, Alfamidi & Dan+Dan)');
            case 'INDOMARET':
                return sprintf(wp_kses(__('Pay at your nearest %1$s via <strong>Xendit</strong>', 'woocommerce-xendit'), ['strong' => []]), 'Indomaret, Indogrosir, Superindo, atau i.saku');
            case 'SHOPEEPAY':
                return sprintf(wp_kses(__('Pay with your %1$s account via <strong>Xendit</strong>', 'woocommerce-xendit'), ['strong' => []]), 'ShopeePay');
            case 'DD_BRI':
                return sprintf(wp_kses(__('Pay with your Direct Debit %1$s via <strong>Xendit</strong>', 'woocommerce-xendit'), ['strong' => []]), 'BRI');
            case 'DD_BPI':
                return sprintf(wp_kses(__('Pay with your Direct Debit %1$s via <strong>Xendit</strong>', 'woocommerce-xendit'), ['strong' => []]), 'BPI');
            case 'DD_UBP':
                return sprintf(wp_kses(__('Pay with your Direct Debit %1$s via <strong>Xendit</strong>', 'woocommerce-xendit'), ['strong' => []]), 'UBP');
            case 'DD_RCBC':
                return sprintf(wp_kses(__('Pay with your Direct Debit %1$s via <strong>Xendit</strong>', 'woocommerce-xendit'), ['strong' => []]), 'RCBC');
            case 'DD BDO_EPAY':
                return sprintf(wp_kses(__('Pay with your Direct Debit %1$s via <strong>Xendit</strong>', 'woocommerce-xendit'), ['strong' => []]), 'BDO Epay');
            case 'DD_CHINABANK':
                return sprintf(wp_kses(__('Pay with your Direct Debit %1$s via <strong>Xendit</strong>', 'woocommerce-xendit'), ['strong' => []]), 'Chinabank');
            case 'PAYMAYA':
                return sprintf(wp_kses(__('Pay with your %1$s account via <strong>Xendit</strong>', 'woocommerce-xendit'), ['strong' => []]), 'PayMaya');
            case 'GCASH':
                return sprintf(wp_kses(__('Pay with your %1$s account via <strong>Xendit</strong>', 'woocommerce-xendit'), ['strong' => []]), 'GCash');
            case 'GRABPAY':
                return sprintf(wp_kses(__('Pay with your %1$s account via <strong>Xendit</strong>', 'woocommerce-xendit'), ['strong' => []]), 'GrabPay');
            case '7ELEVEN':
                return sprintf(wp_kses(__('Pay at your nearest %1$s via <strong>Xendit</strong>', 'woocommerce-xendit'), ['strong' => []]), '7-Eleven');
            case 'LBC':
                return sprintf(wp_kses(__('Pay at your nearest %1$s via <strong>Xendit</strong>', 'woocommerce-xendit'), ['strong' => []]), 'LBC');
            case 'DANA':
                return sprintf(wp_kses(__('Pay with your %1$s account via <strong>Xendit</strong>', 'woocommerce-xendit'), ['strong' => []]), 'DANA');
            case 'OVO':
                return sprintf(wp_kses(__('Pay with your %1$s account via <strong>Xendit</strong>', 'woocommerce-xendit'), ['strong' => []]), 'OVO');
            case 'LINKAJA':
                return sprintf(wp_kses(__('Pay with your %1$s account via <strong>Xendit</strong>', 'woocommerce-xendit'), ['strong' => []]), 'LINKAJA');
            case 'QRIS':
                return sprintf(wp_kses(__('Pay with your %1$s account via <strong>Xendit</strong>', 'woocommerce-xendit'), ['strong' => []]), 'QRIS');
            case 'JENIUSPAY':
                return sprintf(wp_kses(__('Pay with your %1$s account via <strong>Xendit</strong>', 'woocommerce-xendit'), ['strong' => []]), 'JENIUSPAY');
            case 'BILLEASE':
                return sprintf(wp_kses(__('Buy now and pay later with your %1$s via <strong>Xendit</strong>', 'woocommerce-xendit'), ['strong' => []]), 'BillEase');
            case 'KREDIVO':
                return sprintf(wp_kses(__('Buy now and pay later with your %1$s via <strong>Xendit</strong>', 'woocommerce-xendit'), ['strong' => []]), 'Kredivo');
            case 'ATOME':
                return sprintf(wp_kses(__('Buy now and pay later with your %1$s via <strong>Xendit</strong>', 'woocommerce-xendit'), ['strong' => []]), 'Atome');
            case 'CEBUANA':
                return sprintf(wp_kses(__('Pay with your %1$s account via <strong>Xendit</strong>', 'woocommerce-xendit'), ['strong' => []]), 'Cebuana');
            case 'DP_MLHUILLIER':
                return sprintf(wp_kses(__('Pay with your %1$s account via <strong>Xendit</strong>', 'woocommerce-xendit'), ['strong' => []]), 'M Lhuillier');
            case 'DP_PALAWAN':
                return sprintf(wp_kses(__('Pay with your %1$s account via <strong>Xendit</strong>', 'woocommerce-xendit'), ['strong' => []]), 'Palawan Express Pera Padala');
            case 'DP_ECPAY_LOAN':
                return sprintf(wp_kses(__('Pay with your %1$s account via <strong>Xendit</strong>', 'woocommerce-xendit'), ['strong' => []]), 'ECPay Loan');
            case 'DP_ECPAY_SCHOOL':
                return sprintf(wp_kses(__('Pay with your %1$s account via <strong>Xendit</strong>', 'woocommerce-xendit'), ['strong' => []]), 'ECPay School');
            case 'CASHALO':
                return sprintf(wp_kses(__('Pay with your %1$s account via <strong>Xendit</strong>', 'woocommerce-xendit'), ['strong' => []]), 'Cashalo');
            case 'ASTRAPAY':
                return sprintf(wp_kses(__('Pay with your %1$s account via <strong>Xendit</strong>', 'woocommerce-xendit'), ['strong' => []]), 'AstraPay');
            case 'AKULAKU':
                return sprintf(wp_kses(__('Pay with your %1$s account via <strong>Xendit</strong>', 'woocommerce-xendit'), ['strong' => []]), 'Akulaku');
            case 'QRPH':
                return sprintf(wp_kses(__('Pay with your %1$s account via <strong>Xendit</strong>', 'woocommerce-xendit'), ['strong' => []]), 'QRPh');
            case 'DD_AFFIN_FPX':
                return sprintf(wp_kses(__('Pay with your %1$s account via <strong>Xendit</strong>', 'woocommerce-xendit'), ['strong' => []]), 'Affin Bank');
            case 'DD_AFFIN_FPX_BUSINESS':
                return sprintf(wp_kses(__('Pay with your %1$s account via <strong>Xendit</strong>', 'woocommerce-xendit'), ['strong' => []]), 'Affin Bank B2B');
            case 'DD_AGRO_FPX':
                return sprintf(wp_kses(__('Pay with your %1$s account via <strong>Xendit</strong>', 'woocommerce-xendit'), ['strong' => []]), 'AGRONet');
            case 'DD_AGRO_FPX_BUSINESS':
                return sprintf(wp_kses(__('Pay with your %1$s account via <strong>Xendit</strong>', 'woocommerce-xendit'), ['strong' => []]), 'AGRONetBIZ');
            case 'DD_ALLIANCE_FPX':
                return sprintf(wp_kses(__('Pay with your %1$s account via <strong>Xendit</strong>', 'woocommerce-xendit'), ['strong' => []]), 'Alliance Bank (Personal)');
            case 'DD_ALLIANCE_FPX_BUSINESS':
                return sprintf(wp_kses(__('Pay with your %1$s account via <strong>Xendit</strong>', 'woocommerce-xendit'), ['strong' => []]), 'Alliance Bank (Business)');
            case 'DD_AMBANK_FPX':
                return sprintf(wp_kses(__('Pay with your %1$s account via <strong>Xendit</strong>', 'woocommerce-xendit'), ['strong' => []]), 'AmBank');
            case 'DD_AMBANK_FPX_BUSINESS':
                return sprintf(wp_kses(__('Pay with your %1$s account via <strong>Xendit</strong>', 'woocommerce-xendit'), ['strong' => []]), 'AmBank (Business)');
            case 'DD_BNP_FPX_BUSINESS':
                return sprintf(wp_kses(__('Pay with your %1$s account via <strong>Xendit</strong>', 'woocommerce-xendit'), ['strong' => []]), 'BNP Paribas');
            case 'DD_BOC_FPX':
                return sprintf(wp_kses(__('Pay with your %1$s account via <strong>Xendit</strong>', 'woocommerce-xendit'), ['strong' => []]), 'Bank Of China');
            case 'DD_BSN_FPX':
                return sprintf(wp_kses(__('Pay with your %1$s account via <strong>Xendit</strong>', 'woocommerce-xendit'), ['strong' => []]), 'BSN');
            case 'DD_CIMB_FPX':
                return sprintf(wp_kses(__('Pay with your %1$s account via <strong>Xendit</strong>', 'woocommerce-xendit'), ['strong' => []]), 'CIMB Clicks');
            case 'DD_CIMB_FPX_BUSINESS':
                return sprintf(wp_kses(__('Pay with your %1$s account via <strong>Xendit</strong>', 'woocommerce-xendit'), ['strong' => []]), 'CIMB (Business)');
            case 'DD_CITIBANK_FPX_BUSINESS':
                return sprintf(wp_kses(__('Pay with your %1$s account via <strong>Xendit</strong>', 'woocommerce-xendit'), ['strong' => []]), 'Citibank Corporate Banking');
            case 'DD_DEUTSCHE_FPX_BUSINESS':
                return sprintf(wp_kses(__('Pay with your %1$s account via <strong>Xendit</strong>', 'woocommerce-xendit'), ['strong' => []]), 'Deutsche Bank');
            case 'DD_HLB_FPX':
                return sprintf(wp_kses(__('Pay with your %1$s account via <strong>Xendit</strong>', 'woocommerce-xendit'), ['strong' => []]), 'Hong Leong Bank');
            case 'DD_HLB_FPX_BUSINESS':
                return sprintf(wp_kses(__('Pay with your %1$s account via <strong>Xendit</strong>', 'woocommerce-xendit'), ['strong' => []]), 'Hong Leong Bank (Business)');
            case 'DD_HSBC_FPX':
                return sprintf(wp_kses(__('Pay with your %1$s account via <strong>Xendit</strong>', 'woocommerce-xendit'), ['strong' => []]), 'HSBC Bank');
            case 'DD_HSBC_FPX_BUSINESS':
                return sprintf(wp_kses(__('Pay with your %1$s account via <strong>Xendit</strong>', 'woocommerce-xendit'), ['strong' => []]), 'HSBC Bank (Business)');
            case 'DD_ISLAM_FPX':
                return sprintf(wp_kses(__('Pay with your %1$s account via <strong>Xendit</strong>', 'woocommerce-xendit'), ['strong' => []]), 'Bank Islam');
            case 'DD_ISLAM_FPX_BUSINESS':
                return sprintf(wp_kses(__('Pay with your %1$s account via <strong>Xendit</strong>', 'woocommerce-xendit'), ['strong' => []]), 'Bank Islam (Business)');
            case 'DD_KFH_FPX':
                return sprintf(wp_kses(__('Pay with your %1$s account via <strong>Xendit</strong>', 'woocommerce-xendit'), ['strong' => []]), 'KFH');
            case 'DD_KFH_FPX_BUSINESS':
                return sprintf(wp_kses(__('Pay with your %1$s account via <strong>Xendit</strong>', 'woocommerce-xendit'), ['strong' => []]), 'KFH (Business)');
            case 'DD_MAYB2E_FPX_BUSINESS':
                return sprintf(wp_kses(__('Pay with your %1$s account via <strong>Xendit</strong>', 'woocommerce-xendit'), ['strong' => []]), 'Maybank2E (Business)');
            case 'DD_MAYB2U_FPX':
                return sprintf(wp_kses(__('Pay with your %1$s account via <strong>Xendit</strong>', 'woocommerce-xendit'), ['strong' => []]), 'Maybank2u');
            case 'DD_MUAMALAT_FPX':
                return sprintf(wp_kses(__('Pay with your %1$s account via <strong>Xendit</strong>', 'woocommerce-xendit'), ['strong' => []]), 'Bank Muamalat');
            case 'DD_MUAMALAT_FPX_BUSINESS':
                return sprintf(wp_kses(__('Pay with your %1$s account via <strong>Xendit</strong>', 'woocommerce-xendit'), ['strong' => []]), 'Bank Muamalat (Business)');
            case 'DD_OCBC_FPX':
                return sprintf(wp_kses(__('Pay with your %1$s account via <strong>Xendit</strong>', 'woocommerce-xendit'), ['strong' => []]), 'OCBC Bank');
            case 'DD_OCBC_FPX_BUSINESS':
                return sprintf(wp_kses(__('Pay with your %1$s account via <strong>Xendit</strong>', 'woocommerce-xendit'), ['strong' => []]), 'OCBC Bank (Business)');
            case 'DD_PUBLIC_FPX':
                return sprintf(wp_kses(__('Pay with your %1$s account via <strong>Xendit</strong>', 'woocommerce-xendit'), ['strong' => []]), 'Public Bank');
            case 'DD_PUBLIC_FPX_BUSINESS':
                return sprintf(wp_kses(__('Pay with your %1$s account via <strong>Xendit</strong>', 'woocommerce-xendit'), ['strong' => []]), 'Public Bank PB enterprise');
            case 'DD_RAKYAT_FPX':
                return sprintf(wp_kses(__('Pay with your %1$s account via <strong>Xendit</strong>', 'woocommerce-xendit'), ['strong' => []]), 'Bank Rakyat');
            case 'DD_RAKYAT_FPX_BUSINESS':
                return sprintf(wp_kses(__('Pay with your %1$s account via <strong>Xendit</strong>', 'woocommerce-xendit'), ['strong' => []]), 'i-bizRAKYAT');
            case 'DD_RHB_FPX':
                return sprintf(wp_kses(__('Pay with your %1$s account via <strong>Xendit</strong>', 'woocommerce-xendit'), ['strong' => []]), 'RHB Bank');
            case 'DD_RHB_FPX_BUSINESS':
                return sprintf(wp_kses(__('Pay with your %1$s account via <strong>Xendit</strong>', 'woocommerce-xendit'), ['strong' => []]), 'RHB Bank (Business)');
            case 'DD_SCH_FPX':
                return sprintf(wp_kses(__('Pay with your %1$s account via <strong>Xendit</strong>', 'woocommerce-xendit'), ['strong' => []]), 'Standard Chartered');
            case 'DD_SCH_FPX_BUSINESS':
                return sprintf(wp_kses(__('Pay with your %1$s account via <strong>Xendit</strong>', 'woocommerce-xendit'), ['strong' => []]), 'Standard Chartered (Business)');
            case 'DD_UOB_FPX':
                return sprintf(wp_kses(__('Pay with your %1$s account via <strong>Xendit</strong>', 'woocommerce-xendit'), ['strong' => []]), 'UOB Bank');
            case 'DD_UOB_FPX_BUSINESS':
                return sprintf(wp_kses(__('Pay with your %1$s account via <strong>Xendit</strong>', 'woocommerce-xendit'), ['strong' => []]), 'UOB Infinity');
            case 'TOUCHNGO':
                return sprintf(wp_kses(__('Pay with your %1$s account via <strong>Xendit</strong>', 'woocommerce-xendit'), ['strong' => []]), 'Touch \'N Go');
            case 'WECHATPAY':
                return sprintf(wp_kses(__('Pay with your %1$s account via <strong>Xendit</strong>', 'woocommerce-xendit'), ['strong' => []]), 'WechatPay');
            case 'DD_BAY_MB':
                return sprintf(wp_kses(__('Pay with your %1$s account via <strong>Xendit</strong>', 'woocommerce-xendit'), ['strong' => []]), 'Bank of Ayudhya (BAY)');
            case 'DD_BBL_MB':
                return sprintf(wp_kses(__('Pay with your %1$s account via <strong>Xendit</strong>', 'woocommerce-xendit'), ['strong' => []]), 'Bangkok Bank (BBL)');
            case 'DD_KBANK_MB':
                return sprintf(wp_kses(__('Pay with your %1$s account via <strong>Xendit</strong>', 'woocommerce-xendit'), ['strong' => []]), 'Kasikorn Bank (KBank)');
            case 'DD_KTB_MB':
                return sprintf(wp_kses(__('Pay with your %1$s account via <strong>Xendit</strong>', 'woocommerce-xendit'), ['strong' => []]), 'KrungThai Bank (KTB)');
            case 'DD_SCB_MB':
                return sprintf(wp_kses(__('Pay with your %1$s account via <strong>Xendit</strong>', 'woocommerce-xendit'), ['strong' => []]), 'Siam Commercial Bank (SCB)');
            case 'LINEPAY':
                return sprintf(wp_kses(__('Pay with your %1$s account via <strong>Xendit</strong>', 'woocommerce-xendit'), ['strong' => []]), 'LINE Pay');
            case 'PROMPTPAY':
                return sprintf(wp_kses(__('Pay with your %1$s account via <strong>Xendit</strong>', 'woocommerce-xendit'), ['strong' => []]), 'PromptPay');
            case 'TRUEMONEY':
                return sprintf(wp_kses(__('Pay with your %1$s account via <strong>Xendit</strong>', 'woocommerce-xendit'), ['strong' => []]), 'TrueMoney');    
            default:
                return sprintf(wp_kses(__('Pay with bank transfer %1$s or virtual account via <strong>Xendit</strong>', 'woocommerce-xendit'), ['strong' => []]), $this->method_code);
        }
    }

    /**
     * @return string
     */
    public function get_xendit_admin_description(): string
    {
        return sprintf(wp_kses(__('Collect payment from %1$s on checkout page and get the report realtime on your Xendit Dashboard. <a href="%2$s" target="_blank">Sign In</a> or <a href="%3$s" target="_blank">sign up</a> on Xendit and integrate with your <a href="%4$s" target="_blank">Xendit keys</a>', 'woocommerce-xendit'), ['a' => ['href' => true, 'target' => true]]), $this->method_code, 'https://dashboard.xendit.co/auth/login', 'https://dashboard.xendit.co/register', 'https://dashboard.xendit.co/settings/developers#api-keys');
    }

    /**
     * @param $sub_account_id
     * @return true
     * @throws Exception
     */
    protected function validate_sub_account($sub_account_id): bool
    {
        if (empty($sub_account_id)) {
            throw new Exception(__('Please enter XenPlatform User.', 'woocommerce-xendit'));
        }

        $response = $this->xenditClass->getSubAccount($sub_account_id);
        if (!empty($response['account_id'])) {
            return true;
        }

        if (!empty($response['error_code'])) {
            throw new Exception(__($response['message'], 'woocommerce-xendit'));
        }

        throw new Exception(__('Validate XenPlatform User failed', 'woocommerce-xendit'));
    }

    /**
     * @param array $settings
     * @return bool
     */
    protected function is_test_mode(array $settings = []): bool
    {
        if (empty($settings['secret_key']) && !empty($settings['secret_key_dev'])) {
            return true;
        }

        return false;
    }

    /**
     * @return bool
     * @throws Exception
     */
    public function process_admin_options(): bool
    {
        // To avoid duplicated request
        if (self::$setting_processed > 0) {
            return false;
        }

        $this->init_settings();
        $post_data = $this->get_post_data();

        foreach ($this->get_form_fields() as $key => $field) {
            if ('title' !== $this->get_field_type($field)) {
                try {
                    $value = $this->get_field_value($key, $field, $post_data);

                    // map dummy api keys
                    if (in_array($key, self::API_KEY_FIELDS)) {
                        $real_key_field = str_replace('dummy_', '', $key);
                        $real_api_key_char_count = !empty($this->settings[$real_key_field]) ? strlen($this->settings[$real_key_field]) : 0;

                        if ($value === $this->generateStarChar($real_api_key_char_count)) { // skip when no changes
                            continue;
                        } else {
                            $this->settings[$real_key_field] = $value; // save real api keys in original field name
                        }
                        $this->settings[$key] = $this->generateStarChar($real_api_key_char_count); // always set dummy fields to ****
                        continue;
                    }

                    $this->settings[$key] = $value;
                } catch (Exception $e) {
                    WC_Admin_Settings::add_error(esc_html__($e->getMessage(), 'woocommerce-xendit'));
                }
            }
        }

        if (!isset($post_data['woocommerce_' . $this->id . '_enabled']) && $this->get_option_key() == 'woocommerce_' . $this->id . '_settings') {
            $this->settings['enabled'] = $this->id === 'xendit_gateway' ? 'no' : $this->enabled;
        }

        // default value
        if ($this->id === 'xendit_gateway') {
            $this->settings['external_id_format'] = empty($this->settings['external_id_format']) ? self::DEFAULT_EXTERNAL_ID_VALUE : $this->settings['external_id_format'];
        }

        // Update settings
        update_option($this->get_option_key(), apply_filters('woocommerce_settings_api_sanitized_fields_' . $this->id, $this->settings), 'yes');
        self::$setting_processed += 1;

        // validate sub account
        try {
            if (isset($this->settings['enable_xenplatform']) && $this->settings['enable_xenplatform'] === 'yes') {
                $this->validate_sub_account($this->settings['on_behalf_of']);
            }
        } catch (Exception $e) {
            // Reset Xen Platform if validation failed
            $this->settings['enable_xenplatform'] = 'no';
            $this->settings['on_behalf_of'] = '';
            update_option($this->get_option_key(), apply_filters('woocommerce_settings_api_sanitized_fields_' . $this->id, $this->settings), 'yes');

            WC_Admin_Settings::add_error(esc_html__($e->getMessage(), 'woocommerce-xendit'));
            return false;
        }

        return true;
    }

    /**
     * @param $count
     * @return string
     */
    private function generateStarChar($count = 0): string
    {
        $result = '';
        for ($i = 0; $i < $count; $i++) {
            $result .= '*';
        }

        return $result;
    }

    public function get_localized_error_message($error_code, $message)
    {
        switch ($error_code) {
            case 'UNSUPPORTED_CURRENCY':
                return str_replace('{{currency}}', get_woocommerce_currency(), $message);
            default:
                return $message ? $message : $error_code;
        }
    }

    public function map_payment_channel($channel)
    {
        switch (strtoupper($channel)) {
            case 'BCA':
                $xendit = new WC_Xendit_BCAVA();
                break;
            case 'BNI':
                $xendit = new WC_Xendit_BNIVA();
                break;
            case 'BRI':
                $xendit = new WC_Xendit_BRIVA();
                break;
            case 'MANDIRI':
                $xendit = new WC_Xendit_MandiriVA();
                break;
            case 'PERMATA':
                $xendit = new WC_Xendit_PermataVA();
                break;
            case 'BSI':
                $xendit = new WC_Xendit_BSIVA();
                break;
            case 'BJB':
                $xendit = new WC_Xendit_BJBVA();
                break;
            case 'BSS':
                $xendit = new WC_Xendit_BSSVA();
                break;
            case 'ALFAMART':
                $xendit = new WC_Xendit_Alfamart();
                break;
            case 'INDOMARET':
                $xendit = new WC_Xendit_Indomaret();
                break;
            case 'SHOPEEPAY':
                $xendit = new WC_Xendit_Shopeepay();
                break;
            case 'DANA':
                $xendit = new WC_Xendit_DANA();
                break;
            case 'OVO':
                $xendit = new WC_Xendit_OVO();
                break;
            case 'LINKAJA':
                $xendit = new WC_Xendit_LINKAJA();
                break;
            case 'QRIS':
                $xendit = new WC_Xendit_QRIS();
                break;
            case 'CREDIT_CARD':
                $xendit = new WC_Xendit_CC();
                break;
            case 'DD_BRI':
                $xendit = new WC_Xendit_DD_BRI();
                break;
            case 'DD_BPI':
                $xendit = new WC_Xendit_DD_BPI();
                break;
            case 'DD_UBP':
                $xendit = new WC_Xendit_DD_UBP();
                break;
            case 'DD_RCBC':
                $xendit = new WC_Xendit_DD_RCBC();
                break;
            case 'BILLEASE':
                $xendit = new WC_Xendit_Billease();
                break;
            case 'KREDIVO':
                $xendit = new WC_Xendit_Kredivo();
                break;
            case 'PAYMAYA':
                $xendit = new WC_Xendit_Paymaya();
                break;
            case '7ELEVEN':
                $xendit = new WC_Xendit_7Eleven();
                break;
            case 'LBC':
                $xendit = new WC_Xendit_LBC();
                break;
            case 'GCASH':
                $xendit = new WC_Xendit_Gcash();
                break;
            case 'GRABPAY':
                $xendit = new WC_Xendit_Grabpay();
                break;
            case 'CEBUANA':
                $xendit = new WC_Xendit_Cebuana();
                break;
            case 'DP_MLHUILLIER':
                $xendit = new WC_Xendit_DP_Mlhuillier();
                break;
            case 'DP_PALAWAN':
                $xendit = new WC_Xendit_DP_Palawan();
                break;
            case 'DP_ECPAY_LOAN':
                $xendit = new WC_Xendit_DP_ECPay_Loan();
                break;
            case 'DP_ECPAY_SCHOOL':
                $xendit = new WC_Xendit_DP_ECPay_School();
                break;
            case 'CASHALO':
                $xendit = new WC_Xendit_Cashalo();
                break;
            case 'ASTRAPAY':
                $xendit = new WC_Xendit_Astrapay();
                break;
            case 'AKULAKU':
                $xendit = new WC_Xendit_Akulaku();
                break;
            case 'ATOME':
                $xendit = new WC_Xendit_Atome();
                break;
            case 'JENIUSPAY':
                $xendit = new WC_Xendit_Jeniuspay();
                break;
            case 'CIMB':
                $xendit = new WC_Xendit_CIMBVA();
                break;
            case 'DD_CHINABANK':
                $xendit = new WC_Xendit_DD_Chinabank();
                break;
            case 'DD_BDO_EPAY':
                $xendit = new WC_Xendit_DD_BDO_Epay();
                break;
            case 'QRPH':
                $xendit = new WC_Xendit_QRPh();
                break;
            case 'DD_AFFIN_FPX':
                $xendit = new WC_Xendit_DD_Affin_FPX();
                break;
            case 'DD_AFFIN_FPX_BUSINESS':
                $xendit = new WC_Xendit_DD_Affin_FPX_Business();
                break;
            case 'DD_AGRO_FPX':
                $xendit = new WC_Xendit_DD_Agro_FPX();
                break;
            case 'DD_AGRO_FPX_BUSINESS':
                $xendit = new WC_Xendit_DD_Agro_FPX_Business();
                break;
            case 'DD_ALLIANCE_FPX':
                $xendit = new WC_Xendit_DD_Alliance_FPX();
                break;
            case 'DD_ALLIANCE_FPX_BUSINESS':
                $xendit = new WC_Xendit_DD_Alliance_FPX_Business();
                break;
            case 'DD_AMBANK_FPX':
                $xendit = new WC_Xendit_DD_Ambank_FPX();
                break;
            case 'DD_AMBANK_FPX_BUSINESS':
                $xendit = new WC_Xendit_DD_Ambank_FPX_Business();
                break;
            case 'DD_BNP_FPX_BUSINESS':
                $xendit = new WC_Xendit_DD_BNP_FPX_Business();
                break;
            case 'DD_BOC_FPX':
                $xendit = new WC_Xendit_DD_BOC_FPX();
                break;
            case 'DD_BSN_FPX':
                $xendit = new WC_Xendit_DD_BSN_FPX();
                break;
            case 'DD_CIMB_FPX':
                $xendit = new WC_Xendit_DD_CIMB_FPX();
                break;
            case 'DD_CIMB_FPX_BUSINESS':
                $xendit = new WC_Xendit_DD_CIMB_FPX_Business();
                break;
            case 'DD_CITIBANK_FPX_BUSINESS':
                $xendit = new WC_Xendit_DD_Citibank_FPX_Business();
                break;
            case 'DD_DEUTSCHE_FPX_BUSINESS':
                $xendit = new WC_Xendit_DD_Deutsche_FPX_Business();
                break;
            case 'DD_HLB_FPX':
                $xendit = new WC_Xendit_DD_HLB_FPX();
                break;
            case 'DD_HLB_FPX_BUSINESS':
                $xendit = new WC_Xendit_DD_HLB_FPX_Business();
                break;
            case 'DD_HSBC_FPX':
                $xendit = new WC_Xendit_DD_HSBC_FPX();
                break;
            case 'DD_HSBC_FPX_BUSINESS':
                $xendit = new WC_Xendit_DD_HSBC_FPX_Business();
                break;
            case 'DD_ISLAM_FPX':
                $xendit = new WC_Xendit_DD_Islam_FPX();
                break;
            case 'DD_ISLAM_FPX_BUSINESS':
                $xendit = new WC_Xendit_DD_Islam_FPX_Business();
                break;
            case 'DD_KFH_FPX':
                $xendit = new WC_Xendit_DD_KFH_FPX();
                break;
            case 'DD_KFH_FPX_BUSINESS':
                $xendit = new WC_Xendit_DD_KFH_FPX_Business();
                break;
            case 'DD_MAYB2E_FPX_BUSINESS':
                $xendit = new WC_Xendit_DD_Mayb2e_FPX_Business();
                break;
            case 'DD_MAYB2U_FPX':
                $xendit = new WC_Xendit_DD_Mayb2u_FPX();
                break;
            case 'DD_MUAMALAT_FPX':
                $xendit = new WC_Xendit_DD_Muamalat_FPX();
                break;
            case 'DD_MUAMALAT_FPX_BUSINESS':
                $xendit = new WC_Xendit_DD_Muamalat_FPX_Business();
                break;
            case 'DD_OCBC_FPX':
                $xendit = new WC_Xendit_DD_OCBC_FPX();
                break;
            case 'DD_OCBC_FPX_BUSINESS':
                $xendit = new WC_Xendit_DD_OCBC_FPX_Business();
                break;
            case 'DD_PUBLIC_FPX':
                $xendit = new WC_Xendit_DD_Public_FPX();
                break;
            case 'DD_PUBLIC_FPX_BUSINESS':
                $xendit = new WC_Xendit_DD_Public_FPX_Business();
                break;
            case 'DD_RAKYAT_FPX':
                $xendit = new WC_Xendit_DD_Rakyat_FPX();
                break;
            case 'DD_RAKYAT_FPX_BUSINESS':
                $xendit = new WC_Xendit_DD_Rakyat_FPX_Business();
                break;
            case 'DD_RHB_FPX':
                $xendit = new WC_Xendit_DD_RHB_FPX();
                break;
            case 'DD_RHB_FPX_BUSINESS':
                $xendit = new WC_Xendit_DD_RHB_FPX_Business();
                break;
            case 'DD_SCH_FPX':
                $xendit = new WC_Xendit_DD_SCH_FPX();
                break;
            case 'DD_SCH_FPX_BUSINESS':
                $xendit = new WC_Xendit_DD_SCH_FPX_Business();
                break;
            case 'DD_UOB_FPX':
                $xendit = new WC_Xendit_DD_UOB_FPX();
                break;
            case 'DD_UOB_FPX_BUSINESS':
                $xendit = new WC_Xendit_DD_UOB_FPX_Business();
                break;
            case 'TOUCHNGO':
                $xendit = new WC_Xendit_Touchngo();
                break;
            case 'WECHATPAY':
                $xendit = new WC_Xendit_Wechatpay();
                break;
            case 'DD_BAY_MB':
                $xendit = new WC_Xendit_DD_Bay_Mb();
                break;
            case 'DD_BBL_MB':
                $xendit = new WC_Xendit_DD_Bbl_Mb();
                break;
            case 'DD_KBANK_MB':
                $xendit = new WC_Xendit_DD_Kbank_Mb();
                break;
            case 'DD_KTB_MB':
                $xendit = new WC_Xendit_DD_Ktb_Mb();
                break;
            case 'DD_SCB_MB':
                $xendit = new WC_Xendit_DD_Scb_Mb();
                break;
            case 'LINEPAY':
                $xendit = new WC_Xendit_Linepay();
                break;
            case 'PROMPTPAY':
                $xendit = new WC_Xendit_Promptpay();
                break;
            case 'TRUEMONEY':
                $xendit = new WC_Xendit_Truemoney();
                break;
            default:
                return false;
        }

        return array('id' => $xendit->id, 'title' => $xendit->title);
    }

    /**
     * @return string
     */
    public function get_xendit_option(string $key)
    {
        return $this->get_option($key);
    }

    /**
     * @param $order_id
     * @param $old_status
     * @param $new_status
     * @return void
     * @throws Exception
     */
    public function expire_invoice_when_order_cancelled($order_id, $old_status, $new_status)
    {
        if ($new_status !== 'cancelled') {
            return;
        }

        $order = wc_get_order($order_id);
        if ($order) {
            $payment_method = $order->get_payment_method();
            $xendit_invoice_expired = $order->get_meta('Xendit_invoice_expired');
            $xendit_invoice_id = $order->get_meta('Xendit_invoice');

            if (preg_match('/xendit/i', $payment_method)
                && empty($xendit_invoice_expired)
            ) {
                // Expire Xendit invoice
                $response = $this->xenditClass->expiredInvoice($xendit_invoice_id);
                if (!empty($response) && !isset($response['error_code'])) {
                    $order->add_meta_data('Xendit_invoice_expired', 1);
                    $order->save();
                }
            }
        }
    }

    /**
     * Cancel all unpaid orders after held duration to prevent stock lock for those products.
     */
    public function custome_cancel_unpaid_orders()
    {
        global $wpdb;

        $held_duration = get_option('woocommerce_hold_stock_minutes');

        if ($held_duration < 1 || 'yes' !== get_option('woocommerce_manage_stock')) {
            return;
        }

        $canceled_order = $wpdb->get_col(
            $wpdb->prepare(
				// @codingStandardsIgnoreStart
				"SELECT posts.ID
				FROM {$wpdb->posts} AS posts
                LEFT JOIN {$wpdb->postmeta} AS pm_expired
                    ON posts.ID = pm_expired.post_id
                        AND pm_expired.meta_key = 'Xendit_invoice_expired'
                LEFT JOIN {$wpdb->postmeta} AS pm_method
                    ON posts.ID = pm_method.post_id
                        AND pm_method.meta_key = '_payment_method'
				WHERE posts.post_type IN ('" . implode( "','", wc_get_order_types() ) . "')
                    AND posts.post_status = 'wc-cancelled'
                    AND `pm_method`.`meta_value` LIKE 'xendit_%'
                    AND pm_expired.meta_id IS NULL"
			)
		);

        if ($canceled_order) {
            foreach ($canceled_order as $cancel_order) {
                $order = wc_get_order( $cancel_order );
                $xendit_invoice_expired = $order->get_meta('Xendit_invoice_expired');
                $xendit_invoice_id = $order->get_meta('Xendit_invoice');
                if (empty($xendit_invoice_expired)) {
                    $order->add_meta_data('Xendit_invoice_expired', 1);
                    $order->save();

                    $response = $this->xenditClass->expiredInvoice($xendit_invoice_id);
                }
            }
        }
    }

    /**
     * @param $public_key
     * @param $public_key_dev
     * @return true
     */
    public function update_public_keys($public_key, $public_key_dev): bool
    {
        if (!empty($public_key)) {
            $this->update_option('api_key', $public_key);
        }

        if (!empty($public_key_dev)) {
            $this->update_option('api_key_dev', $public_key_dev);
        }

        return true;
    }
}
