<?php

if (!defined('ABSPATH')) {
    exit;
}

/**
 * Xendit OAuth
 *
 * @since 2.27.0
 */

class WC_Xendit_Oauth
{
    const XENDIT_OAUTH_OPTION_NAME = 'woocommerce_xendit_oauth_data';

    const XENDIT_VALIDATION_KEY_OPTION_NAME = 'woocommerce_xendit_oauth_validation_key';

    /**
     * @param array $data
     * @return void
     */
    public static function updateXenditOAuth(array $data = [])
    {
        if (!empty($data['oauth_data'])) {
            $oauth = get_option(self::XENDIT_OAUTH_OPTION_NAME);
            if (empty($oauth)) {
                add_option(self::XENDIT_OAUTH_OPTION_NAME, $data['oauth_data']);
            } else {
                update_option(self::XENDIT_OAUTH_OPTION_NAME, $data['oauth_data']);
            }
        }
    }

    public static function removeXenditOAuth()
    {
        global $wpdb, $woocommerce;

        $xenditClass = new WC_Xendit_PG_API();
        $xenditClass->uninstallApp();

        delete_option(self::XENDIT_OAUTH_OPTION_NAME);

        return true;
    }

    public static function getXenditOAuth()
    {
        global $wpdb, $woocommerce;

        return get_option(self::XENDIT_OAUTH_OPTION_NAME);
    }

    /*
    * param: $key string
    *
    * return boolean
    */
    public static function updateValidationKey($key)
    {
        global $wpdb, $woocommerce;

        $oauth = get_option(self::XENDIT_VALIDATION_KEY_OPTION_NAME);

        return empty($oauth) ? add_option(self::XENDIT_VALIDATION_KEY_OPTION_NAME, $key) : update_option(self::XENDIT_VALIDATION_KEY_OPTION_NAME, $key) ;
    }

    public static function getValidationKey()
    {
        global $wpdb, $woocommerce;

        return get_option(self::XENDIT_VALIDATION_KEY_OPTION_NAME);
    }
}
