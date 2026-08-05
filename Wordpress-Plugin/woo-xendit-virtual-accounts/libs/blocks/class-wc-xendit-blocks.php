<?php
use Automattic\WooCommerce\Blocks\Payments\Integrations\AbstractPaymentMethodType;

final class WC_Xendit_Blocks extends AbstractPaymentMethodType
{
    const SCRIPT_HANDLER = 'wc-xendit-payments-blocks';

    /**
     * Initializes the payment method type.
     */
    public function initialize()
    {
    }

    /**
     * Returns an array of scripts/handles to be registered for this payment method.
     *
     * @return array
     */
    public function get_payment_method_script_handles(): array
    {
        $script_path       = '/assets/js/frontend/xendit-blocks.min.js';
        $script_asset_path = WC_Xendit_PG::plugin_abspath() . 'assets/js/frontend/xendit-blocks.min.asset.php';
        $script_asset      = file_exists($script_asset_path)
            ? require($script_asset_path)
            : array(
                'dependencies' => array(),
                'version'      => WC_XENDIT_PG_VERSION
            );
        $script_url        = WC_Xendit_PG::plugin_url() . $script_path;

        wp_register_script(
            self::SCRIPT_HANDLER,
            $script_url,
            $script_asset[ 'dependencies' ],
            $script_asset[ 'version' ],
            true
        );

        $this->localize_wc_blocks_data();

        if (function_exists('wp_set_script_translations')) {
            wp_set_script_translations(self::SCRIPT_HANDLER, 'woocommerce-xendit', WC_Xendit_PG::plugin_abspath() . 'languages/');
        }

        return [ self::SCRIPT_HANDLER ];
    }

    /**
     * @return void
     */
    public function localize_wc_blocks_data()
    {
        wp_localize_script(
            self::SCRIPT_HANDLER,
            'xenditBlockData',
            [
                'gatewayData' => $this->get_payment_method_data(),
            ]
        );
    }

    /**
     * @param $gateway
     * @return string
     */
    public function generate_description($gateway): string
    {
        if (WC_Xendit_Invoice::instance()->developmentmode === 'yes') {
            return wp_kses(__('<strong>TEST MODE</strong> - Real payment will not be detected', 'woocommerce-xendit'), ['strong' => []]);
        }

        return $gateway->description;
    }

    /**
     * Returns an array of key=>value pairs of data made available to the payment methods script.
     *
     * @return array
     */
    public function get_payment_method_data(): array
    {
        $availablePaymentMethods = [];
        $availableGateways = WC()->payment_gateways()->get_available_payment_gateways();
        foreach ($availableGateways as $key => $gateway) {
            if (strpos($key, 'xendit_') === false) {
                unset($availableGateways[$key]);
            }
        }

        foreach ($availableGateways as $gateway) {
            if ($gateway->get_option('enabled') === 'no') {
                continue;
            }

            $titleMarkup = "<span style='margin-right: 1em'>{$gateway->title}</span>{$gateway->get_icon()}";
            $availablePaymentMethods[] = [
                'id'          => $gateway->id,
                'title'       => $gateway->id !== 'xendit_gateway' ? $titleMarkup : 'Xendit',
                'description' => $this->generate_description($gateway),
                'supports'    => array_filter($gateway->supports, [ $gateway, 'supports' ]),
            ];
        }

        return [
            'availableGateways' => $availablePaymentMethods,
            'isLive'            => WC_Xendit_Invoice::instance()->developmentmode === 'no',
        ];
    }
}
