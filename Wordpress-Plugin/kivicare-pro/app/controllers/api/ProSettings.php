<?php

// namespace App\controllers\api\SettingsController;

namespace KCProApp\controllers\api;

use App\controllers\api\SettingsController;
use App\models\KCOption;
use KCProApp\controllers\api\GoogleCalendarIntegration;
use App\models\KCUserMeta;
use Error;
use WP_REST_Request;
use WP_REST_Response;
use WP_Error;
use App\baseClasses\KCBase;
use App\baseClasses\KCErrorLogger;
use App\controllers\api\SettingsController\GoogleEventTemplate;

defined('ABSPATH') or die('Something went wrong');

/**
 * Class ProSettings
 * 
 * @package App\controllers\api\SettingsController
 */
class ProSettings extends SettingsController
{
    private static $instance = null;
    protected $route = 'settings/pro-settings';

    private $request_data = [];
    public $filter_not_found_message;
    public $currentUserRole = null;
    public function __construct()
    {
        parent::__construct();

        if (isKiviCareProActive()) {
            $this->filter_not_found_message = esc_html__("Please update kivicare pro plugin", "kivicare-pro");
        } else {
            $this->filter_not_found_message = esc_html__("Please install kivicare pro plugin", "kivicare-pro");
        }
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
        // Get Pro Settings
        $this->registerRoute('/' . $this->route, [
            'methods'             => 'GET',
            'callback'            => [$this, 'getProSettings'],
            'permission_callback' => [$this, 'checkPermission'],
        ]);

        $this->registerRoute('/' . $this->route, [
            'methods'             => ['PUT', 'POST'],
            'callback'            => [$this, 'updateProSettings'],
            'permission_callback' => [$this, 'checkUpdatePermission'],
            'args'                => $this->getUpdateProSettingsArgs(),
        ]);

        $this->registerRoute('/' . $this->route . '/google-cal-sync', [
            'methods'             => 'GET',
            'callback'            => [$this, 'getGoogleCalSyncSetting'],
            'permission_callback' => [$this, 'checkGoogleSyncPermission'],
        ]);

        $this->registerRoute('/' . $this->route . '/google-cal-sync', [
            'methods'             => ['PUT', 'POST'],
            'callback'            => [$this, 'updateGoogleCalSyncSetting'],
            'permission_callback' => [$this, 'checkGoogleSyncPermission'], // Allow doctors to save their own user meta
        ]);

        $this->registerRoute('/' . $this->route . '/google-cal/disconnect-all-doctors', [
            'methods'             => 'POST',
            'callback'            => [$this, 'disconnectAllDoctors'],
            'permission_callback' => [$this, 'checkAdminPermission'],
        ]);

        $this->registerRoute('/' . $this->route . '/fonts', [
            'methods'             => 'GET',
            'callback'            => [$this, 'getFonts'],
            'permission_callback' => [$this, 'checkPermission'],
        ]);
    }

