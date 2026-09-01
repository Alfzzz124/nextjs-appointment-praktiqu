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
     * $markup_percent is the clinic's business markup for foreign patients,
     * kept separate from $rate (2026-09-01 markup-vs-rate decision): $rate is
     * an honest market figure, and the markup is applied on top of it, inside
     * the ceiling rather than after — so the sub-cent remainder from the
     * markup itself also accrues to the clinic instead of being shaved off.
     * The default of 0.0 makes a 2-argument call behave exactly as before
     * this parameter existed.
     *
     * The inner round(..., 6) guards against binary-float error inflating an
     * exact value. Without it, (10.0 * 100) can evaluate to 1000.0000000001,
     * and ceil() would turn an exact $10.00 into $10.01. This guard applies
     * after the markup multiplication too, for the same reason.
     *
     * @param float $idr            Amount in rupiah.
     * @param float $rate           Rupiah per 1 unit of the target currency; must be > 0.
     * @param float $markup_percent Extra percentage on top of the converted amount; must be >= 0.
     *
     * @throws \InvalidArgumentException When the rate is zero or negative, or the markup is negative.
     */
    public static function idr_to_foreign(float $idr, float $rate, float $markup_percent = 0.0): float
    {
        if ($rate <= 0) {
            throw new \InvalidArgumentException('FX rate must be greater than zero');
        }
        if ($markup_percent < 0) {
            throw new \InvalidArgumentException('Markup percent must not be negative');
        }
        return ceil(round(($idr / $rate) * (1 + $markup_percent / 100) * 100, 6)) / 100;
    }
}
