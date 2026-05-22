<?php
namespace KCProApp\controllers\api;

use App\controllers\api\SettingsController;
use App\baseClasses\KCBase;
use App\models\KCAppointment;
use App\models\KCAppointmentServiceMapping;
use App\models\KCReceptionistClinicMapping;
use App\models\KCOption;
use App\models\KCUserMeta;
use App\baseClasses\KCErrorLogger;
use App\services\KCTimeSlotService;
use App\services\KCAppointmentDataService;
use App\models\KCServiceDoctorMapping;
use KCProApp\notifications\KCPNotificationManager;
use KCProApp\notifications\KCPNotificationInit;
use KCProApp\notifications\KCPNotificationTemplateProcessor;
use App\baseClasses\KCTelemedFactory;
use WP_REST_Request;
use WP_REST_Response;
use WP_Error;
use Exception;

defined('ABSPATH') or die('No direct access allowed');

class GoogleCalendarIntegration extends SettingsController
{
    private static $instance = null;
    protected $route = 'settings/google-calendar-integration';
    private $kcBase;

    // Google API endpoints
    private $google_oauth_url = 'https://accounts.google.com/o/oauth2/auth';
    private $google_token_url = 'https://oauth2.googleapis.com/token';
    private $google_calendar_api = 'https://www.googleapis.com/calendar/v3';

    // Singleton for consistent instance
    public static function getInstance()
    {
        if (self::$instance === null) {
            self::$instance = new self();
        }
        return self::$instance;
    }

    public function __construct()
    {
        parent::__construct();
        $this->kcBase = new KCBase();
        add_action('rest_api_init', [$this, 'registerRoutes']);

        // Register filters to inject Google Calendar busy slots into appointment generation
        add_filter('kc_external_busy_slots', [$this, 'filterExternalBusySlotsForRange'], 10, 4);
        add_filter('kc_external_busy_slots_single', [$this, 'filterExternalBusySlotsForSingle'], 10, 3);

        // WP Cron: daily renewal of push notification channels
        add_action('kc_renew_gcal_channels', [$this, 'renewExpiredPushChannels']);
        if (!wp_next_scheduled('kc_renew_gcal_channels')) {
            wp_schedule_event(time(), 'daily', 'kc_renew_gcal_channels');
        }
    }

    /**
     * Filter to inject Google Calendar busy slots for a date range
     */
    public function filterExternalBusySlotsForRange($busySlots, $doctorId, $startDate, $endDate)
    {
        $sync_google_events = get_user_meta($doctorId, 'kc_google_calendar_sync_events', false);
        if ($sync_google_events === '') {
            $sync_google_events = 'yes';
        }

        if ($sync_google_events === 'yes') {
            try {
                $googleSlots = $this->getGoogleBusySlotsForRange($doctorId, $startDate, $endDate);
                if (is_array($googleSlots)) {
                    $busySlots = array_merge($busySlots, $googleSlots);
                }
            } catch (\Exception $e) {
                KCErrorLogger::instance()->error('Filter Google fetch error: ' . $e->getMessage());
            }
        }

        return $busySlots;
    }

    /**
     * Filter to inject Google Calendar busy slots for a single date
     */
    public function filterExternalBusySlotsForSingle($busySlots, $doctorId, $date)
    {
        return $this->filterExternalBusySlotsForRange($busySlots, $doctorId, $date, $date);
    }

    public function registerRoutes()
    {
        // Register each route manually without any loops
        $this->registerRoute('/' . $this->route . '', [
            'methods' => 'GET',
            'callback' => [$this, 'getStatus'],
            'permission_callback' => [$this, 'checkPermission'],
        ]);

        $this->registerRoute('/' . $this->route . '/connect', [
            'methods' => 'PUT',
            'callback' => [$this, 'getAuthUrl'],
            'permission_callback' => [$this, 'checkPermission'],
        ]);

        $this->registerRoute('/' . $this->route . '/disconnect', [
            'methods' => 'PUT',
            'callback' => [$this, 'disconnect'],
            'permission_callback' => [$this, 'checkPermission'],
        ]);

        $this->registerRoute('/' . $this->route . '/callback', [
            'methods' => 'GET',
            'callback' => [$this, 'handleCallback'],
            'encryption' => false,
            'permission_callback' => '__return_true', // Public for OAuth callback
            'args' => [
                'code' => [
                    'description' => 'OAuth authorization code',
                    'type' => 'string',
                    'required' => false,
                    'sanitize_callback' => 'sanitize_text_field',
                ],
                'state' => [
                    'description' => 'OAuth state parameter',
                    'type' => 'string',
                    'required' => false,
                    'sanitize_callback' => 'sanitize_text_field',
                ],
                'error' => [
                    'description' => 'OAuth error message',
                    'type' => 'string',
                    'required' => false,
                    'sanitize_callback' => 'sanitize_text_field',
                ],
            ],
        ]);

        // Public webhook endpoint — Google sends push notifications here
        $this->registerRoute('/' . $this->route . '/webhook', [
            'methods'             => 'POST',
            'encryption' => false,
            'callback'            => [$this, 'handleWebhook'],
            'permission_callback' => '__return_true',
        ]);
    }

    public function checkPermission($request): bool
    {
        $user = wp_get_current_user();

        // Allow administrators, doctors, and receptionists
        $allowed_roles = [
            $this->kcBase->getDoctorRole(),      // kivicare_doctor
            $this->kcBase->getReceptionistRole() // kivicare_receptionist
        ];

        $has_permission = !empty(array_intersect($allowed_roles, $user->roles));

        return $has_permission;
    }

    public function getStatus(WP_REST_Request $request)
    {
        try {
            $user_id = get_current_user_id();
            $token = get_user_meta($user_id, 'kc_google_calendar_token', true);
            $connected = !empty($token) && !empty($token['access_token']);
            return new WP_REST_Response(['connected' => $connected], 200);
        } catch (Exception $e) {
            return $this->errorResponse('get_status_error', $e->getMessage(), 500);
        }
    }

    public function getAuthUrl(WP_REST_Request $request)
    {
        try {
            $google_settings = KCOption::get('google_cal_setting', []);
            if (empty($google_settings['client_id']) || empty($google_settings['client_secret'])) {
                return $this->errorResponse('config_missing', 'Google Calendar configuration is missing.', 400);
            }

            $user_id = get_current_user_id();
            $state = $this->createOAuthState($user_id);
            update_user_meta($user_id, 'kc_google_oauth_state', md5($state));

            $redirect_uri = $this->getRedirectUri();

            $params = [
                'client_id' => $google_settings['client_id'],
                'redirect_uri' => $redirect_uri,
                'scope' => 'https://www.googleapis.com/auth/calendar',
                'response_type' => 'code',
                'access_type' => 'offline',
                'prompt' => 'consent',
                'state' => $state,
                'include_granted_scopes' => 'true'
            ];

            $auth_url = $this->google_oauth_url . '?' . http_build_query($params);
            return new WP_REST_Response(['url' => $auth_url], 200);
        } catch (Exception $e) {
            KCErrorLogger::instance()->error('Auth URL generation failed: ' . $e->getMessage());
            return $this->errorResponse('auth_url_error', $e->getMessage(), 500);
        }
    }