    /**
     * Get arguments for the update pro settings endpoint
     *
     * @return array
     */
    private function getUpdateProSettingsArgs()
    {
        $args = [
            'twilioSms' => [
                'description' => 'Twilio SMS configuration',
                'type' => 'object',
                'properties' => [
                    'account_id' => [
                        'type' => ['integer', 'string'],
                        'sanitize_callback' => function($value) {
                            return $value === '' ? '' : (is_numeric($value) ? absint($value) : sanitize_text_field($value));
                        },
                    ],
                    'auth_token' => [
                        'type' => 'string',
                        'sanitize_callback' => 'sanitize_text_field',
                    ],
                    'to_number' => [
                        'type' => 'string',
                        'sanitize_callback' => 'sanitize_text_field',
                    ],
                    'enableSMS' => [
                        'type' => 'boolean',
                        'sanitize_callback' => 'rest_sanitize_boolean',
                    ],
                ],
            ],
            'twilioWhatsApp' => [
                'description' => 'Twilio WhatsApp configuration',
                'type' => 'object',
                'properties' => [
                    'account_id' => [
                        'type' => ['integer', 'string'],
                        'sanitize_callback' => function($value) {
                            return $value === '' ? '' : (is_numeric($value) ? absint($value) : sanitize_text_field($value));
                        },
                    ],
                    'auth_token' => [
                        'type' => 'string',
                        'sanitize_callback' => 'sanitize_text_field',
                    ],
                    'to_number' => [
                        'type' => 'string',
                        'sanitize_callback' => 'sanitize_text_field',
                    ],
                    'enableWhatsApp' => [
                        'type' => 'boolean',
                        'sanitize_callback' => 'rest_sanitize_boolean',
                    ],
                ],
            ],
            'googleAccount' => [
                'description' => 'Google Calendar configuration',
                'type' => 'object',
                'properties' => [
                    'client_id' => [
                        'type' => ['integer', 'string'],
                        'sanitize_callback' => function($value) {
                            return $value === '' ? '' : (is_numeric($value) ? absint($value) : sanitize_text_field($value));
                        },
                    ],
                    'client_secret' => [
                        'type' => 'string',
                        'sanitize_callback' => 'sanitize_text_field',
                    ],
                    'app_name' => [
                        'type' => 'string',
                        'sanitize_callback' => 'sanitize_text_field',
                    ],
                    'enableCal' => [
                        'type' => 'boolean',
                        'sanitize_callback' => 'rest_sanitize_boolean',
                    ],
                    'enableTwoWaySync' => [
                        'type' => 'boolean',
                        'sanitize_callback' => 'rest_sanitize_boolean',
                    ],
                ],
            ],
            'status_colors' => [
                'description' => 'Google Calendar event status colors',
                'type' => 'object',
                'sanitize_callback' => function($value) {
                    if (!is_array($value)) return [];
                    $sanitized = [];
                    foreach ($value as $key => $val) {
                        $sanitized[sanitize_key($key)] = sanitize_text_field($val);
                    }
                    return $sanitized;
                },
            ],
            'copyrightText' => [
                'description' => 'Copyright text',
                'type' => 'string',
                'sanitize_callback' => 'sanitize_textarea_field',
            ],
            'AdminSlug' => [
                'description' => 'Admin dashboard slug',
                'type' => 'string',
                'sanitize_callback' => [$this, 'sanitizeSlug'],
            ],
            'clinicAdminSlug' => [
                'description' => 'Clinic Admin dashboard slug',
                'type' => 'string',
                'sanitize_callback' => [$this, 'sanitizeSlug'],
            ],
            'doctorSlug' => [
                'description' => 'Doctor dashboard slug',
                'type' => 'string',
                'sanitize_callback' => [$this, 'sanitizeSlug'],
            ],
            'receptionistSlug' => [
                'description' => 'Receptionist dashboard slug',
                'type' => 'string',
                'sanitize_callback' => [$this, 'sanitizeSlug'],
            ],
            'patientSlug' => [
                'description' => 'Patient dashboard slug',
                'type' => 'string',
                'sanitize_callback' => [$this, 'sanitizeSlug'],
            ],
            'primaryColor' => [
                'description' => 'Primary color',
                'type' => 'string',
                'sanitize_callback' => 'sanitize_hex_color',
            ],
            'secondaryColor' => [
                'description' => 'Secondary color',
                'type' => 'string',
                'sanitize_callback' => 'sanitize_hex_color',
            ],
            'successColor' => [
                'description' => 'Success color',
                'type' => 'string',
                'sanitize_callback' => 'sanitize_hex_color',
            ],
            'warningColor' => [
                'description' => 'Warning color',
                'type' => 'string',
                'sanitize_callback' => 'sanitize_hex_color',
            ],
            'dangerColor' => [
                'description' => 'Danger color',
                'type' => 'string',
                'sanitize_callback' => 'sanitize_hex_color',
            ],
            'infoColor' => [
                'description' => 'Info color',
                'type' => 'string',
                'sanitize_callback' => 'sanitize_hex_color',
            ],
            'bodyBg' => [
                'description' => 'Body background color',
                'type' => 'string',
                'sanitize_callback' => 'sanitize_hex_color',
            ],
            'bodyColor' => [
                'description' => 'Body text color',
                'type' => 'string',
                'sanitize_callback' => 'sanitize_hex_color',
            ],
            'borderColor' => [
                'description' => 'Border color',
                'type' => 'string',
                'sanitize_callback' => 'sanitize_hex_color',
            ],
            'headingColor' => [
                'description' => 'Heading color',
                'type' => 'string',
                'sanitize_callback' => 'sanitize_hex_color',
            ],
            'cardColor' => [
                'description' => 'Card color',
                'type' => 'string',
                'sanitize_callback' => 'sanitize_hex_color',
            ],
            'darkPrimaryColor' => [
                'description' => 'Dark Primary color',
                'type' => 'string',
                'sanitize_callback' => 'sanitize_hex_color',
            ],
            'darkSecondaryColor' => [
                'description' => 'Dark Secondary color',
                'type' => 'string',
                'sanitize_callback' => 'sanitize_hex_color',
            ],
            'darkSuccessColor' => [
                'description' => 'Dark Success color',
                'type' => 'string',
                'sanitize_callback' => 'sanitize_hex_color',
            ],
            'darkWarningColor' => [
                'description' => 'Dark Warning color',
                'type' => 'string',
                'sanitize_callback' => 'sanitize_hex_color',
            ],
            'darkDangerColor' => [
                'description' => 'Dark Danger color',
                'type' => 'string',
                'sanitize_callback' => 'sanitize_hex_color',
            ],
            'darkInfoColor' => [
                'description' => 'Dark Info color',
                'type' => 'string',
                'sanitize_callback' => 'sanitize_hex_color',
            ],
            'darkBodyBg' => [
                'description' => 'Dark Body background color',
                'type' => 'string',
                'sanitize_callback' => 'sanitize_hex_color',
            ],
            'darkBodyColor' => [
                'description' => 'Dark Body text color',
                'type' => 'string',
                'sanitize_callback' => 'sanitize_hex_color',
            ],
            'darkBorderColor' => [
                'description' => 'Dark Border color',
                'type' => 'string',
                'sanitize_callback' => 'sanitize_hex_color',
            ],
            'darkHeadingColor' => [
                'description' => 'Dark Heading color',
                'type' => 'string',
                'sanitize_callback' => 'sanitize_hex_color',
            ],
            'darkCardColor' => [
                'description' => 'Dark Card color',
                'type' => 'string',
                'sanitize_callback' => 'sanitize_hex_color',
            ],
            'site_logo' => [
                'description' => 'Site logo attachment ID',
                'type' => 'integer',
                'validate_callback' => function($param) {
                    if (!empty($param) && (!is_numeric($param) || $param <= 0)) {
                        return new \WP_Error('invalid_logo_id', __('Invalid logo ID', 'kivicare-pro'));
                    }
                    return true;
                },
                'sanitize_callback' => 'absint',
            ],
            'wordpressLogo' => [
                'description' => 'WordPress logo attachment ID',
                'type' => 'integer',
                'validate_callback' => function($param) {
                    if (!empty($param) && (!is_numeric($param) || $param <= 0)) {
                        return new \WP_Error('invalid_wp_logo_id', __('Invalid WordPress logo ID', 'kivicare-pro'));
                    }
                    return true;
                },
                'sanitize_callback' => 'absint',
            ],
            'dark_site_logo' => [
                'description' => 'Dark Site logo attachment ID',
                'type' => 'integer',
                'validate_callback' => function($param) {
                    if (!empty($param) && (!is_numeric($param) || $param <= 0)) {
                        return new \WP_Error('invalid_logo_id', __('Invalid logo ID', 'kivicare-pro'));
                    }
                    return true;
                },
                'sanitize_callback' => 'absint',
            ],
            'dark_site_mini_logo' => [
                'description' => 'Dark Site mini logo attachment ID',
                'type' => 'integer',
                'validate_callback' => function($param) {
                    if (!empty($param) && (!is_numeric($param) || $param <= 0)) {
                        return new \WP_Error('invalid_logo_id', __('Invalid logo ID', 'kivicare-pro'));
                    }
                    return true;
                },
                'sanitize_callback' => 'absint',
            ],
            'darkMode' => [
                'description' => 'Dark mode',
                'type' => 'boolean',
                'sanitize_callback' => 'rest_sanitize_boolean',
            ],
            'titleFont' => [
                'description' => 'Title font family',
                'type' => 'string',
                'sanitize_callback' => 'sanitize_text_field',
            ],
            'bodyFont' => [
                'description' => 'Body font family',
                'type' => 'string',
                'sanitize_callback' => 'sanitize_text_field',
            ],
        ];
        return $args;
    }
    /**
     * Get ProSettings settings
     * 
     * @param \WP_REST_Request $request
     * @return \WP_REST_Response
     */
    public function getProSettings(WP_REST_Request $request): WP_REST_Response
    {
        // Bulk get keys (unprefixed)
        $optionKeys = [
            'wordpress_logo',
            'wordpress_logo_status',
            'site_logo',
            'site_mini_logo',
            'dark_site_logo',
            'dark_site_mini_logo',
            'theme_mode',
            'dark_mode',
            'theme_color',
            'primary_color',
            'secondary_color',
            'success_color',
            'warning_color',
            'danger_color',
            'info_color',
            'body_bg',
            'body_color',
            'border_color',
            'heading_color',
            'card_color',
            'dark_primary_color',
            'dark_secondary_color',
            'dark_success_color',
            'dark_warning_color',
            'dark_danger_color',
            'dark_info_color',
            'dark_body_bg',
            'dark_body_color',
            'dark_border_color',
            'dark_heading_color',
            'dark_card_color',
            'patient_cal_setting',
            'copyrightText',
            'custom_notification_sms_setting',
            'custom_notification_whatsapp_setting',
            'include_clinical_detail_in_print',
            'include_encounter_custom_field_in_print',
            'hide_clinical_detail_in_patient',
            // Dashboard slug options (role-wise)
            'dashboard_slug_admin',
            'dashboard_slug_clinic_admin',
            'dashboard_slug_doctor',
            'dashboard_slug_receptionist',
            'dashboard_slug_patient',
            'gcal_status_colors',
            'title_font',
            'body_font',
        ];

        $options = KCOption::getMultiple($optionKeys);

        // Prepare WordPress logo URL and status
        $wp_logo_id = $options['wordpress_logo'] ?? '';
        $wp_logo_status = $options['wordpress_logo_status'] ?? 'off';
        $wp_logo_url = !empty(wp_get_attachment_url($wp_logo_id)) ? wp_get_attachment_url($wp_logo_id) : (KIVI_CARE_DIR_URI . 'assets/images/wp-logo.png');

        $response = [];

        $site_logo_id = $options['site_logo'] ?? '';
        $response['site_logo'] = [
            'id'  => $site_logo_id,
            'url' => !empty(wp_get_attachment_url($site_logo_id)) ? wp_get_attachment_url($site_logo_id) : KIVI_CARE_DIR_URI . 'assets/images/logo.png',
        ];
        $site_mini_logo_id = $options['site_mini_logo'] ?? '';
        $response['site_mini_logo'] = [
            'id'  => $site_mini_logo_id,
            'url' => !empty(wp_get_attachment_url($site_mini_logo_id)) ? wp_get_attachment_url($site_mini_logo_id) : KIVI_CARE_DIR_URI . 'assets/images/logo-mini.png',
        ];
        $dark_site_logo_id = $options['dark_site_logo'] ?? '';
        $response['dark_site_logo'] = [
            'id'  => $dark_site_logo_id,
            'url' => !empty(wp_get_attachment_url($dark_site_logo_id)) ? wp_get_attachment_url($dark_site_logo_id) : KIVI_CARE_DIR_URI . 'assets/images/logo.png',
        ];
        $dark_site_mini_logo_id = $options['dark_site_mini_logo'] ?? '';
        $response['dark_site_mini_logo'] = [
            'id'  => $dark_site_mini_logo_id,
            'url' => !empty(wp_get_attachment_url($dark_site_mini_logo_id)) ? wp_get_attachment_url($dark_site_mini_logo_id) : KIVI_CARE_DIR_URI . 'assets/images/logo-mini.png',
        ];
        $response['rtl'] = $options['theme_mode'] ?? '';
        $response['darkMode'] = ($options['dark_mode'] ?? 'false') === 'true';
        $response['themeColor'] = $options['theme_color'] ?? '';
        $response['primaryColor'] = $options['primary_color'] ?? '#5670CC';
        $response['secondaryColor'] = $options['secondary_color'] ?? '#f68685';
        $response['successColor'] = $options['success_color'] ?? '#219653';
        $response['warningColor'] = $options['warning_color'] ?? '#FAA100';
        $response['dangerColor'] = $options['danger_color'] ?? '#F54438';
        $response['infoColor'] = $options['info_color'] ?? '#007EA7';
        $response['bodyBg'] = $options['body_bg'] ?? '#f5f6fa';
        $response['bodyColor'] = $options['body_color'] ?? '#828A90';
        $response['borderColor'] = $options['border_color'] ?? '#dbdfe7';
        $response['headingColor'] = $options['heading_color'] ?? '#3F414D';
        $response['cardColor'] = $options['card_color'] ?? '#ffffff';
        $response['darkPrimaryColor'] = $options['dark_primary_color'] ?? '#5670CC';
        $response['darkSecondaryColor'] = $options['dark_secondary_color'] ?? '#f68685';
        $response['darkSuccessColor'] = $options['dark_success_color'] ?? '#219653';
        $response['darkWarningColor'] = $options['dark_warning_color'] ?? '#FAA100';
        $response['darkDangerColor'] = $options['dark_danger_color'] ?? '#F54438';
        $response['darkInfoColor'] = $options['dark_info_color'] ?? '#007EA7';
        $response['darkBodyBg'] = $options['dark_body_bg'] ?? '#1e2023';
        $response['darkBodyColor'] = $options['dark_body_color'] ?? '#828A90';
        $response['darkBorderColor'] = $options['dark_border_color'] ?? '#303030';
        $response['darkHeadingColor'] = $options['dark_heading_color'] ?? '#d6dce2';
        $response['darkCardColor'] = $options['dark_card_color'] ?? '#252934';
        $response['patientCalendarEvent'] = $options['patient_cal_setting'] ?? 'no';
        $response['copyrightText'] = $options['copyrightText'] ?? 'Â© KiviCare - Clinic and Patient Management System (EHR)';

        // Add WordPress logo info
        $response['wordpressLogo'] = [
            'id'  => $wp_logo_id,
            'url' => $wp_logo_url,
        ];
        $response['wordpressLogoStatus'] = ($wp_logo_status === 'on') ? 1 : 0;

        $response['enabledCustomizableSms'] = $options['custom_notification_sms_setting'] ?? 'no';
        $response['enabledCustomizableWhatsApp'] = $options['custom_notification_whatsapp_setting'] ?? 'no';

        // SMS and WhatsApp config data (JSON decoded inside KCOption::get)
        $smsConfigData = get_option('sms_config_data', []);
        if (is_string($smsConfigData)) {
            $smsConfigData = json_decode($smsConfigData, true) ?: [];
        }
        $enableSMS = $smsConfigData['enableSMS'] ?? 'false';
        $response['enableTwilioSms'] = ($enableSMS === 'true' || $enableSMS === true) ? 'true' : 'false';
        $response['twilioSmsAuthToken'] = $smsConfigData['auth_token'] ?? '';
        $response['twilioSmsAccountSID'] = $smsConfigData['account_id'] ?? '';
        $response['twilioSmsPhoneNumber'] = $smsConfigData['to_number'] ?? '';

        $WhatsAppConfigData = get_option('whatsapp_config_data', []);
        if (is_string($WhatsAppConfigData)) {
            $WhatsAppConfigData = json_decode($WhatsAppConfigData, true) ?: [];
        }
        $enableWhatsApp = $WhatsAppConfigData['enableWhatsApp'] ?? 'false';
        $response['enableTwilioWhatsApp'] = ($enableWhatsApp === 'true' || $enableWhatsApp === true) ? 'true' : 'false';
        $response['twilioWhatsAppAccountSID'] = $WhatsAppConfigData['wa_account_id'] ?? '';
        $response['twilioWhatsAppAuthToken'] = $WhatsAppConfigData['wa_auth_token'] ?? '';
        $response['twilioWhatsAppPhoneNumber'] = $WhatsAppConfigData['wa_to_number'] ?? '';

        // Google calendar config
        $googlecalData = KCOption::get('google_cal_setting', []);
        if (is_string($googlecalData)) {
            $googlecalData = json_decode($googlecalData, true) ?: [];
        }
        $response['googleCalendarConfiguration'] = !empty($googlecalData['enableCal']) ? 'yes' : 'no';
        $response['googleCalendarTwoWaySync'] = !empty($googlecalData['enableTwoWaySync']) ? 'yes' : 'no';
        $response['googleCalendarClientId'] = $googlecalData['client_id'] ?? '';
        $response['googleCalendarClientSecret'] = $googlecalData['client_secret'] ?? '';
        $response['appName'] = $googlecalData['app_name'] ?? '';
        
        // Google Calendar Redirection URL
        $redirect_uri = rest_url('kivicare/v1/settings/google-calendar-integration/callback');
        $response['googleCalendarRedirectionUrl'] = $redirect_uri;

        // Boolean flags - convert 'true'/'false' strings to boolean
        $response['clinicEncounterPrint'] = ($options['include_clinical_detail_in_print'] ?? 'false') === 'true';
        $response['doctorEncounterPrint'] = ($options['include_encounter_custom_field_in_print'] ?? 'false') === 'true';
        $response['hideEncounterClinicalDetails'] = ($options['hide_clinical_detail_in_patient'] ?? 'false') === 'true';

        // Dashboard slugs (role-wise)
        $response['AdminSlug']   = $options['dashboard_slug_admin'] ?? '';
        $response['clinicAdminSlug']   = $options['dashboard_slug_clinic_admin'] ?? '';
        $response['doctorSlug']        = $options['dashboard_slug_doctor'] ?? '';
        $response['receptionistSlug']  = $options['dashboard_slug_receptionist'] ?? '';
        $response['patientSlug']       = $options['dashboard_slug_patient'] ?? '';
        
        // Google status colors
        $default_colors = GoogleEventTemplate::getDefaultGcalStatusColors();
        $response['status_colors']         = $options['gcal_status_colors'] ?? $default_colors;
        $response['default_status_colors'] = $default_colors;
        $response['color_options']         = GoogleEventTemplate::getGcalColorOptions();

        $response['titleFont'] = $options['title_font'] ?? 'Inter';
        $response['bodyFont'] = $options['body_font'] ?? 'Inter';

        // Replace null with empty string
        array_walk($response, function (&$value) {
            if (is_null($value)) {
                $value = '';
            }
        });

        return new WP_REST_Response($response);
    }

