<?php

namespace KCGMApp\controllers\api;

use App\baseClasses\KCBaseController;
use App\baseClasses\KCTelemedFactory;
use App\baseClasses\KCErrorLogger;
use App\models\KCOption;
use Exception;
use KCGMApp\googlemeet\KCGMGoogleMeet;
use WP_Error;
use WP_REST_Request;
use WP_REST_Response;

defined('ABSPATH') || exit;

class KCGMGoogleMeetController extends KCBaseController
{
    private static $instance = null;

    protected $route = 'settings/googlemeet';
    /**
     * @var KCGMGoogleMeet
     */
    protected $googleMeet;

    public function __construct()
    {
        parent::__construct();
        $this->googleMeet = KCTelemedFactory::create_provider('googlemeet');
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
        // Get Googlemeet
        $this->registerRoute('/' . $this->route, [
            'methods' => 'GET',
            'callback' => [$this, 'getGooglemeet'],
            'permission_callback' => function (): bool|WP_Error {
                return $this->kcbase->getLoginUserRole() === 'administrator';
            },
        ]);

        // Update Google Event Template
        $this->registerRoute('/' . $this->route, [
            'methods' => ['PUT', 'POST'],
            'callback' => [$this, 'updateGooglemeet'],
            'permission_callback' => function (): bool|WP_Error {
                return $this->kcbase->getLoginUserRole() === 'administrator';
            },
        ]);

        // Doctor configuration routes
        $this->registerRoute('/' . $this->route . '/doctor-config', [
            'methods' => 'GET',
            'callback' => [$this, 'getGoogleMeetDoctorConfig'],
            'permission_callback' => function (): bool|WP_Error {
                return $this->kcbase->getLoginUserRole() === $this->kcbase->getDoctorRole();
            },
        ]);

        $this->registerRoute('/' . $this->route . '/doctor-config', [
            'methods' => 'PUT',
            'callback' => [$this, 'updateGoogleMeetDoctorConfig'],
            'permission_callback' => function (): bool|WP_Error {
                return $this->kcbase->getLoginUserRole() === $this->kcbase->getDoctorRole();
            },
            'args' => [
                'auth_type' => [
                    'description' => __('Authentication type for Google Meet connection', 'kivicare-googlemeet-telemed-addon'),
                    'type' => 'string',
                    'required' => true,
                    'enum' => ['oauth', 'none']
                ],
                'is_connected' => [
                    'description' => __('Whether the doctor is connected to Google Meet', 'kivicare-googlemeet-telemed-addon'),
                    'type' => 'boolean',
                    'required' => false
                ],
                'connection_status' => [
                    'description' => __('Connection status for the doctor', 'kivicare-googlemeet-telemed-addon'),
                    'type' => 'string',
                    'required' => false,
                    'enum' => ['connected', 'not_connected']
                ]
            ]
        ]);

        $this->registerRoute('/' . $this->route . '/authorize', [
            'methods' => 'GET',
            'callback' => [$this, 'authorizeDoctorGoogleMeet'],
            'permission_callback' => function (): bool {
                return $this->kcbase->getLoginUserRole() === $this->kcbase->getDoctorRole();
            }
        ]);

        $this->registerRoute('/' . $this->route . '/disconnect', [
            'methods' => 'GET',
            'callback' => [$this, 'disconnectDoctor'],
            'permission_callback' => function (): bool {
                return $this->kcbase->getLoginUserRole() === $this->kcbase->getDoctorRole();
            }
        ]);

        $this->registerRoute('/' . $this->route . '/callback', [
            'methods' => 'GET',
            'callback' => [$this, 'handleGoogleMeetCallback'],
            'permission_callback' => '__return_true'
        ]);

        $this->registerRoute('/' . $this->route . '/test-connection', [
            'methods' => 'PUT',
            'callback' => [$this, 'testGoogleMeetConnection'],
            'permission_callback' => function (): bool|WP_Error {
                return $this->kcbase->getLoginUserRole() === $this->kcbase->getDoctorRole();
            },
            'args' => [
                'auth_type' => [
                    'description' => __('Authentication type for Google Meet connection', 'kivicare-googlemeet-telemed-addon'),
                    'type' => 'string',
                    'required' => true,
                    'enum' => ['oauth']
                ],
                'client_id' => [
                    'type' => 'string',
                    'required' => true,
                    'validate_callback' => function ($param) {
                        return is_string($param);
                    }
                ],
                'client_secret' => [
                    'type' => 'string',
                    'required' => true,
                    'validate_callback' => function ($param) {
                        return is_string($param);
                    }
                ]
            ]
        ]);
    }

