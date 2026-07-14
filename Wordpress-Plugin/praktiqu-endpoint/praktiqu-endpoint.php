<?php
/**
 * Plugin Name:       PraktiQU Endpoint
 * Plugin URI:        https://praktiqu.local/docs/wordpress-plugin
 * Description:       Multipurpose bridge plugin between the PraktiQU Next.js app (on Cloudflare) and WordPress (on shared hosting). Provides service-to-service REST endpoints for auth, identity, job scheduling, and scheduled background jobs via WooCommerce Action Scheduler.
 * Version:           1.1.0
 * Requires at least: 6.0
 * Requires PHP:      7.4
 * Author:            PraktiQU Team
 * License:           Proprietary
 * Text Domain:       praktiqu-endpoint
 * Domain Path:       /languages
 *
 * @package PraktiQU\Endpoint
 */

defined('ABSPATH') || exit;

define('PRAKTIQU_ENDPOINT_VERSION', '1.1.0');
define('PRAKTIQU_ENDPOINT_FILE', __FILE__);
define('PRAKTIQU_ENDPOINT_PATH', plugin_dir_path(__FILE__));
define('PRAKTIQU_ENDPOINT_URL', plugin_dir_url(__FILE__));
define('PRAKTIQU_ENDPOINT_REST_NAMESPACE', 'praktiqu/v1');

require_once PRAKTIQU_ENDPOINT_PATH . 'includes/class-praktiqu-endpoint-plugin.php';
require_once PRAKTIQU_ENDPOINT_PATH . 'includes/class-praktiqu-endpoint-service.php';
require_once PRAKTIQU_ENDPOINT_PATH . 'includes/class-praktiqu-endpoint-rest-controller.php';
require_once PRAKTIQU_ENDPOINT_PATH . 'includes/class-praktiqu-endpoint-hooks.php';
require_once PRAKTIQU_ENDPOINT_PATH . 'includes/class-praktiqu-endpoint-jobs.php';
require_once PRAKTIQU_ENDPOINT_PATH . 'includes/class-praktiqu-endpoint-payments.php';
require_once PRAKTIQU_ENDPOINT_PATH . 'includes/class-praktiqu-endpoint-settings.php';

/**
 * Boot the plugin.
 */
function praktiqu_endpoint_boot(): PraktiQU\Endpoint\Plugin {
    return PraktiQU\Endpoint\Plugin::instance();
}

// Boot on `plugins_loaded` so KiviCare (and any other plugin) has set up its roles first.
add_action('plugins_loaded', 'praktiqu_endpoint_boot');

// Activation: create default options, flush rewrite rules, register AS schedules.
register_activation_hook(__FILE__, static function (): void {
    PraktiQU\Endpoint\Plugin::on_activation();
});

// Deactivation: flush rewrite rules, unregister AS schedules.
register_deactivation_hook(__FILE__, static function (): void {
    PraktiQU\Endpoint\Plugin::on_deactivation();
});