    public function updateProSettings(WP_REST_Request $request): WP_REST_Response
    {
        try {
            $this->request_data = $request->get_json_params() ?? [];

            $data = [
                'upload_logo'                           => $this->uploadLogo(),
                'upload_mini_logo'                      => $this->uploadMiniLogo(),
                'update_theme_color'                    => $this->updateThemeColor(),
                'update_colors'                         => $this->updateColors(),
                'save_generated_colors'                 => $this->saveGeneratedColors(),
                'update_theme_rtl'                      => $this->updateRTLMode(),
                'update_dark_mode'                      => $this->updateDarkMode(),
                'save_wordpress_logo'                   => $this->wordpresLogo(),
                'save_custom_notification_setting'      => $this->saveCustomNotificationSetting(),
                'sms_config_save'                       => $this->saveSmsConfig(),
                'whatsapp_config_save'                  => $this->saveWhatsAppConfig(),
                'google_calender_config'                => $this->saveGoogleCalSetting(),
                'save_patient_google_cal'               => $this->googleCalPatient(),
                'edit_clinical_detail_include'          => $this->editClinicalDetailInclude(),
                'edit_encounter_custom_field_include'   => $this->editEncounterCustomFieldInclude(),
                'edit_clinical_detail_hide_in_patient'  => $this->editClinicalDetailHideInPatient(),
                'save_copy_right_text'                  => $this->saveCopyRightText(),
                'save_dashboard_slugs'                  => $this->saveDashboardSlugs(),
                'save_google_status_colors'             => $this->saveGoogleStatusColors(),
                'update_fonts'                          => $this->updateFonts(),
            ];

            return $this->response($data, esc_html__('Pro Settings updated successfully', 'kivicare-pro'), true);
        } catch (\Exception $e) {
            return $this->response(['error' => $e->getMessage()], __('Failed to update settings.', 'kivicare-pro'), false, 500);
        }
    }

