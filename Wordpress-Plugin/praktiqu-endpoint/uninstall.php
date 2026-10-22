<?php
/**
 * Uninstall handler for PraktiQU Endpoint.
 *
 * Removes all plugin options, including every per-clinic
 * `praktiqu_endpoint_clinic_{id}_payment` row. The service token (PRAKTIQU_SERVICE_TOKEN
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
delete_option('praktiqu_endpoint_payment_webhook_url');
delete_option('praktiqu_endpoint_payment_webhook_secret');
delete_option('praktiqu_endpoint_jobs_webhook_url');
delete_option('praktiqu_endpoint_jobs_webhook_secret');
delete_option('praktiqu_endpoint_paypal_idr_rate');
delete_option('praktiqu_endpoint_paypal_idr_rate_updated');
delete_option('praktiqu_endpoint_paypal_markup_percent');
delete_option('praktiqu_endpoint_paypal_markup_percent_updated');
delete_option('praktiqu_outbox_sweep_registered');
delete_transient('praktiqu_endpoint_activation_notice');

// One praktiqu_endpoint_clinic_{id}_payment row per clinic (ClinicPaymentSettings). The
// names are collected with $wpdb and removed through delete_option() so an object cache
// drops them too. esc_like() escapes the underscores, which LIKE would otherwise treat as
// single-character wildcards.
global $wpdb;
$praktiqu_clinic_payment_options = $wpdb->get_col($wpdb->prepare(
    "SELECT option_name FROM {$wpdb->options} WHERE option_name LIKE %s",
    $wpdb->esc_like('praktiqu_endpoint_clinic_') . '%' . $wpdb->esc_like('_payment')
));
foreach ((array) $praktiqu_clinic_payment_options as $praktiqu_option_name) {
    delete_option((string) $praktiqu_option_name);
}
