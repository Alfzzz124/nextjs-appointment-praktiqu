<?php

if (!defined('ABSPATH')) {
    exit;
}

/**
 * Xendit Expired
 *
 * @since 2.39.0
 */

class WC_Xendit_Expired
{
    /**
     * It takes a duration and a unit of time and returns the number of seconds that duration
     * represents
     *
     * @param duration The number of days, hours, or minutes you want the coupon to be valid for.
     * @param unit The unit of time to use. Can be DAYS, HOURS, MINUTES.
     */
    public static function generateExpiredTime($duration = 1, $unit = 'DAYS')
    {
        global $wpdb, $woocommerce;

        $in_seconds = 1;
        switch ($unit) {
            case 'DAYS':
                $in_seconds = 24 * $duration * 60 * 60;
                break;
            
            case 'HOURS':
                $in_seconds = $duration * 60 * 60;
                break;
            case 'MINUTES':
                $in_seconds = $duration * 60;
                break;
            default:
                $in_seconds = 0;
                break;
        }

        return $in_seconds;
    }
}