    public function disconnect(WP_REST_Request $request)
    {
        try {
            $user_id = get_current_user_id();
            // Stop push notification channel on Google side
            $this->stopGooglePushChannel($user_id);
            delete_user_meta($user_id, 'kc_google_calendar_token');
            return new WP_REST_Response(['message' => __('Disconnected successfully', 'kivicare-pro')], 200);
        } catch (Exception $e) {
            return $this->errorResponse('disconnect_error', $e->getMessage(), 500);
        }
    }

    public function handleCallback(WP_REST_Request $request)
    {
        $code = $request->get_param('code');
        $state = $request->get_param('state');
        $error = $request->get_param('error');
        $state_data = $this->decodeState($state);
        $user_id = intval($state_data['user_id']);

        if ($error) {
            return $this->redirectWithError($user_id, 'oauth_cancelled');
        }

        if (empty($code) || empty($state)) {
            return $this->redirectWithError($user_id, 'invalid_callback');
        }

        if (!$state_data || !isset($state_data['user_id'])) {
            return $this->redirectWithError($user_id, 'invalid_state');
        }

        $stored_hash = get_user_meta($user_id, 'kc_google_oauth_state', true);
        if (!$stored_hash || $stored_hash !== md5($state)) {
            return $this->redirectWithError($user_id, 'state_mismatch');
        }

        delete_user_meta($user_id, 'kc_google_oauth_state');

        if ($this->handleAuthCallback($user_id, $code)) {
            // Update calendar timezone after successful connection
            $this->updateCalendarTimezone($user_id);
            // Register push notification channel so we receive event-change webhooks
            $this->registerGooglePushChannel($user_id);
            return $this->redirectWithSuccess($user_id);
        } else {
            KCErrorLogger::instance()->error("Failed to complete Google Calendar authorization for user {$user_id}");
            return $this->redirectWithError($user_id, 'auth_failed');
        }
    }

    private function createOAuthState($user_id)
    {
        $state_data = [
            'user_id' => $user_id,
            'timestamp' => time(),
            'nonce' => wp_generate_password(8, false),
        ];
        // Use URL-safe Base64 encoding and remove padding to prevent manipulation by proxies
        $state = base64_encode(json_encode($state_data));
        return rtrim(strtr($state, '+/', '-_'), '=');
    }

    private function decodeState($state)
    {
        // Decode URL-safe Base64 encoding
        $state_base64 = strtr($state, '-_', '+/');
        return json_decode(base64_decode($state_base64), true);
    }

    private function getRedirectUri()
    {
        $redirect_uri = rest_url('kivicare/v1/' . $this->route . '/callback');
        if (is_ssl()) {
            $redirect_uri = preg_replace('/^http:/i', 'https:', $redirect_uri);
        }
        return $redirect_uri;
    }

    private function redirectWithSuccess($user_id)
    {
        $user_role = $this->kcBase->getUserRoleById($user_id);
        // Determine the correct dashboard URL based on user role
        if ($user_role === $this->kcBase->getDoctorRole()) {
            $doctor_slug = KCOption::get('dashboard_slug_doctor', 'kivicare-doctor-dashboard');
            if(empty($doctor_slug)){
            $doctor_slug = 'kivicare-doctor-dashboard';
            }
            $redirect_url = home_url('index.php/' . $doctor_slug . '/setting/google-calendar-integration/');
        } elseif ($user_role === $this->kcBase->getReceptionistRole()) {
            $receptionist_slug = KCOption::get('dashboard_slug_receptionist', 'kivicare-receptionist-dashboard');
            if(empty($receptionist_slug)){
            $receptionist_slug = 'kivicare-receptionist-dashboard';
            }
            $redirect_url = home_url('index.php/' . $receptionist_slug . '/setting/google-calendar-integration/');
        }
        wp_redirect($redirect_url);
        exit;
    }

    private function redirectWithError($user_id, $error_code)
    {
        $user_role = $this->kcBase->getUserRoleById($user_id);
        // Determine the correct dashboard URL based on user role
        if ($user_role === $this->kcBase->getDoctorRole()) {
            $doctor_slug = KCOption::get('dashboard_slug_doctor', 'kivicare-doctor-dashboard');
            $redirect_url = home_url('index.php/' . $doctor_slug . '/setting/google-calendar-integration/');
        } elseif ($user_role === $this->kcBase->getReceptionistRole()) {
            $receptionist_slug = KCOption::get('dashboard_slug_receptionist', 'kivicare-receptionist-dashboard');
            $redirect_url = home_url('index.php/' . $receptionist_slug . '/setting/google-calendar-integration/');
        }
        wp_redirect($redirect_url . '?google_calendar_error=1&error_code=' . urlencode($error_code));
        exit;
    }

    protected function errorResponse($code, $message, $status)
    {
        return new WP_Error($code, __($message, 'kivicare-pro'), ['status' => $status]);
    }

    protected function handleAuthCallback(int $user_id, string $code): bool
    {
        try {
            $google_settings = KCOption::get('google_cal_setting', []);
            $redirect_uri = $this->getRedirectUri();

            if (empty($google_settings['client_id']) || empty($google_settings['client_secret'])) {
                return false;
            }

            $response = wp_remote_post($this->google_token_url, [
                'headers' => ['Content-Type' => 'application/x-www-form-urlencoded'],
                'body' => [
                    'code' => $code,
                    'client_id' => $google_settings['client_id'],
                    'client_secret' => $google_settings['client_secret'],
                    'redirect_uri' => $redirect_uri,
                    'grant_type' => 'authorization_code',
                ],
                'timeout' => 30,
            ]);

            if (is_wp_error($response)) {
                return false;
            }

            $response_code = wp_remote_retrieve_response_code($response);
            $body = wp_remote_retrieve_body($response);

            if ($response_code !== 200) {
                return false;
            }

            $token = json_decode($body, true);
            if (json_last_error() !== JSON_ERROR_NONE) {
                KCErrorLogger::instance()->error('JSON decode error in token response');
                return false;
            }

            if (!empty($token['access_token'])) {
                $token['created_at'] = time();
                $updated = update_user_meta($user_id, 'kc_google_calendar_token', $token);
                if ($updated !== false) {
                    return true;
                }
            }
            return false;
        } catch (Exception $e) {
            KCErrorLogger::instance()->error('Exception in token exchange: ' . $e->getMessage());
            return false;
        }
    }

    /**
     * Refresh access token if expired
     */
    private function refreshTokenIfNeeded($user_id, $token)
    {
        if (empty($token['refresh_token']) || empty($token['created_at'])) {
            return $token;
        }

        $expires_in = $token['expires_in'] ?? 3600;
        $is_expired = (time() - $token['created_at']) >= ($expires_in - 300); // Refresh 5 minutes before expiry

        if (!$is_expired) {
            return $token;
        }

        try {
            $google_settings = KCOption::get('google_cal_setting', []);

            $response = wp_remote_post($this->google_token_url, [
                'headers' => ['Content-Type' => 'application/x-www-form-urlencoded'],
                'body' => [
                    'client_id' => $google_settings['client_id'],
                    'client_secret' => $google_settings['client_secret'],
                    'refresh_token' => $token['refresh_token'],
                    'grant_type' => 'refresh_token',
                ],
                'timeout' => 30,
            ]);

            if (is_wp_error($response)) {
                return $token;
            }

            $response_code = wp_remote_retrieve_response_code($response);
            $body = wp_remote_retrieve_body($response);

            if ($response_code === 200) {
                $new_token = json_decode($body, true);
                if (!empty($new_token['access_token'])) {
                    $new_token['created_at'] = time();
                    $new_token['refresh_token'] = $token['refresh_token']; // Keep the original refresh token
                    update_user_meta($user_id, 'kc_google_calendar_token', $new_token);
                    return $new_token;
                }
            }
        } catch (Exception $e) {
            KCErrorLogger::instance()->error('Token refresh failed: ' . $e->getMessage());
        }

        return $token;
    }