    /**
     * Get Googlemeet settings
     * 
     * @param \WP_REST_Request $request
     * @return \WP_REST_Response
     */
    public function getGooglemeet(WP_REST_Request $request): WP_REST_Response
    {
        $prefix = KIVI_CARE_PREFIX;
        $google_event_template = $prefix . 'gmeet_tmp';
        $args['post_type'] = strtolower($google_event_template);
        $gogle_template_result = get_posts($args);
        $gogle_template_result = collect($gogle_template_result)->unique('post_title')->sortBy('ID');
        $config = ['data' => KCOption::get('google_meet_setting', [])];

        // Generate redirection URL for Google Cloud Console
        $redirection_url = $this->getGoogleMeetRedirectionUrl();
        KCErrorLogger::instance()->error('[Google Meet] Redirection URL: ' . $redirection_url);

        if ($gogle_template_result) {
            $response = [
                'data' => $gogle_template_result[0],
                'config' => $config,
                'redirection_url' => $redirection_url
            ];
            return $this->response($response);
        } else {
            $response = [
                'data' => [],
                'config' => $config,
                'redirection_url' => $redirection_url
            ];
            return $this->response($response, '', false);
        }
    }

    /**
     * Update Googlemeet settings
     * 
     * @param \WP_REST_Request $request
     * @return \WP_REST_Response
     */
    public function updateGooglemeet(WP_REST_Request $request): WP_REST_Response
    {
        try {
            $request_data = $request->get_json_params();

            $google_meet_event_template_data = $request_data['google_meet_event_template'];
            $google_meet_config_data = $request_data['google_meet_config'];
            KCOption::set('google_meet_setting', $google_meet_config_data);

            $google_meet_event_template_response = apply_filters('kcgm_save_googlemeet_event_template', [
                'data' => [$google_meet_event_template_data]
            ]);
            $google_meet_config_response = apply_filters('kcgm_saved_google_meet_setting', ['data' => $google_meet_config_data]);

            $has_error = false;
            $data = [
                'google_meet_event_template' => $google_meet_event_template_response,
                'google_meet_config' => $google_meet_config_response,
            ];

            foreach ($data as $item) {
                if (isset($item['status']) && $item['status'] === false) {
                    $has_error = true;
                    break;
                }
            }

            if ($has_error) {
                return $this->response($data, esc_html__('Google Meet Data Updated with some errors.', 'kivicare-googlemeet-telemed-addon'), false);
            } else {
                return $this->response($data, esc_html__('Google Meet Data Updated Successfully', 'kivicare-googlemeet-telemed-addon'));
            }

        } catch (\Exception $e) {
            return $this->response(
                ['error' => $e->getMessage()],
                __('Failed to save Google Meet settings.', 'kivicare-googlemeet-telemed-addon'),
                false,
                500
            );
        }
    }

    public function getGoogleMeetDoctorConfig(WP_REST_Request $request): WP_REST_Response
    {
        try {
            $doctor_id = get_current_user_id();
            $access_token = $this->googleMeet->get_doctor_access_token($doctor_id);
            $global_config = $this->googleMeet->get_config();

            $connect_status = get_user_meta($doctor_id, 'kiviCare_google_meet_connect', true);
            $is_connected = !empty($access_token) && $connect_status === 'on';

            // Zoom Connection Check
            $is_zoom_connected = false;

            // Check if Zoom Plugin is Active
            if (function_exists('isKiviCareTelemedActive') && isKiviCareTelemedActive()) {

                // Check Global Zoom Settings
                $zoom_global = \App\models\KCOption::get('zoom_telemed_setting');
                $zoom_global = maybe_unserialize($zoom_global); // Ensure array

                $zoom_globally_enabled = (
                    (!empty($zoom_global['enabled']) && filter_var($zoom_global['enabled'], FILTER_VALIDATE_BOOLEAN)) ||
                    (!empty($zoom_global['auth_type']) && in_array($zoom_global['auth_type'], ['oauth', 'server-to-server']))
                );

                // Check Doctor Status
                $zoom_doctor_status = get_user_meta($doctor_id, 'kiviCare_zoom_telemed_connect', true);

                // Final Check
                if ($zoom_globally_enabled && $zoom_doctor_status === 'on') {
                    $is_zoom_connected = true;
                }
            }

            $response = [
                'auth_type' => $global_config['auth_type'],
                'is_connected' => $is_connected,
                'connection_status' => $is_connected ? 'connected' : 'not_connected',
                'is_zoom_connected' => $is_zoom_connected,
            ];

            return $this->response($response, __('Doctor Google Meet configuration retrieved', 'kivicare-googlemeet-telemed-addon'), true);

        } catch (Exception $e) {
            return $this->response(
                ['error' => $e->getMessage()],
                __('Failed to retrieve Google Meet configuration.', 'kivicare-googlemeet-telemed-addon'),
                false,
                500
            );
        }
    }