    /**
     * Save role-wise dashboard slugs
     */
    public function saveDashboardSlugs()
    {
        $request_data = $this->request_data;

        $map = [
            'AdminSlug'        => 'dashboard_slug_admin',
            'clinicAdminSlug'  => 'dashboard_slug_clinic_admin',
            'doctorSlug'       => 'dashboard_slug_doctor',
            'receptionistSlug' => 'dashboard_slug_receptionist',
            'patientSlug'      => 'dashboard_slug_patient',
        ];

        $saved = [];
        foreach ($map as $inputKey => $optionKey) {
            if (array_key_exists($inputKey, $request_data)) {
                $raw  = (string)($request_data[$inputKey] ?? '');
                $slug = $this->sanitizeSlug($raw);
                KCOption::set($optionKey, $slug);
                $saved[$inputKey] = $slug;
            }
        }
        // After saving slugs, flush rewrite rules to update permalinks
        if (function_exists('flush_rewrite_rules')) {
            KCErrorLogger::instance()->error('Flushing rewrite rules after saving dashboard slugs');
            flush_rewrite_rules();
        }
        return [
            'status'  => true,
            'message' => __('Dashboard slugs saved', 'kivicare-pro'),
            'data'    => $saved,
        ];
    }

    /**
     * Normalize slug: lowercase, hyphenated, no spaces/special chars
     */
    public function sanitizeSlug($value)
    {
        $value = is_string($value) ? $value : '';
        // Convert to lowercase
        $value = strtolower($value);
        // Replace whitespace with hyphens
        $value = preg_replace('/\s+/', '-', $value);
        // Allow only a-z, 0-9 and hyphens
        $value = preg_replace('/[^a-z0-9-]/', '', $value);
        // Collapse multiple hyphens
        $value = preg_replace('/-+/', '-', $value);
        return $value;
    }