    /**
     * Update calendar timezone to match WordPress timezone
     */
    private function updateCalendarTimezone($user_id)
    {
        try {
            $calendarInfo = $this->makeCalendarRequest('GET', '/users/me/calendarList/primary', $user_id);
            if ($calendarInfo && isset($calendarInfo['timeZone']) && $calendarInfo['timeZone'] !== wp_timezone_string()) {
                $this->makeCalendarRequest('PATCH', '/calendars/primary', $user_id, ['timeZone' => wp_timezone_string()]);
            }
        } catch (\Exception $e) {
            KCErrorLogger::instance()->error('Failed to update calendar timezone: ' . $e->getMessage());
        }
    }

    /**
     * Format datetime for Google Calendar API - returns datetime with timezone offset
     */
    private function formatDateTimeForGoogle($dateTimeString, $timezone = null)
    {
        try {
            $timezone = new \DateTimeZone($timezone ?? wp_timezone_string());
            $datetime = \DateTime::createFromFormat('Y-m-d\TH:i:s', $dateTimeString, $timezone);

            if (!$datetime) {
                $datetime = new \DateTime($dateTimeString, $timezone);
            }

            // Format with timezone offset included in the string
            return $datetime->format('c');
        } catch (\Exception $e) {
            KCErrorLogger::instance()->error('DateTime formatting error: ' . $e->getMessage());
            return $dateTimeString;
        }
    }

    /**
     * Make authenticated request to Google Calendar API
     */
    private function makeCalendarRequest($method, $endpoint, $user_id, $data = null)
    {
        $token = get_user_meta($user_id, 'kc_google_calendar_token', true);
        if (empty($token) || empty($token['access_token'])) {
            return null;
        }

        $token = $this->refreshTokenIfNeeded($user_id, $token);
        $url = $this->google_calendar_api . $endpoint;

        $args = [
            'headers' => [
                'Authorization' => 'Bearer ' . $token['access_token'],
                'Content-Type' => 'application/json',
            ],
            'timeout' => 30,
        ];

        if ($method === 'POST' || $method === 'PUT' || $method === 'PATCH') {
            $args['body'] = json_encode($data);
            $args['method'] = $method;
        } elseif ($method === 'DELETE') {
            $args['method'] = 'DELETE';
        } else {
            $args['method'] = 'GET';
        }

        $response = wp_remote_request($url, $args);

        if (is_wp_error($response)) {
            KCErrorLogger::instance()->error('Google Calendar API request failed: ' . $response->get_error_message());
            return null;
        }

        $response_code = wp_remote_retrieve_response_code($response);
        $body = wp_remote_retrieve_body($response);

        if ($response_code >= 200 && $response_code < 300) {
            return json_decode($body, true);
        } else {
            KCErrorLogger::instance()->error('Google Calendar API error: ' . $body);
            return null;
        }
    }

    /**
     * Get Google Calendar colorId based on appointment status
     *
     * @param int $status
     * @return string
     */
    private function getEventColorIdByStatus($status)
    {
        $default_colors = [
            'status_0' => '11', // Cancelled
            'status_1' => '9',  // Booked
            'status_2' => '5',  // Pending
            'status_3' => '8',  // Check-Out
            'status_4' => '2',  // Check-In
        ];

        $status_colors = KCOption::get('gcal_status_colors', $default_colors);

        $statusKey = 'status_' . $status;

        if (isset($status_colors[$statusKey])) {
            return $status_colors[$statusKey];
        }

        return '9'; // Default Blue
    }

    /**
     * Create a Google Calendar event for a specific user
     */
    private function createGoogleCalendarEvent($userId, $summary, $description, $startDateTime, $endDateTime, $clinic, $patientEmail, $doctorEmail, $status = null)
    {
        $timezone = get_user_meta($userId, 'timezone', true) ?: wp_timezone_string();
        $event_data = [
            'summary' => $summary,
            'location' => $clinic->address ?? '',
            'description' => $description,
            'start' => [
                'dateTime' => $this->formatDateTimeForGoogle($startDateTime, $timezone),
                'timeZone' => $timezone,
            ],
            'end' => [
                'dateTime' => $this->formatDateTimeForGoogle($endDateTime, $timezone),
                'timeZone' => $timezone,
            ],
            'attendees' => [
                ['email' => $patientEmail],
                ['email' => $doctorEmail],
            ],
            'reminders' => [
                'useDefault' => false,
                'overrides' => [
                    ['method' => 'email', 'minutes' => 60],
                    ['method' => 'popup', 'minutes' => 10],
                ],
            ],
        ];

        // 0: Cancelled, 1: Booked, 2: Pending, 3: Check-Out, 4: Check-In
        if ($status !== null) {
            $event_data['colorId'] = $this->getEventColorIdByStatus($status);
        }

        $response = $this->makeCalendarRequest('POST', '/calendars/primary/events', $userId, $event_data);

        if ($response && !empty($response['id'])) {
            return $response['id'];
        }

        return null;
    }

    /**
     * Update or create a Google Calendar event for a specific user
     */
    private function updateGoogleCalendarEvent($userId, $eventId, $summary, $description, $startDateTime, $endDateTime, $clinic, $patientEmail, $doctorEmail, $status = null)
    {
        // fix: Fetch existing summary if empty to preserve title
        if (empty($summary) && $eventId) {
            $existingEvent = $this->makeCalendarRequest('GET', '/calendars/primary/events/' . urlencode($eventId), $userId);
            if ($existingEvent && !empty($existingEvent['summary'])) {
                $summary = $existingEvent['summary'];
            }
        }
        $timezone = get_user_meta($userId, 'timezone', true) ?: wp_timezone_string();
        $event_data = [
            'summary' => $summary,
            'location' => $clinic->address ?? '',
            'description' => $description,
            'start' => [
                'dateTime' => $this->formatDateTimeForGoogle($startDateTime, $timezone),
                'timeZone' => $timezone,
            ],
            'end' => [
                'dateTime' => $this->formatDateTimeForGoogle($endDateTime, $timezone),
                'timeZone' => $timezone,
            ],
            'attendees' => [
                ['email' => $patientEmail],
                ['email' => $doctorEmail],
            ],
            'reminders' => [
                'useDefault' => false,
                'overrides' => [
                    ['method' => 'email', 'minutes' => 60],
                    ['method' => 'popup', 'minutes' => 10],
                ],
            ],
        ];

        if ($status !== null) {
            $event_data['colorId'] = $this->getEventColorIdByStatus($status);
        }

        // Try to update existing event
        if ($eventId) {
            // improvement: Use PATCH instead of PUT to avoid clearing fields not provided and be more efficient
            $response = $this->makeCalendarRequest('PATCH', '/calendars/primary/events/' . urlencode($eventId), $userId, $event_data);
            if ($response && !empty($response['id'])) {
                return $response['id'];
            }
            // If update fails (event not found), fall through to create new
        }

        // Create new event
        $response = $this->makeCalendarRequest('POST', '/calendars/primary/events', $userId, $event_data);

        if ($response && !empty($response['id'])) {
            return $response['id'];
        }

        return null;
    }

