<?php
if (!defined('ABSPATH')) {
    exit;
}

/**
 * WC_Xendit_Payment_Fees
 *
 * @since 2.39.0
 */

class WC_Xendit_Payment_Fees
{
    /**
     * @param WC_Order $order
     * @return array
     */
    public static function generatePaymentFees(WC_Order $order): array
    {
        // If order is deposit then using parent order to generate invoice data
        if (WC_Xendit_PG_Helper::is_deposit_order($order)) {
            $parent = wc_get_order($order->get_parent_id());
            if ($parent) {
                $order = $parent;
            }
        }

        $fees = [
            [
                'type' => esc_html(__('Discount', 'woocommerce-xendit')),
                'value' => (float) $order->get_discount_total() * -1
            ],
            [
                'type' => esc_html(__('Shipping fee', 'woocommerce-xendit')),
                'value' => (float) $order->get_shipping_total()
            ],
            [
                'type' => esc_html(__('Other Fees', 'woocommerce-xendit')),
                'value' => self::get_custom_total_fees($order)
            ],
            [
                'type' => esc_html(__('Tax fee', 'woocommerce-xendit')),
                'value' => $order->get_total_tax()
            ]
        ];

        return array_values(
            array_filter($fees, function ($value) {
                return $value['value'] != 0;
            }, ARRAY_FILTER_USE_BOTH)
        );
    }

    public static function get_custom_total_fees($order)
    {
        return version_compare(WC_VERSION, '4.0.0', '<') ?
            array_reduce(
                $order->get_fees(),
                function ($carry, $item) {
                    return $carry + $item->get_total();
                }
            )
            : $order->get_total_fees();
    }
}
