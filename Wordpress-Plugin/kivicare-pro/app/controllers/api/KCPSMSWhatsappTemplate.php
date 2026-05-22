<?php

namespace KCProApp\controllers\api;

use App\controllers\api\SettingsController;
use KCProApp\notifications\KCPNotificationSender;
use KCProApp\notifications\KCPNotificationTemplateManager;
use WP_REST_Request;
use WP_REST_Response;
use WP_Error;

defined('ABSPATH') or die('Something went wrong');

/**
 * Class SmsWhatsappTemplate
 * 
 * @package App\controllers\api\SettingsController
 */
class KCPSMSWhatsappTemplate extends SettingsController
{
    private static $instance = null;

    protected $route = '/settings/sms-whatsapp-template';


    public function __construct()
    {
        parent::__construct();
    }

    public static function getInstance(): self
    {
        if (self::$instance === null) {
            self::$instance = new self();
        }
        return self::$instance;
    }

    /**
     * Register routes for this controller
     */
    public function registerRoutes()
    {
        // Get Sms Whatsapp Template
        $this->registerRoute('/' . $this->route, [
            'methods' => 'GET',
            'callback' => [$this, 'getSmsWhatsappTemplate'],
            'permission_callback' => [$this, 'checkPermission'],
            'args' => $this->getSettingsEndpointArgs()
        ]);
        // Update Sms Whatsapp Template
        $this->registerRoute('/' . $this->route, [
            'methods' => ['PUT', 'POST'],
            'callback' => [$this, 'updateSmsWhatsappTemplate'],
            'permission_callback' => [$this, 'checkUpdatePermission'],
            'args'     => $this->getSettingFieldSchema()
        ]);
        // Update Sms Whatsapp Template
        $this->registerRoute('/' . $this->route . '/test', [
            'methods' => ['PUT', 'POST'],
            'callback' => [$this, 'testSmsWhatsappTemplate'],
            'permission_callback' => [$this, 'checkUpdatePermission'],
            'args'     => $this->getTestFormSchema()
        ]);
    }

    /**
     * Check if user has permission to access settings endpoints
     * 
     * @param \WP_REST_Request $request
     * @return bool
     */
    public function checkViewPermission()
    {
        if (!$this->checkCapability('read')) {
            return false;
        }

        if ($this->currentUserRole !== 'administrator') {
            return false;
        }

        return $this->checkResourceAccess('settings', 'view');
    }


    /**
     * Check if user has permission to update settings
     * 
     * @param \WP_REST_Request $request
     * @return bool
     */
    public function checkUpdatePermission($request): bool
    {
        if (!$this->checkCapability('read')) {
            return false;
        }

        if ($this->currentUserRole !== 'administrator') {
            return false;
        }

        return $this->checkResourceAccess('settings', 'edit');
    }

    public function getSettingFieldSchema()
    {
        return [
            'ID' => [
                'description' => 'Post ID',
                'type' => 'integer',
                'required' => true,
                'sanitize_callback' => 'kcSanitizeData',
                'validate_callback' => function ($value) {
                    return is_numeric($value);
                },
            ],
            'post_status' => [
                'description' => 'Post status',
                'type' => 'string',
                'required' => false,
                'sanitize_callback' => 'kcSanitizeData',
                'validate_callback' => function ($value) {
                    return in_array($value, ['publish', 'draft', 'pending', 'private'], true);
                },
            ],
            'content_sid' => [
                'description' => 'SMS subject/title',
                'type' => 'string',
                'required' => false,
                'sanitize_callback' => 'kcSanitizeData',
                'validate_callback' => function ($value) {
                    return is_string($value);
                },
            ],
            'post_content' => [
                'description' => 'SMS body content (may contain HTML and placeholders)',
                'type' => 'string',
                'required' => false,
                'validate_callback' => function ($value) {
                    return is_string($value);
                },
            ],
        ];
    }

