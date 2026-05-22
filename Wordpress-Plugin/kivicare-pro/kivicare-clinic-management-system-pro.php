<?php

use KCProApp\baseClasses\KCPActivate;
use KCProApp\baseClasses\KCPApp;
/**
 * Plugin Name: KiviCare - Clinic & Patient Management System (EHR) Pro
 * Plugin URI: https://kivicare.io
 * Description: KiviCare Pro is an impressive clinic and patient management plugin (EHR).
 * Version: 4.4.0
 * Author: iqonic design
 * Text Domain: kivicare-pro
 * Domain Path: /languages
 * Author URI: https://iqonic.design
 * Requires Plugins: kivicare-clinic-management-system
 **/

defined( 'ABSPATH' ) or die( 'Something went wrong' );
// Require once the Composer Autoload
if ( file_exists( dirname( __FILE__ ) . '/vendor/autoload.php' ) ) {
	require_once dirname( __FILE__ ) . '/vendor/autoload.php';
} else {
	die( 'Something went wrong' );
}
if (!defined('KIVI_CARE_PRO_DIR'))
{
	define('KIVI_CARE_PRO_DIR', plugin_dir_path(__FILE__));
}
  
if (!defined('KIVI_CARE_PRO_DIR_URI'))
{
	define('KIVI_CARE_PRO_DIR_URI', plugin_dir_url(__FILE__));
}

if (!defined('KIVI_CARE_PRO_BASE_NAME'))
{
    define('KIVI_CARE_PRO_BASE_NAME', plugin_basename(__FILE__));
}

if (!defined('KIVI_CARE_PRO_NAMESPACE'))
{
	define('KIVI_CARE_PRO_NAMESPACE', "kivi-care-pro");
}

if (!defined('KIVI_CARE_PRO_PREFIX'))
{
	define('KIVI_CARE_PRO_PREFIX', "kiviCare_");
}

if (!defined('KIVI_CARE_PRO_VERSION'))
{
    define('KIVI_CARE_PRO_VERSION', "4.4.0");
}

if (!defined('KIVI_CARE_PRO_NAME'))
{
	define('KIVI_CARE_PRO_NAME', "kivicare_pro");
}
/**
 * The code that runs during plugin activation
 */
register_activation_hook( __FILE__, [ KCPActivate::class, 'activate'] );


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

        if (!$lite_active || version_compare($lite_version, '4.4.0', '<')) {
            deactivate_plugins(KIVI_CARE_PRO_BASE_NAME);
            if (isset($_GET['activate'])) unset($_GET['activate']);
            add_action('admin_notices', function () {
?>
                <div class="notice notice-error is-dismissible">
                    <p><?php _e('<strong>KiviCare Pro</strong> has been deactivated. It requires KiviCare Lite version 4.4.0 or higher.', 'kivicare-pro'); ?></p>
                </div>
<?php
            });
            return;
        }
    }
    (new KCPApp)->init();
}, 1);