    /**
     * Add appointment event to Google Calendars of connected doctors and receptionists
     */
    public function addAppointmentToGoogleCalendars($appointmentId, $appointmentData, $clinic, $patient, $doctor, $services)
    {
        try {
            // Get patient and doctor details
            $patientUser = get_userdata($appointmentData['patientId']);
            $doctorUser = get_userdata($appointmentData['doctorId']);

            $patientName = $patientUser ? $patientUser->display_name : '';
            $patientEmail = $patientUser ? $patientUser->user_email : '';
            $doctorName = $doctorUser ? $doctorUser->display_name : '';
            $doctorEmail = $doctorUser ? $doctorUser->user_email : '';

            $startDateTime = $appointmentData['appointmentStartDate'] . 'T' . $appointmentData['appointmentStartTime'];
            $endDateTime = $appointmentData['appointmentEndDate'] . 'T' . $appointmentData['appointmentEndTime'];

            $template_doctor_posts = get_posts([
                'post_type' => KIVI_CARE_PREFIX . 'gcal_tmp',
                'name' => KIVI_CARE_PREFIX . 'doctor_gcal_template',
                'posts_per_page' => 1,
                'post_status' => 'publish'
            ]);
            $template_doctor = !empty($template_doctor_posts) ? $template_doctor_posts[0] : null;

            $template_receptionist_posts = get_posts([
                'post_type' => KIVI_CARE_PREFIX . 'gcal_tmp',
                'name' => KIVI_CARE_PREFIX . 'receptionist_gcal_template',
                'posts_per_page' => 1,
                'post_status' => 'publish'
            ]);
            $template_receptionist = !empty($template_receptionist_posts) ? $template_receptionist_posts[0] : null;

            // Fallback to default if role-based template not found
            if (!$template_doctor || !$template_receptionist) {
                $template_posts = get_posts([
                    'post_type' => KIVI_CARE_PREFIX . 'gcal_tmp',
                    'name' => KIVI_CARE_PREFIX . 'default_event_template',
                    'posts_per_page' => 1,
                    'post_status' => 'publish'
                ]);
                $template_default = !empty($template_posts) ? $template_posts[0] : null;
                if (!$template_doctor)         $template_doctor       = $template_default;
                if (!$template_receptionist)   $template_receptionist = $template_default;
            }

            if (($template_doctor || $template_receptionist) && class_exists(KCPNotificationTemplateProcessor::class)) {
                $processor = KCPNotificationTemplateProcessor::get_instance();

                $data = [
                    'appointment' => [
                        'appointment_start_date' => $appointmentData['appointmentStartDate'] ?? '',
                        'appointment_start_time' => $appointmentData['appointmentStartTime'] ?? '',
                        'id' => $appointmentId ?? '',
                        'service_name' => $services && !$services->isEmpty() ? implode(', ', $services->pluck('name')->toArray()) : '',
                        'total_amount' => $appointmentData['total_amount'] ?? '',
                    ],
                    'patient' => [
                        'display_name' => $patientName,
                        'email' => $patientEmail,
                        'mobile_number' => get_user_meta($appointmentData['patientId'], 'mobile_number', true) ?: '',
                    ],
                    'doctor' => [
                        'display_name' => $doctorName,
                        'email' => $doctorEmail,
                        'mobile_number' => get_user_meta($appointmentData['doctorId'], 'mobile_number', true) ?: '',
                    ],
                    'clinic' => [
                        'name' => $clinic->name ?? '',
                        'email' => $clinic->email ?? '',
                        'address' => $clinic->address ?? '',
                    ],
                    'appointment_desc' => $appointmentData['description'] ?? '',
                ];

                $summary_doctor = $template_doctor ? $processor->processTemplate($template_doctor->post_title, $data) : '';
                $description_doctor = $template_doctor ? $processor->processTemplate($template_doctor->post_content, $data) : '';

                $summary_receptionist = $template_receptionist ? $processor->processTemplate($template_receptionist->post_title, $data) : '';
                $description_receptionist = $template_receptionist ? $processor->processTemplate($template_receptionist->post_content, $data) : '';
            } else {
                // Prepare description
                $description_doctor = $appointmentData['description'] ?? '';
                $description_receptionist = $appointmentData['description'] ?? '';
                if ($services && !$services->isEmpty()) {
                    $services_text = "\n" . __('Services: ', 'kivicare-pro') . implode(', ', $services->pluck('name')->toArray());
                    $description_doctor .= $services_text;
                    $description_receptionist .= $services_text;
                }

                // Prepare summaries
                $summary_doctor = __('Appointment with ', 'kivicare-pro') . $patientName;
                $summary_receptionist = $doctorName . __('\'s appointment with ', 'kivicare-pro') . $patientName;
            }

            $telemed_link = '';
            $existing_gm_event_id = null;
            if (class_exists(KCTelemedFactory::class)) {
                $telemedProvider = KCTelemedFactory::get_provider_by_doctor_id($appointmentData['doctorId']);
                if ($telemedProvider && method_exists($telemedProvider, 'get_meeting_by_appointment')) {
                    $meeting = $telemedProvider->get_meeting_by_appointment($appointmentId);
                    if ($meeting) {
                        $telemed_link = $meeting->joinUrl ?? $meeting->join_url ?? $meeting->url ?? '';
                        if ($telemedProvider->get_provider_id() === 'googlemeet' && !empty($meeting->eventId) && $meeting->eventId !== -1) {
                            $existing_gm_event_id = $meeting->eventId;
                        }
                    }
                }
            }

            if (!empty($telemed_link)) {
                $link_text = "\n\n" . __('Meeting Link: ', 'kivicare-pro') . $telemed_link;
                $description_doctor .= $link_text;
                $description_receptionist .= $link_text;
            }

            $events = [];

            $status = $appointmentData['status'] ?? null;

            // Add to doctor's calendar if connected
            if (!empty($existing_gm_event_id)) {
                $eventId = $this->updateGoogleCalendarEvent($appointmentData['doctorId'], $existing_gm_event_id, $summary_doctor, $description_doctor, $startDateTime, $endDateTime, $clinic, $patientEmail, $doctorEmail, $status);
            } else {
                $eventId = $this->createGoogleCalendarEvent($appointmentData['doctorId'], $summary_doctor, $description_doctor, $startDateTime, $endDateTime, $clinic, $patientEmail, $doctorEmail, $status);
            }
            if ($eventId) {
                $events[$appointmentData['doctorId']] = $eventId;
            }

            // Add to all receptionists' calendars in the clinic if connected
            $mappings = [];
            if (!empty($appointmentData['clinicId'])) {
                $mappings = KCReceptionistClinicMapping::query()->where('clinicId', $appointmentData['clinicId'])->get();
            }
            foreach ($mappings as $mapping) {
                $eventId = $this->createGoogleCalendarEvent($mapping->receptionistId, $summary_receptionist, $description_receptionist, $startDateTime, $endDateTime, $clinic, $patientEmail, $doctorEmail, $status);
                if ($eventId) {
                    $events[$mapping->receptionistId] = $eventId;
                }
            }

            if (!empty($events)) {
                update_option('kc_appointment_google_events_' . $appointmentId, json_encode($events));
                // Build reverse lookup: event_id => appointment_id
                foreach ($events as $userId => $eventId) {
                    update_option('kc_gcal_event_to_appointment_' . $eventId, $appointmentId, false);
                }
            }
        } catch (Exception $e) {
            // Log error but do not fail the appointment creation
            KCErrorLogger::instance()->error('Google Calendar Sync Error: ' . $e->getMessage());
            KCErrorLogger::instance()->error('Stack trace: ' . $e->getTraceAsString());
        }
    }