    /**
     * Returns schema for validating test SMS/WhatsApp form data.
     *
     * @return array
     */
    public function getTestFormSchema()
    {
        return [
            'type' => [
                'required' => true,
                'type'     => 'string',
                'enum'     => ['sms', 'whatsapp'],
                'description' => __('Type of test message - either sms or whatsapp.', 'kivicare-pro'),
            ],
            'mobile' => [
                'required' => true,
                'type'     => 'string',
                'sanitize_callback' => 'sanitize_text_field',
                'validate_callback' => function ($value) {
                    return preg_match('/^[0-9+\-\s]{6,20}$/', $value);
                },
                'description' => __('Recipient mobile number.', 'kivicare-pro'),
            ],
            'content' => [
                'required' => true,
                'type'     => 'string',
                'sanitize_callback' => 'sanitize_textarea_field',
                'description' => __('Message content to be sent.', 'kivicare-pro'),
            ],
        ];
    }

    /**
     * Get SmsWhatsappTemplate settings
     * 
     * @param \WP_REST_Request $request
     * @return \WP_REST_Response
     */
    public function getSmsWhatsappTemplate(WP_REST_Request $request): WP_REST_Response
    {
        $request_data = $request->get_params();
        $sms_template_id = $request_data['id'] ?? null;
        $manager = new KCPNotificationTemplateManager();
        if ($sms_template_id) {
            $data = $manager->getTemplateWithKeysById($sms_template_id);
            return $this->response($data);
        }
        $data = [
            'data' =>  $manager->getTemplatesList('sms'),
            'labels' => [
                'patient' => __("Patient Templates", 'kivicare-pro'),
                'doctor' => __("Doctor Templates", 'kivicare-pro'),
                'clinic' => __("Clinic Templates", 'kivicare-pro'),
                'receptionist' => __("Receptionist Templates", 'kivicare-pro'),
                'common' => __("Common Templates", 'kivicare-pro'),
            ]
        ];
        return $this->response($data);
    }



    /**
     * Update SmsWhatsappTemplate settings
     * 
     * @param \WP_REST_Request $request
     * @return \WP_REST_Response
     */
    public function updateSmsWhatsappTemplate(WP_REST_Request $request): WP_REST_Response
    {
        try {
            $request_data = $request->get_json_params() ?? [];
            if (isset($request_data['ID']) && !empty($request_data['ID'])) {
                wp_update_post($request_data);
                update_post_meta($request_data['ID'], 'content_sid', $request_data['content_sid'] ?? '');
                return $this->response(null, esc_html__('SMS template saved successfully.', 'kivicare-pro'));
            } else {
                return $this->response(null, esc_html__('Failed to update template.', 'kivicare-pro'), false);
            }
        } catch (\Exception $e) {
            return $this->response(
                ['error' => $e->getMessage()],
                __('Failed to update settings', 'kivicare-pro'),
                false,
                500
            );
        }
    }

    public function testSmsWhatsappTemplate(WP_REST_Request $request): WP_REST_Response
    {
        try {
            $request_data = $request->get_json_params() ?? [];
            $type = $request_data['type'] ?? '';
            $mobile = $request_data['mobile'] ?? '';
            $content = $request_data['content'] ?? '';

            if (empty($type) || empty($mobile) || empty($content)) {
                return $this->response(null, __('All fields are required.', 'kivicare-pro'), false);
            }

            $result = (new KCPNotificationSender())->testNotificationConfiguration($mobile, $content, [], [
                'twilio_channel' => $type,
            ]);
            if (!$result) {
                return $this->response(null, __('Failed to send test message.', 'kivicare-pro'), false);
            }
            return $this->response(null, __('Test message sent successfully.', 'kivicare-pro'));
        } catch (\Exception $e) {
            return $this->response(
                ['error' => $e->getMessage()],
                __('Failed to send test message', 'kivicare-pro'),
                false,
                500
            );
        }
    }
}
