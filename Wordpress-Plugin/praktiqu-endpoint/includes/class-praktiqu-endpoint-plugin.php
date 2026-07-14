<?php
/**
 * Main plugin class — owns lifecycle, wires services, exposes singleton.
 *
 * @package PraktiQU\Endpoint
 */

declare(strict_types=1);

namespace PraktiQU\Endpoint;

defined('ABSPATH') || exit;

final class Plugin
{
    private static ?Plugin $instance = null;

    public Service $service;
    public Payments $payments;
    public REST_Controller $rest;
    public Hooks $hooks;
    public Jobs $jobs;
    public Settings $settings;

    private function __construct()
    {
        $this->service  = new Service();
        $this->payments = new Payments();
        $this->jobs     = new Jobs($this->service, $this->payments);
        $this->rest     = new REST_Controller($this->service, $this->jobs, $this->payments);
        $this->hooks    = new Hooks($this->service);
        $this->settings = new Settings();

        // Wire each component's WordPress hooks. Runs on `plugins_loaded`
        // (via instance()), before `rest_api_init` / `admin_menu` fire, so the
        // REST routes, WP action listeners, admin settings page and AS job
        // handlers are all registered.
        $this->rest->register();
        $this->hooks->register();
        $this->jobs->register();
        $this->payments->register();
        $this->settings->register();
    }

    public static function instance(): Plugin
    {
        if (self::$instance === null) {
            self::$instance = new self();
        }
        return self::$instance;
    }

    public static function on_activation(): void
    {
        if (get_option('praktiqu_endpoint_webhook_url') === false) {
            add_option('praktiqu_endpoint_webhook_url', '');
        }
        if (get_option('praktiqu_endpoint_webhook_secret') === false) {
            add_option('praktiqu_endpoint_webhook_secret', '');
        }
        if (!self::service_token_configured()) {
            set_transient('praktiqu_endpoint_activation_notice', 'token_missing', 60);
        }

        // Register the daily log-purge recurring Action Scheduler job
        // (C8 architecture: jobs live in WordPress, run by AS).
        if (function_exists('as_schedule_recurring_action')) {
            if (!as_has_scheduled_action('praktiqu_log_purge', [], Jobs::GROUP)) {
                as_schedule_recurring_action(
                    time() + HOUR_IN_SECONDS, // first run in 1h
                    DAY_IN_SECONDS,           // every 24h
                    'praktiqu_log_purge',
                    [],
                    Jobs::GROUP
                );
            }
        }

        flush_rewrite_rules();
    }

    public static function on_deactivation(): void
    {
        if (function_exists('as_unschedule_all_actions')) {
            as_unschedule_all_actions('', [], Jobs::GROUP);
        }
        flush_rewrite_rules();
    }

    /**
     * Check whether the shared service token is configured in wp-config.php.
     */
    public static function service_token_configured(): bool
    {
        return defined('PRAKTIQU_SERVICE_TOKEN')
            && is_string(constant('PRAKTIQU_SERVICE_TOKEN'))
            && constant('PRAKTIQU_SERVICE_TOKEN') !== '';
    }

    /**
     * Validate the incoming service token from a REST request.
     */
    public static function verify_service_token(\WP_REST_Request $request): bool|\WP_Error
    {
        if (!self::service_token_configured()) {
            return new \WP_Error(
                'praktiqu_service_token_not_configured',
                __('PraktiQU service token is not configured.', 'praktiqu-endpoint'),
                ['status' => 503]
            );
        }

        $expected = (string) constant('PRAKTIQU_SERVICE_TOKEN');
        $provided = $request->get_header('x_praktiqu_service_token');

        if (!is_string($provided) || $provided === '') {
            return new \WP_Error(
                'praktiqu_service_token_missing',
                __('Missing X-PraktiQU-Service-Token header.', 'praktiqu-endpoint'),
                ['status' => 401]
            );
        }

        if (!hash_equals($expected, $provided)) {
            return new \WP_Error(
                'praktiqu_service_token_invalid',
                __('Invalid service token.', 'praktiqu-endpoint'),
                ['status' => 403]
            );
        }

        return true;
    }
}