    /**
     * Update appointment event in Google Calendars of connected doctors and receptionists
     */
    public function updateAppointmentToGoogleCalendars($appointmentId, $appointmentData, $clinic, $patient, $doctor, $services)
    {
        try {
            // Get stored events
            $storedEventsJson = get_option('kc_appointment_google_events_' . $appointmentId, '{}');
            $storedEvents = json_decode($storedEventsJson, true) ?? [];

            // Get patient and doctor details
            $patientUser = get_userdata($appointmentData['patientId']);
            $doctorUser = get_userdata($appointmentData['doctorId']);

            $patientName = $patientUser ? $patientUser->display_name : '';
            $patientEmail = $patientUser ? $patientUser->user_email : '';
            $doctorName = $doctorUser ? $doctorUser->display_name : '';
            $doctorEmail = $doctorUser ? $doctorUser->user_email : '';

            $startDateTime = $appointmentData['appointmentStartDate'] . 'T' . $appointmentData['appointmentStartTime'];
            $endDateTime = $appointmentData['appointmentEndDate'] . 'T' . $appointmentData['appointmentEndTime'];

            $template_doctor_posts = get_posts([
                'post_type' => KIVI_CARE_PREFIX . 'gcal_tmp',
                'name' => KIVI_CARE_PREFIX . 'doctor_gcal_template',
                'posts_per_page' => 1,
                'post_status' => 'publish'
            ]);
            $template_doctor = !empty($template_doctor_posts) ? $template_doctor_posts[0] : null;

            $template_receptionist_posts = get_posts([
                'post_type' => KIVI_CARE_PREFIX . 'gcal_tmp',
                'name' => KIVI_CARE_PREFIX . 'receptionist_gcal_template',
                'posts_per_page' => 1,
                'post_status' => 'publish'
            ]);
            $template_receptionist = !empty($template_receptionist_posts) ? $template_receptionist_posts[0] : null;

            // Fallback to default if role-based template not found
            if (!$template_doctor || !$template_receptionist) {
                $template_posts = get_posts([
                    'post_type' => KIVI_CARE_PREFIX . 'gcal_tmp',
                    'name' => KIVI_CARE_PREFIX . 'default_event_template',
                    'posts_per_page' => 1,
                    'post_status' => 'publish'
                ]);
                $template_default = !empty($template_posts) ? $template_posts[0] : null;
                if (!$template_doctor)         $template_doctor       = $template_default;
                if (!$template_receptionist)   $template_receptionist = $template_default;
            }

            if (($template_doctor || $template_receptionist) && class_exists(KCPNotificationTemplateProcessor::class)) {
                $processor = KCPNotificationTemplateProcessor::get_instance();

                $data = [
                    'appointment' => [
                        'appointment_start_date' => $appointmentData['appointmentStartDate'] ?? '',
                        'appointment_start_time' => $appointmentData['appointmentStartTime'] ?? '',
                        'id' => $appointmentId ?? '',
                        'service_name' => $services && !$services->isEmpty() ? implode(', ', $services->pluck('name')->toArray()) : '',
                        'total_amount' => $appointmentData['total_amount'] ?? '',
                    ],
                    'patient' => [
                        'display_name' => $patientName,
                        'email' => $patientEmail,
                        'mobile_number' => get_user_meta($appointmentData['patientId'], 'mobile_number', true) ?: '',
                    ],
                    'doctor' => [
                        'display_name' => $doctorName,
                        'email' => $doctorEmail,
                        'mobile_number' => get_user_meta($appointmentData['doctorId'], 'mobile_number', true) ?: '',
                    ],
                    'clinic' => [
                        'name' => $clinic->name ?? '',
                        'email' => $clinic->email ?? '',
                        'address' => $clinic->address ?? '',
                    ],
                    'appointment_desc' => $appointmentData['description'] ?? '',
                ];

                $summary_doctor = $template_doctor ? $processor->processTemplate($template_doctor->post_title, $data) : '';
                $description_doctor = $template_doctor ? $processor->processTemplate($template_doctor->post_content, $data) : '';

                $summary_receptionist = $template_receptionist ? $processor->processTemplate($template_receptionist->post_title, $data) : '';
                $description_receptionist = $template_receptionist ? $processor->processTemplate($template_receptionist->post_content, $data) : '';
            } else {
                // Prepare description
                $description_doctor = $appointmentData['description'] ?? '';
                $description_receptionist = $appointmentData['description'] ?? '';
                if ($services && !$services->isEmpty()) {
                    $services_text = "\n" . __('Services: ', 'kivicare-pro') . implode(', ', $services->pluck('name')->toArray());
                    $description_doctor .= $services_text;
                    $description_receptionist .= $services_text;
                }

                // Prepare summaries
                $summary_doctor = __('Appointment with ', 'kivicare-pro') . $patientName;
                $summary_receptionist = $doctorName . __('\'s appointment with ', 'kivicare-pro') . $patientName;
            }

            // Check for existing Google Meet event to avoid creating a duplicate.
            // Google Meet creates its own calendar event on the doctor's account — we must
            // update THAT event (by patching it with title/description) rather than creating a new one.
            $telemed_link = '';
            $existing_gm_event_id = null;
            if (class_exists(KCTelemedFactory::class)) {
                $telemedProvider = KCTelemedFactory::get_provider_by_doctor_id($appointmentData['doctorId']);
                if ($telemedProvider && method_exists($telemedProvider, 'get_meeting_by_appointment')) {
                    $meeting = $telemedProvider->get_meeting_by_appointment($appointmentId);
                    if ($meeting) {
                        $telemed_link = $meeting->joinUrl ?? $meeting->join_url ?? $meeting->url ?? '';
                        // If provider is Google Meet, grab the existing calendar event ID
                        if (
                            method_exists($telemedProvider, 'get_provider_id') &&
                            $telemedProvider->get_provider_id() === 'googlemeet' &&
                            !empty($meeting->eventId) &&
                            $meeting->eventId !== -1
                        ) {
                            $existing_gm_event_id = $meeting->eventId;
                        }
                    }
                }
            }

            if (!empty($telemed_link)) {
                $link_text = "\n\n" . __('Meeting Link: ', 'kivicare-pro') . $telemed_link;
                $description_doctor .= $link_text;
                $description_receptionist .= $link_text;
            }

            $status = $appointmentData['status'] ?? null;

            // For the doctor: prefer the stored event ID, then fall back to the Google Meet event ID.
            // This prevents creating a 2nd event when Google Meet already owns one.
            $doctor_event_id = $storedEvents[$appointmentData['doctorId']] ?? $existing_gm_event_id ?? null;

            // Update doctor's calendar if connected
            $newEventId = $this->updateGoogleCalendarEvent(
                $appointmentData['doctorId'],
                $doctor_event_id,
                $summary_doctor,
                $description_doctor,
                $startDateTime,
                $endDateTime,
                $clinic,
                $patientEmail,
                $doctorEmail,
                $status
            );
            if ($newEventId) {
                $storedEvents[$appointmentData['doctorId']] = $newEventId;
            }

            // Update all receptionists' calendars in the clinic if connected
            $mappings = [];
            if (!empty($appointmentData['clinicId'])) {
                $mappings = KCReceptionistClinicMapping::query()->where('clinicId', $appointmentData['clinicId'])->get();
            }
            foreach ($mappings as $mapping) {
                $recId = $mapping->receptionistId;
                $newEventId = $this->updateGoogleCalendarEvent(
                    $recId,
                    $storedEvents[$recId] ?? null,
                    $summary_receptionist,
                    $description_receptionist,
                    $startDateTime,
                    $endDateTime,
                    $clinic,
                    $patientEmail,
                    $doctorEmail,
                    $status
                );
                if ($newEventId) {
                    $storedEvents[$recId] = $newEventId;
                }
            }

            // Update stored events and rebuild reverse lookup
            if (!empty($storedEvents)) {
                update_option('kc_appointment_google_events_' . $appointmentId, json_encode($storedEvents));
                foreach ($storedEvents as $uid => $eid) {
                    update_option('kc_gcal_event_to_appointment_' . $eid, $appointmentId, false);
                }
            }
        } catch (Exception $e) {
            KCErrorLogger::instance()->error('Google Calendar Update Sync Error: ' . $e->getMessage());
            KCErrorLogger::instance()->error('Stack trace: ' . $e->getTraceAsString());
        }
    }