    public function uploadLogo()
    {
        $request_data = $this->request_data;
        $response_data = [];
        $status = false;
        try {
            if (isset($request_data['site_logo'])) {
                KCOption::set('site_logo', $request_data['site_logo']);
                $response_data['site_logo'] = wp_get_attachment_url($request_data['site_logo']);
                $status = true;
            }
            if (isset($request_data['dark_site_logo'])) {
                KCOption::set('dark_site_logo', $request_data['dark_site_logo']);
                $response_data['dark_site_logo'] = wp_get_attachment_url($request_data['dark_site_logo']);
                $status = true;
            }

            if ($status) {
                return [
                    'data'    => $response_data,
                    'status'  => true,
                    'message' => esc_html__('Theme logo updated', 'kiviCare-clinic-&-patient-management-system-pro'),
                ];
            }
        } catch (\Exception $e) {
            return [
                'status'  => false,
                'message' => esc_html__('Failed to update theme logo', 'kiviCare-clinic-&-patient-management-system-pro'),
            ];
        }
    }

    public function uploadMiniLogo()
    {
        $request_data = $this->request_data;
        $response_data = [];
        $status = false;
        try {
            if (isset($request_data['site_mini_logo'])) {
                KCOption::set('site_mini_logo', $request_data['site_mini_logo']);
                $response_data['site_mini_logo'] = wp_get_attachment_url($request_data['site_mini_logo']);
                $status = true;
            }
            if (isset($request_data['dark_site_mini_logo'])) {
                KCOption::set('dark_site_mini_logo', $request_data['dark_site_mini_logo']);
                $response_data['dark_site_mini_logo'] = wp_get_attachment_url($request_data['dark_site_mini_logo']);
                $status = true;
            }

            if ($status) {
                return [
                    'data'    => $response_data,
                    'status'  => true,
                    'message' => esc_html__('Theme Mini logo updated', 'kiviCare-clinic-&-patient-management-system-pro'),
                ];
            }
        } catch (\Exception $e) {
            return [
                'status'  => false,
                'message' => esc_html__('Failed to update theme Mini logo', 'kiviCare-clinic-&-patient-management-system-pro'),
            ];
        }
    }

