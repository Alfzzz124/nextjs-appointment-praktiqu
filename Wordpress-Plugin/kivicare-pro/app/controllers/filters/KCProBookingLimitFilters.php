<?php

namespace KCProApp\controllers\filters;

use App\models\KCOption;
use WP_REST_Request;
use WP_REST_Response;

defined('ABSPATH') || exit('Restricted access');

/**
 * Class KCProBookingLimitFilters
 * Handles booking limit manager settings and appointment booking limit checks.
 *
 * @package KCProApp\controllers\filters
 */
class KCProBookingLimitFilters
{
    private static ?KCProBookingLimitFilters $instance = null;

    public function __construct()
    {
        add_action('rest_api_init', [$this, 'registerRoutes']);
    }

    public static function get_instance(): KCProBookingLimitFilters|null
    {
        if (!isset(self::$instance)) {
            self::$instance = new self();
        }
        return self::$instance;
    }

    /**
     * Registers REST API routes for booking limit settings.
     */
    public function registerRoutes(): void
    {
        $namespace = KIVI_CARE_NAME . '/v1';
        $route     = 'settings/booking-limit-manager';

        register_rest_route($namespace, "/{$route}", [
            'methods'             => 'GET',
            'callback'            => [$this, 'getBookingLimitSetting'],
            'permission_callback' => [$this, 'checkPermission'],
        ]);

        register_rest_route($namespace, "/{$route}", [
            'methods'             => ['PUT', 'POST'],
            'callback'            => [$this, 'updateBookingLimitSetting'],
            'permission_callback' => [$this, 'checkUpdatePermission'],
        ]);
    }

    /**
     * Retrieves booking limit settings.
     */
    public function getBookingLimitSetting(WP_REST_Request $request): WP_REST_Response
    {
        if (!$this->checkPermission()) {
            return new WP_REST_Response(['status' => false, 'message' => esc_html__('Permission denied', 'kivicare-pro')], 403);
        }

        $response = KCOption::get('booking_limit_setting', []);

        if (!is_array($response)) {
            $response = [];
        }

        $response['customer_appointment_limit_enabled'] = in_array(
            (string) ($response['customer_appointment_limit_enabled'] ?? ''),
            ['true', '1'],
            true
        );

        return new WP_REST_Response([
            'status'  => true,
            'data'    => $response,
            'message' => __('Booking Limit setting retrieved successfully', 'kivicare-pro'),
        ], 200);
    }

    /**
     * Updates booking limit settings.
     */
    public function updateBookingLimitSetting(WP_REST_Request $request): WP_REST_Response
    {
        if (!$this->checkUpdatePermission()) {
            return new WP_REST_Response(['status' => false, 'message' => esc_html__('Permission denied', 'kivicare-pro')], 403);
        }

        $setting = $request->get_json_params();

        try {
            if (!empty($setting)) {
                // Get existing config to preserve capacity, duration, and interval when disabling
                $existingConfig = KCOption::get('booking_limit_setting');
                $existingData = is_array($existingConfig) ? $existingConfig : [];
                
                $config = [
                    'customer_appointment_limit_enabled' => (bool) ($setting['customer_appointment_limit_enabled'] ?? false),
                ];
                
                // Only update capacity, duration, and interval when enabling
                if ($config['customer_appointment_limit_enabled']) {
                    $config['allowed_capacity'] = absint($setting['allowed_capacity'] ?? 1);
                    $config['duration'] = absint($setting['duration'] ?? 1);
                    $config['interval'] = sanitize_text_field($setting['interval'] ?? 'hour');
                } else {
                    // When disabling, preserve existing values
                    $config['allowed_capacity'] = absint($existingData['allowed_capacity'] ?? 1);
                    $config['duration'] = absint($existingData['duration'] ?? 1);
                    $config['interval'] = sanitize_text_field($existingData['interval'] ?? 'hour');
                }

                KCOption::set('booking_limit_setting', $config);

                return new WP_REST_Response([
                    'status'  => true,
                    'message' => esc_html__('Booking Limit setting saved successfully', 'kivicare-pro'),
                ], 200);
            }

            return new WP_REST_Response([
                'status'  => false,
                'message' => esc_html__('Setting update failed', 'kivicare-pro'),
            ], 400);
        } catch (\Exception $e) {
            return new WP_REST_Response([
                'status'  => false,
                'message' => __('Failed to save Booking Limit settings.', 'kivicare-pro'),
                'error'   => $e->getMessage(),
            ], 500);
        }
    }

    /**
     * Permission check for read operations.
     */
    public function checkPermission(): bool
    {
        return current_user_can('manage_options') || current_user_can('kivicare_clinic_admin');
    }

    /**
     * Permission check for write operations.
     */
    public function checkUpdatePermission(): bool
    {
        return current_user_can('manage_options') || current_user_can('kivicare_clinic_admin');
    }
}