    /**
     * Delete appointment event from Google Calendars of connected doctors and receptionists
     */
    public function deleteAppointmentFromGoogleCalendars($appointmentId)
    {
        try {
            // Get stored events
            $storedEventsJson = get_option('kc_appointment_google_events_' . $appointmentId, '{}');
            $storedEvents = json_decode($storedEventsJson, true) ?? [];

            if (empty($storedEvents)) {
                return;
            }

            foreach ($storedEvents as $userId => $eventId) {
                if (!empty($eventId)) {
                    $this->makeCalendarRequest('DELETE', '/calendars/primary/events/' . urlencode($eventId), $userId);
                }
            }

            delete_option('kc_appointment_google_events_' . $appointmentId);
        } catch (Exception $e) {
            KCErrorLogger::instance()->error('Google Calendar Delete Sync Error: ' . $e->getMessage());
        }
    }

    /**
     * Get busy slots for a specific user and date range from Google Calendar
     * 
     * @param int $userId
     * @param string $startDate Y-m-d
     * @param string $endDate Y-m-d
     * @return array Busy intervals [ ['start' => '...', 'end' => '...'], ... ]
     */
    public function getGoogleBusySlotsForRange($userId, $startDate, $endDate)
    {
        $cacheKey = 'kc_gcal_events_range_' . $userId . '_' . md5($startDate . $endDate);
        $cachedData = get_transient($cacheKey);

        if ($cachedData !== false) {
            return $cachedData;
        }

        try {
            $timezone = get_user_meta($userId, 'timezone', true) ?: wp_timezone_string();
            
            // Set time boundaries for the requested range
            $timeMin = $this->formatDateTimeForGoogle($startDate . 'T00:00:00', $timezone);
            $timeMax = $this->formatDateTimeForGoogle($endDate . 'T23:59:59', $timezone);

            // Using list API instead of freebusy to get event titles (summary)
            $endpoint = '/calendars/primary/events?' . http_build_query([
                'timeMin' => $timeMin,
                'timeMax' => $timeMax,
                'singleEvents' => 'true',
                'orderBy' => 'startTime',
                'maxResults' => 250 // Sufficient for a month of busy slots
            ]);

            $response = $this->makeCalendarRequest('GET', $endpoint, $userId);

            $busySlots = [];
            if ($response && isset($response['items'])) {
                foreach ($response['items'] as $event) {
                    $start = isset($event['start']['dateTime']) ? $event['start']['dateTime'] : ($event['start']['date'] . 'T00:00:00Z');
                    $end = isset($event['end']['dateTime']) ? $event['end']['dateTime'] : ($event['end']['date'] . 'T23:59:59Z');
                    
                    $startObj = new \DateTime($start);
                    $endObj = new \DateTime($end);
                    
                    // Set to doctor's timezone for consistency
                    $doctorTz = new \DateTimeZone($timezone);
                    $startObj->setTimezone($doctorTz);
                    $endObj->setTimezone($doctorTz);

                    $busySlots[] = [
                        'start' => $startObj->format('Y-m-d H:i:s'),
                        'end'   => $endObj->format('Y-m-d H:i:s'),
                        'name'  => $event['summary'] ?? __('Busy', 'kivicare-clinic-management-system'),
                    ];
                }
            }

            // Cache for 10 minutes
            set_transient($cacheKey, $busySlots, 10 * MINUTE_IN_SECONDS);

            return $busySlots;
        } catch (Exception $e) {
            KCErrorLogger::instance()->error('Google Calendar Events Range Error: ' . $e->getMessage());
            return [];
        }
    }

    /**
     * Get busy slots for a specific user and date from Google Calendar
     * 
     * @param int $userId
     * @param string $date Y-m-d
     * @return array Busy intervals [ ['start' => '...', 'end' => '...'], ... ]
     */
    public function getGoogleBusySlots($userId, $date)
    {
        return $this->getGoogleBusySlotsForRange($userId, $date, $date);
    }

    // =========================================================================
    // GOOGLE PUSH NOTIFICATION CHANNELS
    // =========================================================================

    /**
     * Register a Google push-notification watch channel for the given user's primary calendar.
     * Stores channel metadata in user meta `kc_gcal_channel`.
     */
    public function registerGooglePushChannel(int $userId): bool
    {
        try {
            // Stop old channel before registering a new one to prevent duplicate webhooks
            $this->stopGooglePushChannel($userId);

            $webhookUrl = rest_url('kivicare/v1/' . $this->route . '/webhook');
            if (is_ssl()) {
                $webhookUrl = preg_replace('/^http:/i', 'https:', $webhookUrl);
            }

            $channelId = 'kc-gcal-' . $userId . '-' . wp_generate_password(8, false);

            $response = $this->makeCalendarRequest('POST', '/calendars/primary/events/watch', $userId, [
                'id'      => $channelId,
                'type'    => 'web_hook',
                'address' => $webhookUrl,
                'params'  => ['ttl' => '604800'], // 7 days (max Google allows)
            ]);

            if ($response && !empty($response['id'])) {
                update_user_meta($userId, 'kc_gcal_channel', [
                    'channel_id'  => $response['id'],
                    'resource_id' => $response['resourceId'] ?? '',
                    'expiry'      => $response['expiration'] ?? (time() + 604800) * 1000,
                ]);
                return true;
            }

        } catch (Exception $e) {
            KCErrorLogger::instance()->error('Register push channel error: ' . $e->getMessage());
        }
        return false;
    }

