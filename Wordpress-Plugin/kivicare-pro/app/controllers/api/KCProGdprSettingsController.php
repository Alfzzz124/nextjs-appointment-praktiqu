<?php

namespace KCProApp\controllers\api;

use App\baseClasses\KCBaseController;
use App\models\KCOption;
use WP_REST_Request;
use WP_Error;

defined('ABSPATH') or die('Something went wrong');

class KCProGdprSettingsController extends KCBaseController
{
    protected $route = 'pro/gdpr-settings';

    public function registerRoutes()
    {
        $this->registerRoute('/' . $this->route, [
            'methods'             => 'GET',
            'callback'            => [$this, 'getSettings'],
            'permission_callback' => '__return_true',
        ]);

        $this->registerRoute('/' . $this->route, [
            'methods'             => 'PUT',
            'callback'            => [$this, 'updateSettings'],
            'permission_callback' => [$this, 'checkAdminPermission'],
        ]);
    }

    public function checkAdminPermission($request)
    {
        return current_user_can('manage_options');
    }

    public function getSettings(WP_REST_Request $request)
    {
        $settings = KCOption::get('gdpr_consent_settings', [
            'enable_gdpr'          => false,
            'consent_version'      => '1.0',
            'privacy_policy_url'   => '',
            'terms_of_service_url' => '',
            'mandatory_consents'   => [
                'privacy_policy'  => false,
                'data_processing' => false,
            ],
        ]);

        $auditSettings = KCOption::get('gdpr_audit_settings', [
            'audit_log_mode' => 'preview',
        ]);
        $settings['audit_log_mode'] = $auditSettings['audit_log_mode'] ?? 'preview';

        return $this->response(
            $settings,
            __('GDPR settings retrieved successfully', 'kivicare-pro')
        );
    }

    public function updateSettings(WP_REST_Request $request)
    {
        $params = $request->get_params();

        $settings = [
            'enable_gdpr'          => isset($params['enable_gdpr']) ? filter_var($params['enable_gdpr'], FILTER_VALIDATE_BOOLEAN) : false,
            'consent_version'      => sanitize_text_field($params['consent_version'] ?? '1.0'),
            'privacy_policy_url'   => esc_url_raw($params['privacy_policy_url'] ?? ''),
            'terms_of_service_url' => esc_url_raw($params['terms_of_service_url'] ?? ''),
            'mandatory_consents'   => [
                'privacy_policy'  => isset($params['mandatory_consents']['privacy_policy']) ? filter_var($params['mandatory_consents']['privacy_policy'], FILTER_VALIDATE_BOOLEAN) : false,
                'data_processing' => isset($params['mandatory_consents']['data_processing']) ? filter_var($params['mandatory_consents']['data_processing'], FILTER_VALIDATE_BOOLEAN) : false,
            ],
        ];

        if (isset($params['audit_log_mode'])) {
            KCOption::set('gdpr_audit_settings', [
                'audit_log_mode' => sanitize_text_field($params['audit_log_mode']),
            ]);
        }

        KCOption::set('gdpr_consent_settings', $settings);

        return $this->response(
            $settings,
            __('GDPR settings updated successfully', 'kivicare-pro')
        );
    }
}

