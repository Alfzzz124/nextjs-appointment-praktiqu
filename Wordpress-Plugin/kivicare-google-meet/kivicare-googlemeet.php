<?php
/**
 * Plugin Name: KiviCare - Clinic & Patient Management System (EHR) Google Meet Telemed AddOn
 * Plugin URI: https://kivicare.io
 * Description: KiviCare - Google Meet is an impressive AddOn of Kivicare clinic and patient management plugin (EHR).
 * Version: 4.0.1
 * Author: iqonicdesign
 * Text Domain: kivicare-googlemeet-telemed-addon
 * Requires Plugins: kivicare-clinic-management-system
 * Domain Path: /languages
 * Author URI: http://iqonic.design/
 **/

defined('ABSPATH') or die('Something went wrong');

// Require Composer Autoload
if (file_exists(dirname(__FILE__) . '/vendor/autoload.php')) {
    require_once dirname(__FILE__) . '/vendor/autoload.php';
} else {
    die('Something went wrong');
}

if (!defined('KIVICARE_GOOGLE_MEET_DIR')) {
    define('KIVICARE_GOOGLE_MEET_DIR', plugin_dir_path(__FILE__));
}

if (!defined('KIVICARE_GOOGLE_MEET_DIR_URI')) {
    define('KIVICARE_GOOGLE_MEET_DIR_URI', plugin_dir_url(__FILE__));
}

if (!defined('KIVICARE_GOOGLE_MEET_BASE_PATH')) {
    define('KIVICARE_GOOGLE_MEET_BASE_PATH', plugin_basename(__FILE__));
}

if (!defined('KIVICARE_GOOGLE_MEET_PREFIX')) {
    define('KIVICARE_GOOGLE_MEET_PREFIX', 'kiviCare_');
}

if (!defined('KIVICARE_GOOGLE_MEET_ADDON_VERSION')) {
    define('KIVICARE_GOOGLE_MEET_ADDON_VERSION', '4.0.1');
}

if (!defined('KIVICARE_GOOGLE_MEET_REQUIRED_PLUGIN_VERSION')) {
    define('KIVICARE_GOOGLE_MEET_REQUIRED_PLUGIN_VERSION', '4.0.0');
}

// Activation hook
register_activation_hook(__FILE__, [\KCGMApp\baseClasses\KCGMActivate::class, 'activate']);

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
            deactivate_plugins(KIVICARE_GOOGLE_MEET_BASE_PATH);
            if (isset($_GET['activate']))
                unset($_GET['activate']);
            add_action('admin_notices', function () {
                ?>
                <div class="notice notice-error is-dismissible">
                    <p><?php _e('<strong>KiviCare Google Meet Telemed AddOn </strong> has been deactivated. It requires KiviCare Lite version 4.0.0 or higher.', 'kivicare-googlemeet-telemed-addon'); ?>
                    </p>
                </div>
                <?php
            });
            return;
        }
    }
    (new \KCGMApp\baseClasses\KCGMApp)->init();
}, 1);