    public function updateThemeColor()
    {
        $request_data = $this->request_data;
        try {
            if (isset($request_data['themeColor'])) {
                KCOption::set('theme_color', $request_data['themeColor']);
                $data = KCOption::get('theme_color');
                return [
                    'data'    => $data,
                    'status'  => true,
                    'message' => esc_html__('Theme Color updated', 'kiviCare-clinic-&-patient-management-system-pro'),
                ];
            }
        } catch (\Exception $e) {
            return [
                'status'  => false,
                'message' => esc_html__('Theme Color not updated', 'kiviCare-clinic-&-patient-management-system-pro'),
            ];
        }
    }

    public function updateColors()
    {
        $request_data = $this->request_data;
        $colorMap = [
            'primaryColor'   => 'primary_color',
            'secondaryColor' => 'secondary_color',
            'successColor'   => 'success_color',
            'warningColor'   => 'warning_color',
            'dangerColor'    => 'danger_color',
            'infoColor'      => 'info_color',
            'bodyBg'         => 'body_bg',
            'bodyColor'      => 'body_color',
            'borderColor'    => 'border_color',
            'headingColor'   => 'heading_color',
            'cardColor'      => 'card_color',
            'darkPrimaryColor'   => 'dark_primary_color',
            'darkSecondaryColor' => 'dark_secondary_color',
            'darkSuccessColor'   => 'dark_success_color',
            'darkWarningColor'   => 'dark_warning_color',
            'darkDangerColor'    => 'dark_danger_color',
            'darkInfoColor'      => 'dark_info_color',
            'darkBodyBg'         => 'dark_body_bg',
            'darkBodyColor'      => 'dark_body_color',
            'darkBorderColor'    => 'dark_border_color',
            'darkHeadingColor'   => 'dark_heading_color',
            'darkCardColor'      => 'dark_card_color',
        ];

        $updated = [];
        try {
            foreach ($colorMap as $requestKey => $optionKey) {
                if (isset($request_data[$requestKey])) {
                    KCOption::set($optionKey, $request_data[$requestKey]);
                    $updated[] = $requestKey;
                }
            }
            return [
                'status'  => true,
                'message' => esc_html__('Colors updated successfully', 'kiviCare-clinic-&-patient-management-system-pro'),
                'data'    => $updated,
            ];
        } catch (\Exception $e) {
            return [
                'status'  => false,
                'message' => esc_html__('Failed to update colors', 'kiviCare-clinic-&-patient-management-system-pro'),
            ];
        }
    }

    public function updateRTLMode()
    {
        $request_data = $this->request_data;
        $rtl = $request_data['rtl'] ?? '';
        if ($rtl === '1' || $rtl === true || $rtl === 'true' || $rtl === 1) {
            KCOption::set('theme_mode', 'true');
        } else {
            KCOption::set('theme_mode', 'false');
        }
        $data = KCOption::get('theme_mode');

        return [
            'data'    => $data,
            'status'  => true,
            'message' => esc_html__('Theme mode updated', 'kiviCare-clinic-&-patient-management-system-pro'),
        ];
    }

    public function updateDarkMode()
    {
        $request_data = $this->request_data;
        $darkMode = $request_data['darkMode'] ?? '';
        if ($darkMode === '1' || $darkMode === true || $darkMode === 'true' || $darkMode === 1) {
            KCOption::set('dark_mode', 'true');
        } else {
            KCOption::set('dark_mode', 'false');
        }
        $data = KCOption::get('dark_mode');

        return [
            'data'    => $data,
            'status'  => true,
            'message' => esc_html__('Dark mode updated', 'kiviCare-clinic-&-patient-management-system-pro'),
        ];
    }

    public function wordpresLogo()
    {
        $request_data = $this->request_data;

        if (isset($request_data['wordpressLogo'])) {
            KCOption::set('wordpress_logo', $request_data['wordpressLogo']);
        }

        if (isset($request_data['wordpressLogoStatus'])) {
            $status = ($request_data['wordpressLogoStatus'] === '1' || $request_data['wordpressLogoStatus'] === true || $request_data['wordpressLogoStatus'] === 'on') ? 'on' : 'off';
            KCOption::set('wordpress_logo_status', $status);
        }

        $logo_id = KCOption::get('wordpress_logo', '');
        $status = KCOption::get('wordpress_logo_status', 'off');
        $url = $logo_id ? wp_get_attachment_url($logo_id) : '';

        return [
            'status'  => true,
            'data'    => [
                'id'         => $logo_id,
                'url'        => $url,
                'logoStatus' => $status,
            ],
            'message' => esc_html__('WordPress logo and status updated', 'kiviCare-clinic-&-patient-management-system-pro'),
        ];
    }

    public function saveCustomNotificationSetting()
    {
        $request_data = $this->request_data;
        $response = [];

        if (!empty($request_data['customNotification']) && is_array($request_data['customNotification'])) {
            foreach ($request_data['customNotification'] as $notification) {
                if (isset($notification['type']) && in_array($notification['type'], ['sms', 'whatsapp'], true)) {
                    $type = $notification['type'];
                    $status = (isset($notification['status']) && $notification['status'] === 'yes') ? 'yes' : 'no';
                    KCOption::set('custom_notification_' . $type . '_setting', $status);
                }
            }
            $response['status'] = true;
            $response['message'] = __('Custom notification settings updated successfully', 'kiviCare-clinic-&-patient-management-system-pro');
        } else {
            $response['message'] = __('Invalid custom notification data', 'kiviCare-clinic-&-patient-management-system-pro');
        }
        return $response;
    }