    /**
     * Stop a previously registered push-notification channel for the given user.
     */
    public function stopGooglePushChannel(int $userId): void
    {
        $channelInfo = get_user_meta($userId, 'kc_gcal_channel', true);
        if (empty($channelInfo['channel_id']) || empty($channelInfo['resource_id'])) {
            return;
        }

        try {
            $this->makeCalendarRequest('POST', '/channels/stop', $userId, [
                'id'         => $channelInfo['channel_id'],
                'resourceId' => $channelInfo['resource_id'],
            ]);
        } catch (Exception $e) {
            KCErrorLogger::instance()->error('Stop push channel error: ' . $e->getMessage());
        }

        delete_user_meta($userId, 'kc_gcal_channel');
    }

    /**
     * WP Cron callback: renew push channels that expire within 24 hours.
     */
    public function renewExpiredPushChannels(): void
    {
        // Find all users who have a stored channel using the model
        $metas = KCUserMeta::query()
            ->where('meta_key', 'kc_gcal_channel')
            ->get();

        $userIds = $metas->pluck('userId')->unique();

        $threshold = (time() + 86400) * 1000; // 24 hours from now in milliseconds

        foreach ($userIds as $userId) {
            $userId = (int) $userId;
            $channelInfo = get_user_meta($userId, 'kc_gcal_channel', true);
            if (empty($channelInfo['expiry'])) {
                continue;
            }

            if ((int) $channelInfo['expiry'] <= $threshold) {
                // Stop old channel and register a fresh one
                $this->stopGooglePushChannel($userId);
                $this->registerGooglePushChannel($userId);
            }
        }
    }

    // =========================================================================
    // WEBHOOK HANDLER
    // =========================================================================

    /**
     * Handle incoming push notifications from Google Calendar.
     * Google sends POST requests with X-Goog-Channel-ID and X-Goog-Resource-State headers.
     */
    public function handleWebhook(WP_REST_Request $request): WP_REST_Response
    {
        $channelId     = $request->get_header('X-Goog-Channel-ID');
        $resourceState = $request->get_header('X-Goog-Resource-State');


        // 'sync' is just a handshake confirmation — nothing to do
        if ($resourceState === 'sync') {
            return new WP_REST_Response(['ok' => true], 200);
        }

        if ($resourceState !== 'exists' || empty($channelId)) {
            return new WP_REST_Response(['ok' => true], 200);
        }

        // Resolve doctor from channel ID
        $doctorId = $this->getDoctorIdFromChannelId($channelId);
        if (!$doctorId) {
            return new WP_REST_Response(['ok' => true], 200);
        }


        $args = ['doctor_id' => $doctorId];

        // Process in background to return 200 to Google quickly
        if (function_exists('as_enqueue_async_action')) {
            $jobId = as_enqueue_async_action(
                'kc_gcal_process_event_change',
                $args,
                'kivicare-gcal-sync'
            );
        } else {
            // Fallback to standard WP Cron if Action Scheduler is not available
            wp_schedule_single_event(time(), 'kc_gcal_process_event_change', [$args]);
        }

        return new WP_REST_Response(['ok' => true], 200);
    }

    /**
     * Resolve doctor user ID from a Google push channel ID.
     */
    private function getDoctorIdFromChannelId(string $channelId): ?int
    {
        try {
            $metas = KCUserMeta::query()
                ->where('meta_key', 'kc_gcal_channel')
                ->get();

            foreach ($metas as $meta) {
                $data = maybe_unserialize($meta->metaValue);
                if (is_array($data) && ($data['channel_id'] ?? '') === $channelId) {
                    error_log("[KC GCal Webhook] Resolved Doctor ID: {$meta->userId}");
                    return (int) $meta->userId;
                }
            }
        } catch (\Throwable $e) {
            error_log("[KC GCal Webhook] Fatal Error in doctor resolution: " . $e->getMessage());
        }
        
        return null;
    }

    // =========================================================================
    // EVENT CHANGE HANDLER
    // =========================================================================

    /**
     * Action Scheduler callback: detect which appointment's linked event changed,
     * then update the appointment or revert the Google event.
     */
    public function handleGoogleEventChange($args): void
    {
        // Handle both array input or direct doctor_id (Action Scheduler/WP Cron mapping)
        if (is_numeric($args)) {
            $doctorId = (int)$args;
            $args     = ['doctor_id' => $doctorId];
        } else {
            $doctorId = (int) ($args['doctor_id'] ?? 0);
        }

        if (!$doctorId) {
            return;
        }

        // Check if two-way sync is enabled
        $googlecalData = KCOption::get('google_cal_setting', []);
        if (is_string($googlecalData)) {
            $googlecalData = json_decode($googlecalData, true) ?: [];
        }
        $enableTwoWaySync = !empty($googlecalData['enableTwoWaySync']);

        if (!$enableTwoWaySync) {
            KCErrorLogger::instance()->info("[KC GCal Webhook] Two-way sync is disabled. Skipping event change processing.");
            return;
        }


        try {
            // If events are already passed (polling path), use them directly
            if (!empty($args['events']) && is_array($args['events'])) {
                $items = $args['events'];
            } else {
                // Webhook path: fetch events updated in last 3 minutes
                $timezone   = get_user_meta($doctorId, 'timezone', true) ?: wp_timezone_string();
                $now        = new \DateTime('now', new \DateTimeZone($timezone));
                $updatedMin = (clone $now)->modify('-3 minutes')->format('c');


                $endpoint = '/calendars/primary/events?' . http_build_query([
                    'updatedMin'   => $updatedMin,
                    'singleEvents' => 'true',
                    'showDeleted'  => 'false',
                    'maxResults'   => 50,
                ]);

                $response = $this->makeCalendarRequest('GET', $endpoint, $doctorId);

                if (empty($response['items'])) {
                    return;
                }

                $items = $response['items'];
            }

            foreach ($items as $event) {
                $eventId = $event['id'] ?? null;
                if (!$eventId) {
                    continue;
                }

                $appointmentId = get_option('kc_gcal_event_to_appointment_' . $eventId);

                if (!$appointmentId) {
                    continue;
                }

                $appointment = KCAppointment::find((int) $appointmentId);
                if (!$appointment || !($appointment instanceof KCAppointment)) {
                    continue;
                }

                if (!in_array((int) $appointment->status, [
                    KCAppointment::STATUS_BOOKED,
                    KCAppointment::STATUS_PENDING,
                    KCAppointment::STATUS_CHECK_IN,
                ], true)) {
                    continue;
                }

                $this->processEventTimeChange($appointment, $event, $doctorId);
            }
        } catch (Exception $e) {
            KCErrorLogger::instance()->error('handleGoogleEventChange error: ' . $e->getMessage());
        }
    }

