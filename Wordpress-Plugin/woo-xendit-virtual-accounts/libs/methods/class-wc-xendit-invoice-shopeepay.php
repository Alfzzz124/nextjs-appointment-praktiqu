<?php

if (!defined('ABSPATH')) {
    exit;
}

class WC_Xendit_Shopeepay extends WC_Xendit_Invoice
{
    const DEFAULT_MAXIMUM_AMOUNT = 20000000;
    const DEFAULT_MAXIMUM_AMOUNT_PH = 200000;
    const DEFAULT_MINIMUM_AMOUNT = 100;
    const DEFAULT_MINIMUM_AMOUNT_PH = 1;
    const DEFAULT_MINIMUM_AMOUNT_MY = 1;
    const DEFAULT_MAXIMUM_AMOUNT_MY = 4999;
    const DEFAULT_MINIMUM_AMOUNT_TH = 1;
    const DEFAULT_MAXIMUM_AMOUNT_TH = 200000;

    const XENDIT_METHOD_CODE = 'shopeepay';

    public function __construct()
    {
        parent::__construct();

        $this->id           = 'xendit_shopeepay';

        // Load the form fields.
        $this->init_form_fields();

        // Load the settings.
        $this->init_settings();

        // $xendit_settings = get_option( 'woocommerce_xendit_settings' );
        $this->enabled = $this->get_option('enabled');

        $this->method_code = self::XENDIT_METHOD_CODE;
        $this->default_title = 'ShopeePay';
        $this->title = !empty($this->get_option('channel_name')) ? $this->get_option('channel_name') : $this->default_title;
        $this->description = !empty($this->get_option('payment_description')) ? nl2br($this->get_option('payment_description')) : $this->get_xendit_method_description();

        if (get_woocommerce_currency() === 'MYR') {
            $this->DEFAULT_MAXIMUM_AMOUNT = self::DEFAULT_MAXIMUM_AMOUNT_MY;
            $this->DEFAULT_MINIMUM_AMOUNT = self::DEFAULT_MINIMUM_AMOUNT_MY;
        } else  if (get_woocommerce_currency() === 'PHP') {
            $this->DEFAULT_MAXIMUM_AMOUNT = self::DEFAULT_MAXIMUM_AMOUNT_PH;
            $this->DEFAULT_MINIMUM_AMOUNT = self::DEFAULT_MINIMUM_AMOUNT_PH;
        } else if (get_woocommerce_currency() === 'THB') {
            $this->DEFAULT_MAXIMUM_AMOUNT = self::DEFAULT_MAXIMUM_AMOUNT_TH;
            $this->DEFAULT_MINIMUM_AMOUNT = self::DEFAULT_MINIMUM_AMOUNT_TH;
        } else {
            $this->DEFAULT_MAXIMUM_AMOUNT = self::DEFAULT_MAXIMUM_AMOUNT;
            $this->DEFAULT_MINIMUM_AMOUNT = self::DEFAULT_MINIMUM_AMOUNT;
        }

        $this->method_title = __('Xendit ShopeePay', 'woocommerce-xendit');
        $this->method_description = $this->get_xendit_admin_description();

        add_action('woocommerce_update_options_payment_gateways_' . $this->id, array($this, 'process_admin_options'));
    }

    public function init_form_fields()
    {
        $this->form_fields = require(WC_XENDIT_PG_PLUGIN_PATH . '/libs/forms/wc-xendit-invoice-shopeepay-settings.php');
    }

    public function admin_options()
    {
        ?>
        <script>
            jQuery(document).ready(function($) {
                $('.channel-name-format').text('<?=$this->title;?>');
                $('#woocommerce_<?=$this->id;?>_channel_name').change(
                    function() {
                        $('.channel-name-format').text($(this).val());
                    }
                );

                var isSubmitCheckDone = false;

                $("button[name='save']").on('click', function(e) {
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
}