    public function saveSmsConfig()
    {
        $request_data = $this->request_data;
        $twilioData = $request_data['twilioSms'] ?? [];
        
        // Format data in the requested structure
        $formattedData = [
            'account_id' => $twilioData['account_id'] ?? '',
            'auth_token' => $twilioData['auth_token'] ?? '',
            'to_number'  => $twilioData['to_number'] ?? '',
            'enableSMS'  => ($twilioData['enableSMS'] === true || $twilioData['enableSMS'] === 'true' || $twilioData['enableSMS'] === 1 || $twilioData['enableSMS'] === '1') ? 'true' : 'false',
        ];
        
        update_option('sms_config_data', $formattedData);

        return [
            'status'  => true,
            'message' => __('SMS configuration saved successfully', 'kivicare-pro'),
            'data'    => $formattedData,
        ];
    }

    public function saveWhatsAppConfig()
    {
        $request_data = $this->request_data;
        $whatsappData = $request_data['twilioWhatsApp'] ?? [];
        $formattedData = [
            'wa_account_id' => $whatsappData['account_id'] ?? '',
            'wa_auth_token' => $whatsappData['auth_token'] ?? '',
            'wa_to_number' => $whatsappData['to_number'] ?? '',
            'enableWhatsApp' => ($whatsappData['enableWhatsApp'] === true || $whatsappData['enableWhatsApp'] === 'true' || $whatsappData['enableWhatsApp'] === 1 || $whatsappData['enableWhatsApp'] === '1') ? 'true' : 'false',
        ];
        update_option('whatsapp_config_data', $formattedData);

        return [
            'status'  => true,
            'message' => __('WhatsApp configuration saved successfully', 'kivicare-pro'),
            'data'    => $formattedData,
        ];
    }

    public function saveGoogleCalSetting()
    {
        $request_data = $this->request_data;
        $googlecalData = $request_data['googleAccount'] ?? [];
        KCOption::set('google_cal_setting', $googlecalData);
        return [
            'status'  => true,
            'message' => __('Google Calendar configuration saved successfully', 'kivicare-pro'),
            'data'    => [
                'client_id'     => $googlecalData['client_id'] ?? '',
                'client_secret' => $googlecalData['client_secret'] ?? '',
                'app_name'      => $googlecalData['app_name'] ?? '',
                'enableCal'     => !empty($googlecalData['enableCal']) ? 'yes' : 'no',
                'enableTwoWaySync' => !empty($googlecalData['enableTwoWaySync']) ? 'yes' : 'no',
            ],
        ];
    }

    public function saveGoogleStatusColors()
    {
        $request_data = $this->request_data;
        if (isset($request_data['status_colors']) && is_array($request_data['status_colors'])) {
            KCOption::set('gcal_status_colors', $request_data['status_colors']);
            return [
                'status' => true,
                'message' => __('Google Calendar status colors saved successfully', 'kivicare-pro'),
            ];
        }
        return [
            'status' => false,
            'message' => __('Google Calendar status colors not provided', 'kivicare-pro'),
        ];
    }

    public function googleCalPatient()
    {
        $request_data = $this->request_data;
        $value = !empty($request_data['patientCalendarEvent']) ? 'yes' : 'no';
        KCOption::set('patient_cal_setting', $value);
        return [
            'data' => [
                'pCal' => $value,
            ],
        ];
    }

    public function editClinicalDetailInclude()
    {
        $request_data = $this->request_data;
        $value = isset($request_data['clinicEncounterPrint']) ? (bool)$request_data['clinicEncounterPrint'] : false;
        KCOption::set('include_clinical_detail_in_print', $value ? 'true' : 'false');
        return [
            'status' => $value,
        ];
    }

    public function editEncounterCustomFieldInclude()
    {
        $request_data = $this->request_data;
        $value = isset($request_data['doctorEncounterPrint']) ? (bool)$request_data['doctorEncounterPrint'] : false;
        KCOption::set('include_encounter_custom_field_in_print', $value ? 'true' : 'false');
        return [
            'status' => $value,
        ];
    }

    public function editClinicalDetailHideInPatient()
    {
        $request_data = $this->request_data;
        $value = isset($request_data['hideEncounterClinicalDetails']) ? (bool)$request_data['hideEncounterClinicalDetails'] : false;
        KCOption::set('hide_clinical_detail_in_patient', $value ? 'true' : 'false');
        return [
            'status'  => $value,
            'message' => esc_html__('Setting Saved', 'kivicare-pro'),
        ];
    }

    public function saveCopyRightText()
    {
        $request_data = $this->request_data;
        $text = $request_data['copyrightText'] ?? '';
        KCOption::set('copyrightText', $text);
        return [
            'status'  => true,
            'message' => __('CopyRight Text Saved Successfully', 'kivicare-pro'),
        ];
    }
    public function saveGeneratedColors()
    {
        $request_data = $this->request_data;
        try {
            if (isset($request_data['generatedColors'])) {
                $css = $request_data['generatedColors'];
                
                // Sanitize the CSS string
                $sanitized_css = $this->sanitizeGeneratedColors($css);

                KCOption::set('generated_colors', $sanitized_css);

                return [
                    'status'  => true,
                    'message' => esc_html__('Generated colors saved successfully', 'kiviCare-clinic-&-patient-management-system-pro'),
                    'data'    => $sanitized_css,
                ];
            }
        } catch (\Exception $e) {
            return [
                'status'  => false,
                'message' => esc_html__('Failed to save generated colors', 'kiviCare-clinic-&-patient-management-system-pro'),
            ];
        }
    }

