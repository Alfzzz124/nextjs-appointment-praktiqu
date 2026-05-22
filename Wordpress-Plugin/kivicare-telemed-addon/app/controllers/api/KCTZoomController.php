<?php
namespace KCTApp\controllers\api;

use App\baseClasses\KCBaseController;
use App\baseClasses\KCTelemedFactory;
use Exception;
use KCTApp\telemed\KCTZoom;
use WP_Error;
use WP_REST_Request;
use WP_REST_Response;
if (!defined('ABSPATH')) {
    exit; // Exit if accessed directly.
}
class KCTZoomController extends KCBaseController
{
    private static $instance = null;

    protected $route = 'settings/zoom-telemed';

    protected KCTZoom|null $zoomTelemed;


    public function __construct()
    {
        $this->zoomTelemed = KCTelemedFactory::create_provider('zoom');
        parent::__construct();
    }

    /**
     * Register routes for this controller
     */
    public function registerRoutes()
    {
        // Get Zoom Telemed
        $this->registerRoute('/' . $this->route, [
            'methods' => 'GET',
            'callback' => [$this, 'getZoomTelemed'],
            'permission_callback' => function (): bool|WP_Error {
                return $this->kcbase->getLoginUserRole() === 'administrator';
            },
            // 'args' => $this->getSettingsEndpointArgs()
        ]);
        // Update Zoom Telemed
        $this->registerRoute('/' . $this->route, [
            'methods' => ['PUT', 'POST'],
            'callback' => [$this, 'updateZoomTelemed'],
            'permission_callback' => function (): bool|WP_Error {
                return $this->kcbase->getLoginUserRole() === 'administrator';
            },
            'args' => [
                'auth_type' => [
                    'description' => __("", 'kivicare-telemed-addon'),
                    'type' => 'string',
                    'required' => true,
                    'enum' => ['oauth', 'server-to-server', 'none']
                ],
                'client_id' => [
                    'type' => 'string',
                    'required' => function (WP_REST_Request $request) {
                        return $request->get_param('auth_type') === 'oauth';
                    },
                    'validate_callback' => function ($param) {
                        return is_string($param);
                    },
                ],
                'client_secret' => [
                    'type' => 'string',
                    'required' => function (WP_REST_Request $request) {
                        return $request->get_param('auth_type') === 'oauth';
                    },
                    'validate_callback' => function ($param) {
                        return is_string($param);
                    },
                ]
            ]
        ]);

        $this->registerRoute('/' . $this->route . '/doctor-config', [
            'methods' => 'GET',
            'callback' => [$this, 'getZoomTelemedDoctorConfig'],
            'permission_callback' => function (): bool|WP_Error {
                return $this->kcbase->getLoginUserRole() === $this->kcbase->getDoctorRole();
            },
        ]);

        // Add PUT route for doctor-config
        $this->registerRoute('/' . $this->route . '/doctor-config', [
            'methods' => 'PUT',
            'callback' => [$this, 'updateZoomTelemedDoctorConfig'],
            'permission_callback' => function (): bool|WP_Error {
                return $this->kcbase->getLoginUserRole() === $this->kcbase->getDoctorRole();
            },
            'args' => [
                'auth_type' => [
                    'description' => __('Authentication type for Zoom connection', 'kivicare-telemed-addon'),
                    'type' => 'string',
                    'required' => true,
                    'enum' => ['oauth', 'server-to-server', 'none']
                ],
                'is_connected' => [
                    'description' => __('Whether the doctor is connected to Zoom', 'kivicare-telemed-addon'),
                    'type' => 'boolean',
                    'required' => false,
                ],
                'connection_status' => [
                    'description' => __('Connection status for the doctor', 'kivicare-telemed-addon'),
                    'type' => 'string',
                    'required' => false,
                    'enum' => ['connected', 'not_connected']
                ],
                // Define your arguments here if needed
            ],
        ]);

        // New endpoint for doctor authorization
        $this->registerRoute('/' . $this->route . '/authorize', [
            'methods' => 'GET',
            'callback' => [$this, 'authorizeDoctorZoom'],
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

        // New endpoint for OAuth callback
        $this->registerRoute('/' . $this->route . '/callback', [
            'methods' => 'GET',
            'callback' => [$this, 'handleZoomCallback'],
            'permission_callback' => '__return_true'
        ]);

        $this->registerRoute('/' . $this->route . '/test-connection', [
            'methods' => 'PUT',
            'callback' => [$this, 'testZoomConnection'],
            'permission_callback' => function (): bool|WP_Error {
                return $this->kcbase->getLoginUserRole() === $this->kcbase->getDoctorRole();
            },
            'args' => [
                'auth_type' => [
                    'description' => __('Authentication type for Zoom connection', 'kivicare-telemed-addon'),
                    'type' => 'string',
                    'required' => true,
                    'enum' => ['oauth', 'server-to-server']
                ],
                'client_id' => [
                    'type' => 'string',
                    'required' => true,
                    'validate_callback' => function ($param) {
                        return is_string($param);
                    },
                ],
                'client_secret' => [
                    'type' => 'string',
                    'required' => true,
                    'validate_callback' => function ($param) {
                        return is_string($param);
                    },
                ],
                'account_id' => [
                    'type' => 'string',
                    'required' => function (WP_REST_Request $request) {
                        return $request->get_param('auth_type') === 'server-to-server';
                    },
                    'validate_callback' => function ($param) {
                        return is_string($param);
                    },
                ]
            ]
        ]);
    }
    /**
     * Get ZoomTelemed doctor configuration
     *
     * @param \WP_REST_Request $request
     * @return \WP_REST_Response
     */
    public function getZoomTelemedDoctorConfig(WP_REST_Request $request): WP_REST_Response
    {
        try {
            $doctor_id = get_current_user_id();
            $global_config = $this->zoomTelemed->get_config();

            $is_gmeet_connected = false;
            if (function_exists('isKiviCareGoogleMeetActive') && isKiviCareGoogleMeetActive()) {

                $gmeet_doctor_status = get_user_meta($doctor_id, 'kiviCare_google_meet_connect', true);

                $gmeet_global_config = \App\models\KCOption::get('google_meet_setting', []);
                $is_gmeet_globally_enabled = (!empty($gmeet_global_config['enableCal']) && in_array($gmeet_global_config['enableCal'], ['Yes', 'on']));

                if ($is_gmeet_globally_enabled && $gmeet_doctor_status === 'on') {
                    $is_gmeet_connected = true;
                }
            }

            $is_zoom_connected = false;
            if ($global_config['auth_type'] == 'oauth') {
                $is_zoom_connected = (get_user_meta($doctor_id, 'kiviCare_zoom_telemed_connect', true) === 'on');
            } else {
                $legacy_s2s_config = get_user_meta($doctor_id, 'zoom_server_to_server_oauth_config_data', true);
                if (!empty($legacy_s2s_config)) {
                    $s2s_data = json_decode($legacy_s2s_config, true);
                    if (isset($s2s_data['enableServerToServerOauthconfig']) && ($s2s_data['enableServerToServerOauthconfig'] === 'true' || $s2s_data['enableServerToServerOauthconfig'] === true)) {
                        $is_zoom_connected = true;
                    }
                }
            }

            if ($global_config['auth_type'] == 'oauth') {
                $response = [
                    'auth_type' => $global_config['auth_type'],
                    'is_connected' => $is_zoom_connected,
                    'connection_status' => $is_zoom_connected ? 'connected' : 'not_connected',
                    'is_google_meet_connected' => $is_gmeet_connected
                ];
            } else {
                $doctor_config = $this->zoomTelemed->get_doctor_config($doctor_id);
                $response = [
                    'auth_type' => $global_config['auth_type'],
                    'is_google_meet_connected' => $is_gmeet_connected,
                    'is_connected' => $is_zoom_connected,
                    'server_to_server_enabled' => $is_zoom_connected ? 'Yes' : 'No',
                    ...$doctor_config
                ];
            }
            return $this->response($response, 'Doctor Zoom configuration retrieved', true);
        } catch (\Exception $e) {
            return $this->response(
                ['error' => $e->getMessage()],
                __('Failed to retrieve Zoom configuration.', 'kivicare-telemed-addon'),
                false,
                500
            );
        }
    }

    public function updateZoomTelemedDoctorConfig(WP_REST_Request $request): WP_REST_Response
    {
        try {
            $doctor_id = get_current_user_id();
            $request_data = $request->get_json_params();
            $auth_type = $request_data['auth_type'] ?? 'none';

            // Validate auth_type
            if (!in_array($auth_type, ['oauth', 'server-to-server', 'none'])) {
                return $this->response(
                    ['error' => __('Invalid authentication type.', 'kivicare-telemed-addon')],
                    __('Failed to update Zoom configuration.', 'kivicare-telemed-addon'),
                    false,
                    400
                );
            }

            // Update doctor configuration
            $this->zoomTelemed->update_doctor_config($doctor_id, [
                'auth_type' => $auth_type,
                'account_id' => isset($request_data['account_id']) ? (string) $request_data['account_id'] : '',
                'client_id' => isset($request_data['client_id']) ? (string) $request_data['client_id'] : '',
                'client_secret' => isset($request_data['client_secret']) ? (string) $request_data['client_secret'] : '',
            ]);

            // Handle Connection Status Flags
            if (in_array($auth_type, ['oauth', 'server-to-server'])) {
                update_user_meta($doctor_id, 'kiviCare_zoom_telemed_connect', 'on');
                update_user_meta($doctor_id, 'telemed_type', 'zoom');
                update_user_meta($doctor_id, 'kiviCare_google_meet_connect', 'off');
            } else {
                update_user_meta($doctor_id, 'kiviCare_zoom_telemed_connect', 'off');
            }

            return $this->response('', esc_html__("Zoom Telemed Doctor Configuration Updated Successfully", 'kivicare-telemed-addon'), true);
        } catch (Exception $e) {
            return $this->response(
                ['error' => $e->getMessage()],
                __('Failed to update Zoom configuration.', 'kivicare-telemed-addon'),
                false,
                500
            );
        }
    }

    /**
     * Get ZoomTelemed settings
     *
     * @param \WP_REST_Request $request
     * @return \WP_REST_Response
     */
    public function getZoomTelemed(WP_REST_Request $request): WP_REST_Response
    {
        return $this->response(
            $this->zoomTelemed->get_config(),
            esc_html__("Zoom Telemed Setting Retrieved Successfully", 'kivicare-telemed-addon'),
            true
        );
    }
    /**
     * Update ZoomTelemed settings
     *
     * @param \WP_REST_Request $request
     * @return \WP_REST_Response
     */
    public function updateZoomTelemed(WP_REST_Request $request): WP_REST_Response
    {
        try {
            $request_data = $request->get_json_params();
            $auth_type = $request_data['auth_type'] ?? 'none';

            $config = [
                'enableCal'        => ($auth_type !== 'none') ? 'Yes' : 'No',
                'client_id'        => $request_data['client_id'] ?? '',
                'client_secret'    => $request_data['client_secret'] ?? '',
                'redirect_url'     => rest_url('kivicare/v1/settings/zoom-telemed/callback'),
                
                'auth_type'        => $auth_type,
                'account_id'       => $request_data['account_id'] ?? '',
                'default_settings' => $request_data['default_settings'] ?? []
            ];

            $this->zoomTelemed->update_config($config);
            return $this->response('', esc_html__("Zoom Telemed Setting Saved Successfully", 'kivicare-telemed-addon'), true);
        } catch (\Exception $e) {
            return $this->response(
                ['error' => $e->getMessage()],
                __('Failed to save Zoom settings.', 'kivicare-telemed-addon'),
                false,
                500
            );
        }
    }

    public function authorizeDoctorZoom(WP_REST_Request $request): WP_REST_Response
    {
        $doctor_id = get_current_user_id();
        $redirect_url = $this->zoomTelemed->get_authorization_url($doctor_id);
        return $this->response(['redirect_url' => $redirect_url], 'Authorization URL generated', true);
    }


    /**
     * Disconnect doctor from Zoom
     */
    public function disconnectDoctor(WP_REST_Request $request): WP_REST_Response
    {
        try {
            $doctor_id = get_current_user_id();
            $disconnected = $this->zoomTelemed->disconnect_doctor($doctor_id);

            if ($disconnected) {
                return $this->response(
                    [],
                    esc_html__('Successfully disconnected from Zoom', 'kivicare-telemed-addon'),
                    true
                );
            } else {
                return $this->response(
                    [],
                    esc_html__('Failed to disconnect from Zoom', 'kivicare-telemed-addon'),
                    false,
                    500
                );
            }
        } catch (\Exception $e) {
            return $this->response(
                ['error' => $e->getMessage()],
                esc_html__('Error disconnecting from Zoom', 'kivicare-telemed-addon'),
                false,
                500
            );
        }
    }
    /**
     * Handle Zoom OAuth callback
     *
     * @param WP_REST_Request $request
     * @return WP_Error|WP_REST_Response
     */
    public function testZoomConnection(WP_REST_Request $request): WP_Error|WP_REST_Response
    {
        try {
            $doctor_id = get_current_user_id();
            $request_data = $request->get_json_params();

            $connection = $this->zoomTelemed->test_connection($request_data, $doctor_id);

            if ($connection && $connection['success'] === true) {
                return $this->response(
                    $connection,
                    esc_html__('Zoom connection test successful', 'kivicare-telemed-addon'),
                    true
                );
            } else {
                throw new Exception(
                    $connection['message'] ?? esc_html__('Zoom connection test failed', 'kivicare-telemed-addon')
                );
            }
               

        } catch (Exception $e) {
            return $this->response(
                ['error' => $e->getMessage()],
                esc_html__('Failed to test Zoom connection.', 'kivicare-telemed-addon'),
                false,
                500
            );
        }
    }

    public function handleZoomCallback(WP_REST_Request $request)
    {
        $code = $request->get_param('code');
        $state = $request->get_param('state');

        if (!$code || !$state) {
            return new WP_Error('invalid_params', 'Missing required parameters');
        }

        $doctor_id = (int) $state;
        $success = $this->zoomTelemed->handle_authorization_callback($doctor_id, $code);
        if ($success) {
            wp_redirect(add_query_arg('zoom_connected', '1', kc_get_dashboard_url($this->kcbase->getDoctorRole()) . '/setting/zoom-configuration/'));
        } else {
            wp_redirect(add_query_arg('zoom_error', '1', kc_get_dashboard_url($this->kcbase->getDoctorRole()) . '/setting/zoom-configuration/'));
        }
        exit;
    }
}
