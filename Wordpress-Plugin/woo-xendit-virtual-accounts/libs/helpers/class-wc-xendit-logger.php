<?php
if (!defined('ABSPATH')) {
    exit; // Exit if accessed directly
}

/**
 * Xendit Logger
 *
 * @since 1.2.3
 */
class WC_Xendit_PG_Logger
{

    public static $logger;
    const WC_LOG_FILENAME = 'xendit-pg-woocommerce-gateway';

    /**
     * Utilize WC logger class
     *
     * @since 1.2.3
     * @version 1.2.3
     */
    public static function log($message)
    {
        if (!class_exists('WC_Logger')) {
            return;
        }

        if (apply_filters('wc_xendit_logging', true, $message)) {
            if (empty(self::$logger)) {
                self::$logger = wc_get_logger();
            }

            $log_entry = "\n" . '<<Plugin Version: ' . WC_XENDIT_PG_VERSION . '>>' . "\n";
            $log_entry .= '====Start Log====' . "\n" . $message . "\n" . '====End Log====' . "\n\n";

            self::$logger->debug($log_entry, array('source' => self::WC_LOG_FILENAME));
        }
    }
}