    /**
     * Sanitize and validate generated CSS colors string
     * 
     * @param string $css
     * @return string
     */
    private function sanitizeGeneratedColors($css)
    {
        if (!is_string($css)) {
            return '';
        }

        // 1. Remove any HTML tags to prevent XSS
        $css = wp_strip_all_tags($css);

        // 2. Remove dangerous CSS expressions and features
        $dangerous_patterns = [
            '/javascript:/i',
            '/expression\s*\(/i',
            '/vbscript:/i',
            '/@import/i',
            '/@charset/i',
            '/@namespace/i',
            '/url\s*\(/i',
            '/-moz-binding/i',
        ];
        $css = preg_replace($dangerous_patterns, '', $css);

        // 3. Allow only safe CSS characters for our specific variable format
        // Includes: a-z, A-Z, 0-9, spaces, tabs, newlines, { } : ; - # , [ ] " = . ( )
        // The parentheses are needed for rgb() and rgba() functions
        $css = preg_replace('/[^a-zA-Z0-9\s\{\}:;\-#,\[\]"=\.\(\)]/', '', $css);

        return trim($css);
    }

    /**
     * Get available fonts from JSON file
     */
    public function getFonts(WP_REST_Request $request)
    {
        $file = KIVI_CARE_PRO_DIR . '/app/helper/webfonts.json';
        if (!file_exists($file)) {
            return new WP_REST_Response(['data' => []], 200);
        }

        $json = file_get_contents($file);
        $data = json_decode($json, true);
        $items = $data['items'] ?? [];

        // Map to { label, value }
        $fonts = array_map(function($item) {
            return [
                'label' => $item['family'],
                'value' => $item['family']
            ];
        }, $items);

        return new WP_REST_Response([
            'data' => $fonts,
        ], 200);
    }

    /**
     * Update font settings
     */
    public function updateFonts()
    {
        $request_data = $this->request_data;
        $updated = [];
        try {
            if (isset($request_data['titleFont'])) {
                KCOption::set('title_font', $request_data['titleFont']);
                $updated[] = 'titleFont';
            }
            if (isset($request_data['bodyFont'])) {
                KCOption::set('body_font', $request_data['bodyFont']);
                $updated[] = 'bodyFont';
            }
            return [
                'status'  => true,
                'message' => esc_html__('Fonts updated successfully', 'kivicare-pro'),
                'data'    => $updated,
            ];
        } catch (\Exception $e) {
            return [
                'status'  => false,
                'message' => esc_html__('Failed to update fonts', 'kivicare-pro'),
            ];
        }
    }

    /**
     * Get Google Calendar Sync specific setting for user
     */
    public function getGoogleCalSyncSetting(\WP_REST_Request $request)
    {
        $user_id = get_current_user_id();
        $sync_events = get_user_meta($user_id, 'kc_google_calendar_sync_events', false);
        
        // Default to 'yes' if not set
        if ($sync_events === '') {
            $sync_events = 'yes';
        }

        return $this->response(
            ['kc_google_calendar_sync_events' => $sync_events === 'yes'], 
            __('Sync setting retrieved', 'kivicare-pro'), 
            true
        );
    }

    /**
     * Update Google Calendar Sync specific setting for user
     */
    public function updateGoogleCalSyncSetting(\WP_REST_Request $request)
    {
        $user_id = get_current_user_id();
        $params = $request->get_json_params() ?? [];
        
        if (isset($params['kc_google_calendar_sync_events'])) {
            $value = filter_var($params['kc_google_calendar_sync_events'], FILTER_VALIDATE_BOOLEAN) ? 'yes' : 'no';
            update_user_meta($user_id, 'kc_google_calendar_sync_events', $value);

            // Clear any cached month data for this user using delete_transient and KCOption model to ensure object cache compatibility
            $pattern = '_transient_kc_gcal_events_range_' . $user_id . '_%';
            $options = KCOption::query()
                ->where('option_name', 'LIKE', $pattern)
                ->get();

            if ($options->isNotEmpty()) {
                foreach ($options as $option) {
                    // Strip the '_transient_' prefix to use the standard delete_transient function
                    $transient_key = str_replace('_transient_', '', $option->option_name);
                    delete_transient($transient_key);
                }
            }

            return $this->response(
                ['kc_google_calendar_sync_events' => $value === 'yes'], 
                __('Sync setting updated successfully', 'kivicare-pro'), 
                true
            );
        }
        
        return $this->response([], __('Invalid parameters', 'kivicare-pro'), false, 400);
    }

    public function checkGoogleSyncPermission($request): bool
    {
        $user = wp_get_current_user();

        // Allow administrators, doctors, and receptionists
        $allowed_roles = [
            $this->kcbase->getDoctorRole(),      // kivicare_doctor
            $this->kcbase->getReceptionistRole() // kivicare_receptionist
        ];

        $has_permission = !empty(array_intersect($allowed_roles, $user->roles));

        return $has_permission;
    }

    public function checkAdminPermission($request): bool
    {
        return current_user_can('manage_options');
    }

    public function disconnectAllDoctors()
    {
        try {
            // Find all users who have a Google Calendar token or channel using the model
            $tokenMetas = KCUserMeta::query()
                ->where('meta_key', 'kc_google_calendar_token')
                ->get();

            $channelMetas = KCUserMeta::query()
                ->where('meta_key', 'kc_gcal_channel')
                ->get();

            $userIds = $tokenMetas->pluck('userId')
                ->merge($channelMetas->pluck('userId'))
                ->unique();

            $gcalIntegration = GoogleCalendarIntegration::getInstance();

            foreach ($userIds as $userId) {
                $userId = (int) $userId;
                // Stop push channel if exists
                $gcalIntegration->stopGooglePushChannel($userId);
                // Delete tokens and settings
                delete_user_meta($userId, 'kc_google_calendar_token');
                delete_user_meta($userId, 'kc_google_calendar_sync_events');
            }

            return $this->response([], __('All doctors disconnected from Google Calendar successfully', 'kivicare-pro'), true);
        } catch (\Exception $e) {
            return $this->response([], $e->getMessage(), false, 500);
        }
    }
}