    /**
     * Compare a changed Google event against the stored appointment time.
     * If the time changed, attempt to reschedule or revert.
     */
    private function processEventTimeChange(KCAppointment $appointment, array $event, int $doctorId): void
    {
        try {
            $doctorTz = new \DateTimeZone(
                get_user_meta($doctorId, 'timezone', true) ?: wp_timezone_string()
            );

            // Parse new start/end from the event
            $newStartRaw = $event['start']['dateTime'] ?? ($event['start']['date'] . 'T00:00:00');
            $newEndRaw   = $event['end']['dateTime']   ?? ($event['end']['date']   . 'T23:59:59');

            $newStart = (new \DateTime($newStartRaw))->setTimezone($doctorTz);
            $newEnd   = (new \DateTime($newEndRaw))->setTimezone($doctorTz);

            $newDate      = $newStart->format('Y-m-d');
            $newStartTime = $newStart->format('H:i:s');
            $newEndDate   = $newEnd->format('Y-m-d');
            $newEndTime   = $newEnd->format('H:i:s');

            // Check if time actually changed
            if (
                $appointment->appointmentStartDate === $newDate &&
                $appointment->appointmentStartTime === $newStartTime &&
                $appointment->appointmentEndDate   === $newEndDate &&
                $appointment->appointmentEndTime   === $newEndTime
            ) {
                return; // No time change — nothing to do
            }

            // Fetch service IDs for this appointment to pass to availability check
            $serviceIds = KCAppointmentServiceMapping::query()
                ->where('appointmentId', $appointment->id)
                ->get()
                ->pluck('serviceId')
                ->toArray();

            $slotAvailable = $this->isSlotAvailable(
                $doctorId,
                (int) $appointment->clinicId,
                $newDate,
                $newStartTime,
                $newEndTime,
                (int) $appointment->id,
                $serviceIds
            );

            if ($slotAvailable) {
                $this->rescheduleAppointment($appointment, $newDate, $newStartTime, $newEndDate, $newEndTime, $doctorId);
            } else {
                $this->revertGoogleEvent($appointment, $doctorId, $event['id']);
            }
        } catch (Exception $e) {
            KCErrorLogger::instance()->error('processEventTimeChange error: ' . $e->getMessage());
        }
    }

    /**
     * Check whether the given time slot is free for the doctor (excluding the current appointment).
     */
    private function isSlotAvailable(
        int $doctorId,
        int $clinicId,
        string $date,
        string $startTime,
        string $endTime,
        int $excludeAppointmentId = 0,
        array $serviceIds = []
    ): bool {
        try {

            $serviceMappingIds = KCServiceDoctorMapping::query()
                ->where('doctor_id', $doctorId)
                ->where('clinic_id', (int) $clinicId)
                ->whereIn('service_id', $serviceIds)
                ->get()
                ->pluck('id')
                ->toArray();

            // Prepare data using the standard appointment data service
            $slotData = KCAppointmentDataService::prepareSlotGenerationData([
                'doctor_id'      => $doctorId,
                'clinic_id'      => $clinicId,
                'date'           => $date,
                'service_id'     => $serviceMappingIds,
                'appointment_id' => $excludeAppointmentId
            ]);

            // Initialize the time slot service with prepared data
            $slotGenerator = new KCTimeSlotService($slotData);

            // Check if the requested slot is available
            // Note: slotStart expects "Y-m-d H:i:s" or similar standard date format
            return $slotGenerator->isSlotAvailable($date . ' ' . $startTime);
        } catch (Exception $e) {
            KCErrorLogger::instance()->error('isSlotAvailable error: ' . $e->getMessage());
            return false;
        }
    }

    /**
     * Update the KiviCare appointment to the new time and notify patient + doctor.
     */
    private function rescheduleAppointment(
        KCAppointment $appointment,
        string $newDate,
        string $newStartTime,
        string $newEndDate,
        string $newEndTime,
        int $doctorId
    ): void {
        try {
            $appointment->appointmentStartDate = $newDate;
            $appointment->appointmentStartTime = $newStartTime;
            $appointment->appointmentEndDate   = $newEndDate;
            $appointment->appointmentEndTime   = $newEndTime;
            $appointment->save();

            // Invalidate Google Calendar event cache for this doctor
            $this->clearGoogleEventCache($doctorId, $newDate);

            // Send notifications to patient and doctor
            $options = ['channels' => ['twilio', 'email', 'push']];

            // Notify patient
            KCPNotificationInit::get_instance()->notify(
                KIVI_CARE_PREFIX . 'appointment_rescheduled_by_gcal',
                ['appointment_id' => $appointment->id, 'recipient_type' => 'patient'],
                $options
            );

            // Notify doctor
            KCPNotificationInit::get_instance()->notify(
                KIVI_CARE_PREFIX . 'doctor_appointment_rescheduled_by_gcal',
                ['appointment_id' => $appointment->id, 'recipient_type' => 'doctor'],
                $options
            );

            KCErrorLogger::instance()->info(
                "Appointment #{$appointment->id} rescheduled via Google Calendar to {$newDate} {$newStartTime}"
            );
        } catch (Exception $e) {
            KCErrorLogger::instance()->error('rescheduleAppointment error: ' . $e->getMessage());
        }
    }

    /**
     * Revert the Google Calendar event back to the original appointment time
     * and notify the doctor that the reschedule was rejected.
     */
    private function revertGoogleEvent(
        KCAppointment $appointment,
        int $doctorId,
        string $eventId
    ): void {
        try {
            // Restore the event time to match the stored appointment
            $timezone = get_user_meta($doctorId, 'timezone', true) ?: wp_timezone_string();
            $originalStart = $appointment->appointmentStartDate . 'T' . $appointment->appointmentStartTime;
            $originalEnd   = $appointment->appointmentEndDate   . 'T' . $appointment->appointmentEndTime;

            $this->makeCalendarRequest('PATCH', '/calendars/primary/events/' . urlencode($eventId), $doctorId, [
                'start' => [
                    'dateTime' => $this->formatDateTimeForGoogle($originalStart, $timezone),
                    'timeZone' => $timezone,
                ],
                'end' => [
                    'dateTime' => $this->formatDateTimeForGoogle($originalEnd, $timezone),
                    'timeZone' => $timezone,
                ],
            ]);

            // Notify doctor that the slot was unavailable and event was reverted
            KCPNotificationInit::get_instance()->notify(
                KIVI_CARE_PREFIX . 'appointment_gcal_revert',
                ['appointment_id' => $appointment->id, 'recipient_type' => 'doctor'],
                ['channels' => ['twilio', 'email', 'push']]
            );

            KCErrorLogger::instance()->info(
                "Appointment #{$appointment->id}: Google event {$eventId} reverted — new slot was unavailable."
            );
        } catch (Exception $e) {
            KCErrorLogger::instance()->error('revertGoogleEvent error: ' . $e->getMessage());
        }
    }

    /**
     * Clear the Google event transient cache for the given doctor and date.
     */
    private function clearGoogleEventCache(int $doctorId, string $date): void
    {
        $pattern = '_transient_kc_gcal_events_range_' . $doctorId . '_%';
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
    }
}