    public function updateGoogleMeetDoctorConfig(WP_REST_Request $request): WP_REST_Response
    {
        try {
            $doctor_id = get_current_user_id();
            $request_data = $request->get_json_params();
            $auth_type = $request_data['auth_type'] ?? 'none';

            if (!in_array($auth_type, ['oauth', 'none'])) {
                return $this->response(
                    ['error' => __('Invalid authentication type.', 'kivicare-googlemeet-telemed-addon')],
                    __('Failed to update Google Meet configuration.', 'kivicare-googlemeet-telemed-addon'),
                    false,
                    400
                );
            }

            $this->googleMeet->update_doctor_config($doctor_id, [
                'auth_type' => $auth_type,
                'client_id' => isset($request_data['client_id']) ? (string) $request_data['client_id'] : '',
                'client_secret' => isset($request_data['client_secret']) ? (string) $request_data['client_secret'] : ''
            ]);

            return $this->response('', __('Google Meet Doctor Configuration Updated Successfully', 'kivicare-googlemeet-telemed-addon'), true);
        } catch (Exception $e) {
            return $this->response(
                ['error' => $e->getMessage()],
                __('Failed to update Google Meet configuration.', 'kivicare-googlemeet-telemed-addon'),
                false,
                500
            );
        }
    }

    public function authorizeDoctorGoogleMeet(WP_REST_Request $request): WP_REST_Response
    {
        $doctor_id = get_current_user_id();
        $redirect_url = $this->googleMeet->get_authorization_url($doctor_id);
        return $this->response(['redirect_url' => $redirect_url], __('Authorization URL generated', 'kivicare-googlemeet-telemed-addon'), true);
    }

    public function disconnectDoctor(WP_REST_Request $request): WP_REST_Response
    {
        try {
            $doctor_id = get_current_user_id();
            $disconnected = $this->googleMeet->disconnect_doctor($doctor_id);

            if ($disconnected) {
                return $this->response(
                    [],
                    __('Successfully disconnected from Google Meet', 'kivicare-googlemeet-telemed-addon'),
                    true
                );
            } else {
                return $this->response(
                    [],
                    __('Failed to disconnect from Google Meet', 'kivicare-googlemeet-telemed-addon'),
                    false,
                    500
                );
            }
        } catch (Exception $e) {
            return $this->response(
                ['error' => $e->getMessage()],
                __('Error disconnecting from Google Meet', 'kivicare-googlemeet-telemed-addon'),
                false,
                500
            );
        }
    }

    public function testGoogleMeetConnection(WP_REST_Request $request): WP_REST_Response
    {
        try {
            $doctor_id = get_current_user_id();
            $request_data = $request->get_json_params();

            $connection = $this->googleMeet->test_connection($request_data, $doctor_id);

            if ($connection && $connection['success'] === true) {
                return $this->response(
                    $connection,
                    __('Google Meet connection test successful', 'kivicare-googlemeet-telemed-addon'),
                    true
                );
            } else {
                throw new Exception(
                    $connection['message'] ?? __('Google Meet connection test failed', 'kivicare-googlemeet-telemed-addon')
                );
            }
        } catch (Exception $e) {
            return $this->response(
                ['error' => $e->getMessage()],
                __('Failed to test Google Meet connection.', 'kivicare-googlemeet-telemed-addon'),
                false,
                500
            );
        }
    }

    public function handleGoogleMeetCallback(WP_REST_Request $request)
    {
        $code = $request->get_param('code');
        $state = $request->get_param('state');

        if (!$code || !$state) {
            return new WP_Error('invalid_params', __('Missing required parameters', 'kivicare-googlemeet-telemed-addon'));
        }

        $doctor_id = (int) $state;
        $success = $this->googleMeet->handle_google_meet_authorization_callback($doctor_id, $code);
        $dashboard_url = kc_get_dashboard_url(\App\baseClasses\KCBase::get_instance()->getDoctorRole()) . '/setting/google-meet-configuration/';

        if ($success) {

            // Disconnect from Zoom OAuth by deleting the token and setting status to 'off'.
            delete_user_meta($doctor_id, 'kiviCare_doctor_zoom_telemed_config');
            update_user_meta($doctor_id, 'kiviCare_zoom_telemed_connect', 'off');

            // Disconnect from Zoom Server-to-Server by updating its legacy config.
            $legacy_s2s_config_json = get_user_meta($doctor_id, 'zoom_server_to_server_oauth_config_data', true);
            if (!empty($legacy_s2s_config_json)) {
                $s2s_data = json_decode($legacy_s2s_config_json, true);
                if (is_array($s2s_data)) {
                    $s2s_data['enableServerToServerOauthconfig'] = 'false';
                    update_user_meta($doctor_id, 'zoom_server_to_server_oauth_config_data', json_encode($s2s_data));
                }
            }

            wp_redirect(add_query_arg('google_meet_connected', '1', $dashboard_url));

        } else {
            wp_redirect(add_query_arg('google_meet_error', '1', $dashboard_url));
        }

        exit;
    }

    /**
     * Get Google Meet redirection URL for Google Cloud Console
     * 
     * @return string
     */
    private function getGoogleMeetRedirectionUrl(): string
    {
        $site_url = get_site_url();
        $rest_url = rest_url('kivicare/v1/settings/googlemeet/callback');
        return $rest_url;
    }
}
