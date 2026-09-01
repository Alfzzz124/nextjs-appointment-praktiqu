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
