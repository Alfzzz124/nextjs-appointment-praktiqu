<?php

use KCTApp\baseClasses\KCTActivate;
use KCTApp\baseClasses\KCTApp;
/**
 * Plugin Name: KiviCare - Clinic & Patient Management System (EHR) Telemed add-on
 * Plugin URI: https://kivicare.io
 * Description: KiviCare - Telemed add-on is an impressive add-on for KiviCare - Clinic & Patient Management System (EHR) plugin.
 * Version: 4.0.0
 * Author: iqonic
 * Text Domain: kivicare-telemed-addon
 * Requires Plugins: kivicare-clinic-management-system
 * Domain Path: /languages
 * Author URI: http://iqonic.design/
 **/


defined('ABSPATH') or die('Something went wrong');

// Require once the Composer Autoload
if (file_exists(dirname(__FILE__) . '/vendor/autoload.php')) {
    require_once dirname(__FILE__) . '/vendor/autoload.php';
} else {
    die('Something went wrong');
}

if (!defined('KIVICARE_TELEMED_DIR')) {
    define('KIVICARE_TELEMED_DIR', plugin_dir_path(__FILE__));
}

if (!defined('KIVICARE_TELEMED_DIR_URI')) {
    define('KIVICARE_TELEMED_DIR_URI', plugin_dir_url(__FILE__));
}


if (!defined('KIVICARE_TELEMED_NAMESPACE')) {
    define('KIVICARE_TELEMED_NAMESPACE', "kivi-care");
}

if (!defined('KIVICARE_TELEMED_PREFIX')) {
    define('KIVICARE_TELEMED_PREFIX', "kiviCare_");
}

if (!defined('KIVICARE_TELEMED_REQUIRED_PLUGIN_VERSION')) {
    define('KIVICARE_TELEMED_REQUIRED_PLUGIN_VERSION', "4.0.0");
}

if (!defined('KIVICARE_TELEMED_VERSION')) {
    define('KIVICARE_TELEMED_VERSION', "4.0.0");
}

if (!defined('KIVICARE_TELEMED_BASE_PATH')) {
    define('KIVICARE_TELEMED_BASE_PATH', plugin_basename(__FILE__));
}
/**
 * The code that runs during plugin activation
 */
register_activation_hook(__FILE__, [KCTActivate::class, 'activate']);

/**
 * Handle KiviCare Lite version compatibility
 */
add_action('plugins_loaded', function () {
    if (is_admin()) {
        if (!function_exists('is_plugin_active')) {
            require_once(ABSPATH . 'wp-admin/includes/plugin.php');
        }

        $lite_active = is_plugin_active('kivicare-clinic-management-system/kivicare-clinic-management-system.php');
        $lite_version = defined('KIVI_CARE_VERSION') ? KIVI_CARE_VERSION : '0.0.0';

        if (!$lite_active || version_compare($lite_version, '4.0.0', '<')) {
            deactivate_plugins(KIVICARE_TELEMED_BASE_PATH);
            if (isset($_GET['activate']))
                unset($_GET['activate']);
            add_action('admin_notices', function () {
                ?>
                <div class="notice notice-error is-dismissible">
                    <p><?php _e('<strong>KiviCare Zoom Telemed AddOn </strong> has been deactivated. It requires KiviCare Lite version 4.0.0 or higher.', 'kivicare-telemed-addon'); ?>
                    </p>
                </div>
                <?php
            });
            return;
        }
    }
    (new KCTApp)->init();

}, 1);