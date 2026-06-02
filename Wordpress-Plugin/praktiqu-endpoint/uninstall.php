<?php
/**
 * Uninstall handler for PraktiQU Endpoint.
 *
 * Removes all plugin options. The service token (PRAKTIQU_SERVICE_TOKEN
 * constant in wp-config.php) is NOT removed — the user must clean that up
 * manually if they want to revoke access.
 *
 * Custom usermeta keys (`praktiqu_user_status`, `praktiqu_password_changed_at`)
 * are NOT removed — they are useful for clients who re-install the plugin.
 *
 * @package PraktiQU\Endpoint
 */

defined('WP_UNINSTALL_PLUGIN') || exit;

delete_option('praktiqu_endpoint_webhook_url');
delete_option('praktiqu_endpoint_webhook_secret');
delete_transient('praktiqu_endpoint_activation_notice');
