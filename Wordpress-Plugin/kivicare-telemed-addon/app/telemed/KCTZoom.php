<?php
namespace KCTApp\telemed;

use App\abstracts\KCAbstractTelemedProvider;
use App\baseClasses\KCBase;
use App\models\KCAppointment;
use KCTApp\models\KCTAppointmentZoomMapping;
use WP_Error;

if (!defined('ABSPATH')) {
    exit; // Exit if accessed directly
}

/**
 * Zoom Provider for Telemedical Services
 * Implements Zoom API integration for video consultations
 */
class KCTZoom extends KCAbstractTelemedProvider
{
    /**
     * Zoom API base URL
     */
    private const API_BASE_URL = 'https://api.zoom.us/v2/';

    private const OAUTH_AUTHORIZE_URL = 'https://zoom.us/oauth/authorize';
    private const OAUTH_TOKEN_URL = 'https://zoom.us/oauth/token';


    private $doctor_id;
    /**
     * Get provider ID
     * @return string Provider identifier
     */
    public function get_provider_id(): string
    {
        return 'zoom';
    }

    /**
     * Get provider name
     * @return string Provider display name
     */
    public function get_provider_name(): string
    {
        return 'Zoom Meetings';
    }

    /**
     * Get default configuration
     * @return array Default configuration
     */
    protected function get_default_config(): array
    {
        return [
            'enableCal' => 'No',
            'client_id' => '',
            'client_secret' => '',
            'redirect_url' => rest_url('kivicare/v1/settings/zoom-telemed/callback'),

            'auth_type' => 'oauth', // 'oauth' or 'server to server'
            'account_id' => '',
            'default_settings' => [
                'host_video' => true,
                'participant_video' => true,
                'join_before_host' => true,
                'mute_upon_entry' => true,
                'waiting_room' => true,
                'auto_recording' => 'none', // 'none', 'local', 'cloud'
                'meeting_authentication' => false,
                'approval_type' => 2, // 0=Automatically approve, 1=Manually approve, 2=No registration required
            ],
            'webhook_url' => '',
            'webhook_secret' => ''
        ];
    }

    /**
     * Check if provider is enabled.
     * checks the 'enableCal' key from the loaded config.
     * @return bool True if provider is enabled
     */
    public function is_enabled()
    {
        // This function is called to determine if the menu item should be shown.
        // It must correctly read the legacy `enableCal` key.
        $is_globally_enabled = (!empty($this->config['enableCal']) && $this->config['enableCal'] === 'Yes');

        return $is_globally_enabled && $this->is_configured();
    }

    /**
     * Check if provider is properly configured
     * @return bool True if provider has required configuration
     */
    public function is_configured(): bool
    {
        $auth_type = $this->get_config_value('auth_type');

        if ($auth_type === 'oauth') {
            return !empty($this->get_config_value('client_id')) &&
                !empty($this->get_config_value('client_secret'));
        }

        if ($auth_type === 'server-to-server') {
            return !empty($this->get_config_value('account_id')) &&
                !empty($this->get_config_value('client_id')) &&
                !empty($this->get_config_value('client_secret'));
        }

        // This part is for the old, deprecated JWT method. It is safe to keep.
        if (!empty($this->get_config_value('api_key')) && !empty($this->get_config_value('api_secret'))) {
            return true;
        }

        // If no valid configuration is found, return false.
        return false;
    }

    public function get_doctor_config(int $doctor_id): array
    {
        $legacy_key = 'zoom_server_to_server_oauth_config_data';
        $new_key = 'zoom_telemed_config';

        // Prioritize reading from the legacy key for consistency
        $legacy_config_json = get_user_meta($doctor_id, $legacy_key, true);

        if (!empty($legacy_config_json)) {
            $config = json_decode($legacy_config_json, true);
            // Translate legacy format to the new format for internal use
            $auth_type = 'none';
            if (isset($config['enableServerToServerOauthconfig']) && ($config['enableServerToServerOauthconfig'] === 'true' || $config['enableServerToServerOauthconfig'] === true)) {
                $auth_type = 'server-to-server';
            }
            $config['auth_type'] = $auth_type;

        } else {
            // Fallback to reading from the new key if legacy one is not found
            $config = get_user_meta($doctor_id, $new_key, true);
        }

        if (empty($config)) {
            return [];
        }

        // Return a consistent format that the rest of the new application expects
        return [
            'account_id' => $config['account_id'] ?? '',
            'client_id' => $config['client_id'] ?? '',
            'client_secret' => $config['client_secret'] ?? '',
            'auth_type' => $config['auth_type'] ?? 'none',
            'default_settings' => $config['default_settings'] ?? []
        ];
    }

    /**
     * Update Zoom configuration for a doctor
     *
     * @param int $doctor_id Doctor user ID
     * @param array $config Configuration data to update
     * @return bool True on success, false on failure
     */
    public function update_doctor_config(int $doctor_id, array $config): bool
    {
        $legacy_key = 'zoom_server_to_server_oauth_config_data';
        $new_key = 'zoom_telemed_config';

        // Translate the new application format to the old legacy format
        $legacy_data_to_save = [
            'enableServerToServerOauthconfig' => ($config['auth_type'] === 'server-to-server') ? 'true' : 'false',
            'account_id'       => $config['account_id'] ?? '',
            'client_id'        => $config['client_id'] ?? '',
            'client_secret'    => $config['client_secret'] ?? '',
        ];

        $json_to_save = json_encode($legacy_data_to_save);

        // Save under the legacy key
        $result = update_user_meta($doctor_id, $legacy_key, $json_to_save);

        // Clean up: remove the new key to avoid conflicts
        delete_user_meta($doctor_id, $new_key);

        return $result !== false;
    }

    /**
     * Check if provider supports recording
     * @return bool True if recording is supported
     */
    public function supports_recording(): bool
    {
        return true;
    }

    /**
     * Check if provider supports waiting room
     * @return bool True if waiting room is supported
     */
    public function supports_waiting_room(): bool
    {
        return true;
    }

    /**
     * Check if provider supports password protection
     * @return bool True if password protection is supported
     */
    public function supports_password(): bool
    {
        return true;
    }

    /**
     * Get supported meeting types
     * @return array Array of supported meeting types
     */
    public function get_supported_meeting_types(): array
    {
        return ['instant', 'scheduled', 'recurring'];
    }

    /**
     * Get maximum meeting duration (in minutes)
     * @return int Maximum duration in minutes, 0 for unlimited
     */
    public function get_max_duration(): int
    {
        // Basic plans have 40-minute limit for group meetings
        // Pro and above have no limit
        return 0; // Return 0 for unlimited, implement plan checking if needed
    }

    /**
     * Get maximum participants
     * @return int Maximum participants, 0 for unlimited
     */
    public function get_max_participants(): int
    {
        // Varies by plan: Basic (100), Pro (100), Business (300), Enterprise (500)
        return 100; // Default to basic plan limit
    }

    /**
     * Create a meeting
     * @param array $meeting_data Meeting configuration
     * @return array|WP_Error Meeting details or WP_Error on failure
     */
    public function create_meeting($meeting_data = array()): array|WP_Error
    {
        try {
            $formatted_data = $this->format_meeting_data($meeting_data);
            $doctor_id = $formatted_data['doctor_id'] ?? 0;

            $this->doctor_id = $doctor_id;
            // Add doctor ID to API request
            $zoom_data = $this->format_zoom_meeting_data($formatted_data);
            $response = $this->make_api_request('POST', 'users/me/meetings', $zoom_data, $doctor_id);

            if (is_wp_error($response)) {
                $this->store_error_in_table($response, $formatted_data['appointment_id']);
                $this->log('error', 'Failed to create Zoom meeting', ['response' => $response]);
                return $response;
            }

            // Save to database
            $meeting_record = [
                'id' => $response['id'],
                'uuid' => $response['uuid'],
                'host_id' => $response['host_id'],
                'topic' => $response['topic'],
                'start_time' => $response['start_time'],
                'duration' => $response['duration'],
                'timezone' => $response['timezone'],
                'join_url' => $response['join_url'],
                'start_url' => $response['start_url'],
                'password' => $response['password'] ?? '',
                'appointment_id' => $formatted_data['appointment_id'],
                'created_at' => current_time('mysql')
            ];

            $record_id = $this->save_meeting_record($meeting_record);

            if ($record_id) {
                $this->log('info', 'Zoom meeting created successfully', ['meeting_id' => $response['id']]);
                return $meeting_record;
            } else {
                // If saving to DB fails, try to delete the Zoom meeting
                $this->delete_meeting($response['id']);
                return new WP_Error('db_save_failed', 'Failed to save meeting record to database');
            }

        } catch (\Exception $e) {
            $this->log('error', 'Exception creating Zoom meeting: ' . $e->getMessage());
            return new WP_Error('exception', 'Exception creating Zoom meeting: ' . $e->getMessage());
        }
    }

    /**
     * Update a meeting
     * @param string $meeting_id Meeting ID
     * @param array $meeting_data Updated meeting configuration
     * @return array|false Updated meeting details or false on failure
     */
    public function update_meeting($meeting_id, $meeting_data = array()): array|false
    {
        try {
            $formatted_data = $this->format_meeting_data($meeting_data);
            $zoom_data = $this->format_zoom_meeting_data($formatted_data);

            $response = $this->make_api_request('PATCH', "meetings/{$meeting_id}", $zoom_data);

            if (is_wp_error($response)) {
                $this->log('error', 'Failed to update Zoom meeting', ['meeting_id' => $meeting_id, 'response' => $response]);
                return false;
            }

            // Get updated meeting details
            $updated_meeting = $this->get_meeting($meeting_id);
            if ($updated_meeting) {
                $update_data = [
                    'start_url' => $updated_meeting['start_url'],
                    'join_url' => $updated_meeting['join_url'],
                    'password' => $updated_meeting['password'] ?? ''
                ];

                $this->update_meeting_record($meeting_id, $update_data);
                $this->log('info', 'Zoom meeting updated successfully', ['meeting_id' => $meeting_id]);

                return $updated_meeting;
            }

            return false;

        } catch (\Exception $e) {
            $this->log('error', 'Exception updating Zoom meeting: ' . $e->getMessage());
            return false;
        }
    }

    /**
     * Delete a meeting
     * @param string $meeting_id Meeting ID
     * @return bool True on success, false on failure
     */
    public function delete_meeting($meeting_id): bool
    {
        try {
            $response = $this->make_api_request('DELETE', "meetings/{$meeting_id}", [], $this->doctor_id);

            if (is_wp_error($response)) {
                $this->log('error', 'Failed to delete Zoom meeting', ['meeting_id' => $meeting_id]);
                return false;
            }

            // Delete from database
            $deleted = $this->delete_meeting_record($meeting_id);

            if ($deleted) {
                $this->log('info', 'Zoom meeting deleted successfully', ['meeting_id' => $meeting_id]);
            }

            return true;

        } catch (\Exception $e) {
            $this->log('error', 'Exception deleting Zoom meeting: ' . $e->getMessage());
            return false;
        }
    }

    /**
     * Get meeting details
     * @param string $meeting_id Meeting ID
     * @return array|false Meeting details or false if not found
     */
    public function get_meeting($meeting_id): array|false
    {
        try {
            $response = $this->make_api_request('GET', "meetings/{$meeting_id}");

            if (!$response || isset($response['error'])) {
                $this->log('error', 'Failed to get Zoom meeting', ['meeting_id' => $meeting_id, 'response' => $response]);
                return false;
            }

            return $response;

        } catch (\Exception $e) {
            $this->log('error', 'Exception getting Zoom meeting: ' . $e->getMessage());
            return false;
        }
    }

    /**
     * Test connection to Zoom API
     * @return array Connection test result with success status and message
     */
    public function test_connection($data = [], $doctor_id = 0): array
    {
        try {

            if (empty($data['account_id']) || empty($data['client_id']) || empty($data['client_secret'])) {
                return [
                    'success' => false, 
                    'message' => 'Missing credentials'
                ];
            }

            // Get Token manually using the input credentials
            $headers = ['Authorization' => 'Basic ' . base64_encode($data['client_id'] . ':' . $data['client_secret'])];

            $token_res = wp_remote_post(self::OAUTH_TOKEN_URL, [
                'headers' => $headers,
                'body'    => [
                    'grant_type' => 'account_credentials',
                    'account_id' => $data['account_id'],
                ]
            ]);

            // Check token response error
            if (is_wp_error($token_res)) {
                return [
                    'success' => false,
                    'message' => $token_res->get_error_message(),
                ];
            }

            $token = json_decode(wp_remote_retrieve_body($token_res), true)['access_token'] ?? null;
            if (!$token) {
                return [
                    'success' => false,
                    'message' => 'Invalid Credentials - Could not get token',
                ];
            }

            // Test API: Server-to-Server uses '/users' (admin-level)
            $api_res = wp_remote_get(
                self::API_BASE_URL . 'users?page_size=1',
                ['headers' => ['Authorization' => 'Bearer ' . $token]]
            );

            if (is_wp_error($api_res)) {
                return [
                    'success' => false,
                    'message' => $api_res->get_error_message()
                ];
            }

            $body = json_decode(wp_remote_retrieve_body($api_res), true);

            return isset($body['users'])
                ? ['success' => true, 'message' => 'Connection successful']
                : ['success' => false, 'message' => $body['message'] ?? 'Unknown API Error'];
        } catch (\Exception $e) {
            return ['success' => false, 'message' => $e->getMessage()];
        }
    }

    /**
     * Format meeting data for Zoom API
     * @param array $meeting_data Formatted meeting data
     * @return array Zoom API formatted data
     */
    private function format_zoom_meeting_data($meeting_data): array
    {
        $default_settings = $this->get_config_value('default_settings', []);

        $zoom_data = [
            'topic' => $meeting_data['topic'],
            'type' => $this->get_zoom_meeting_type($meeting_data['type']),
            'start_time' => $this->format_zoom_datetime($meeting_data['start_time']),
            'duration' => $meeting_data['duration'],
            'timezone' => $meeting_data['timezone'],
            'password' => $meeting_data['password'],
            'agenda' => $meeting_data['topic'],
            'settings' => [
                'host_video' => $default_settings['host_video'] ?? true,
                'participant_video' => $default_settings['participant_video'] ?? true,
                'join_before_host' => $default_settings['join_before_host'] ?? false,
                'mute_upon_entry' => $default_settings['mute_upon_entry'] ?? true,
                'waiting_room' => $meeting_data['waiting_room'] ?? $default_settings['waiting_room'] ?? true,
                'auto_recording' => $meeting_data['auto_recording'] ?? $default_settings['auto_recording'] ?? 'none',
                'meeting_authentication' => $default_settings['meeting_authentication'] ?? false,
                'approval_type' => $default_settings['approval_type'] ?? 2,
            ]
        ];

        // Add recurring meeting settings if applicable
        if ($meeting_data['type'] === 'recurring') {
            $zoom_data['recurrence'] = [
                'type' => 1, // Daily
                'repeat_interval' => 1,
                'end_date_time' => date('Y-m-d\TH:i:s\Z', strtotime('+1 month'))
            ];
        }

        return $zoom_data;
    }

    /**
     * Get Zoom meeting type from generic type
     * @param string $type Generic meeting type
     * @return int Zoom meeting type
     */
    private function get_zoom_meeting_type($type): int
    {
        switch ($type) {
            case 'instant':
                return 1;
            case 'scheduled':
                return 2;
            case 'recurring':
                return 8;
            default:
                return 2; // Default to scheduled
        }
    }

    /**
     * Format datetime for Zoom API
     * @param string $datetime MySQL datetime
     * @return string Zoom formatted datetime
     */
    private function format_zoom_datetime($datetime): string
    {
        $timestamp = strtotime($datetime);
        return date('Y-m-d\TH:i:s\Z', $timestamp);
    }


    /**
     * Get OAuth access token
     * @return string|false Access token or false on failure
     */
    private function get_oauth_token(): string|false
    {
        $cache_key = 'kc_zoom_oauth_token_' . md5($this->get_config_value('account_id'));
        $cached_token = wp_cache_get($cache_key);

        if ($cached_token && $cached_token['expires'] > time()) {
            return $cached_token['token'];
        }

        $account_id = $this->get_config_value('account_id');
        $client_id = $this->get_config_value('client_id');
        $client_secret = $this->get_config_value('client_secret');

        $credentials = base64_encode($client_id . ':' . $client_secret);

        $response = wp_remote_post('https://zoom.us/oauth/token', [
            'headers' => [
                'Authorization' => 'Basic ' . $credentials,
                'Content-Type' => 'application/x-www-form-urlencoded'
            ],
            'body' => [
                'grant_type' => 'account_credentials',
                'account_id' => $account_id
            ],
            'timeout' => 30
        ]);

        if (is_wp_error($response)) {
            $this->log('error', 'OAuth token request failed: ' . $response->get_error_message());
            return false;
        }

        $body = wp_remote_retrieve_body($response);
        $data = json_decode($body, true);

        if (isset($data['access_token'])) {
            $token_data = [
                'token' => $data['access_token'],
                'expires' => time() + ($data['expires_in'] - 300) // Refresh 5 minutes early
            ];

            wp_cache_set($cache_key, $token_data, '', $data['expires_in'] - 300);

            return $data['access_token'];
        }

        $this->log('error', 'Failed to get OAuth token', ['response' => $data]);
        return false;
    }

    /**
     * Get JWT token (deprecated but still supported)
     * @return string|false JWT token or false on failure
     */
    private function get_jwt_token(): string|false
    {
        // Note: JWT app type is deprecated by Zoom as of June 2023
        // This is kept for backward compatibility
        $api_key = $this->get_config_value('api_key');
        $api_secret = $this->get_config_value('api_secret');

        if (empty($api_key) || empty($api_secret)) {
            return false;
        }

        $header = json_encode(['typ' => 'JWT', 'alg' => 'HS256']);
        $payload = json_encode([
            'iss' => $api_key,
            'exp' => time() + 3600 // 1 hour expiration
        ]);

        $base64_header = str_replace(['+', '/', '='], ['-', '_', ''], base64_encode($header));
        $base64_payload = str_replace(['+', '/', '='], ['-', '_', ''], base64_encode($payload));

        $signature = hash_hmac('sha256', $base64_header . "." . $base64_payload, $api_secret, true);
        $base64_signature = str_replace(['+', '/', '='], ['-', '_', ''], base64_encode($signature));

        return $base64_header . "." . $base64_payload . "." . $base64_signature;
    }

    /**
     * Make API request to Zoom
     * @param string $method HTTP method
     * @param string $endpoint API endpoint
     * @param array $data Request data
     * @return array|WP_Error Response data or WP_Error on failure
     */
    private function make_api_request($method, $endpoint, $data = [], $doctor_id = 0): array|WP_Error
    {
        $access_token = $this->get_access_token($doctor_id);

        if (is_wp_error($access_token)) {
            $this->log('error', 'Failed to get access token for API request');
            return $access_token;
        }

        $url = self::API_BASE_URL . ltrim($endpoint, '/');
        $headers = [
            'Authorization' => 'Bearer ' . $access_token,
            'Content-Type' => 'application/json'
        ];

        $args = [
            'method' => strtoupper($method),
            'headers' => $headers,
            'timeout' => 30
        ];

        if (!empty($data) && in_array(strtoupper($method), ['POST', 'PUT', 'PATCH'])) {
            $args['body'] = wp_json_encode($data);
        }

        $response = wp_remote_request($url, $args);

        if (is_wp_error($response)) {
            $this->log('error', 'API request failed: ' . $response->get_error_message(), [
                'endpoint' => $endpoint,
                'method' => $method
            ]);
            return new WP_Error('api_request_failed', 'API request failed: ' . $response->get_error_message());
        }

        $response_code = wp_remote_retrieve_response_code($response);
        $body = wp_remote_retrieve_body($response);

        // Handle successful responses (2xx status codes)
        if ($response_code >= 200 && $response_code < 300) {
            // DELETE requests might return empty body
            if (empty($body) && $method === 'DELETE') {
                return ['success' => true];
            }

            $decoded = json_decode($body, true);
            return $decoded !== null ? $decoded : ['success' => true];
        }

        // Handle error responses
        $error_data = json_decode($body, true);
        $this->log('error', 'API request returned error', [
            'endpoint' => $endpoint,
            'method' => $method,
            'status_code' => $response_code,
            'error' => $error_data
        ]);
        return new WP_Error('api_error', 'API request failed', [
            'code' => $response_code,
            'message' => $error_data['message'] ?? 'Unknown error'
        ]);
    }

    /**
     * Handle webhook from Zoom
     */
    public function handle_webhook()
    {
        // Verify webhook signature if secret is configured
        $webhook_secret = $this->get_config_value('webhook_secret');
        if (!empty($webhook_secret)) {
            $signature = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
            $payload = file_get_contents('php://input');

            $expected_signature = hash_hmac('sha256', $payload, $webhook_secret);

            if (!hash_equals($expected_signature, $signature)) {
                $this->log('warning', 'Webhook signature verification failed');
                wp_send_json_error('Invalid signature');
            }
        }

        $input = file_get_contents('php://input');
        $data = json_decode($input, true);

        if (!$data) {
            wp_send_json_error('Invalid JSON');
        }

        $event = $data['event'] ?? '';
        $payload = $data['payload'] ?? [];

        $this->log('info', 'Webhook received', ['event' => $event]);

        switch ($event) {
            case 'meeting.started':
                $this->handle_meeting_started($payload);
                break;
            case 'meeting.ended':
                $this->handle_meeting_ended($payload);
                break;
            case 'meeting.participant_joined':
                $this->handle_participant_joined($payload);
                break;
            case 'meeting.participant_left':
                $this->handle_participant_left($payload);
                break;
            default:
                $this->log('info', 'Unhandled webhook event', ['event' => $event]);
        }

        wp_send_json_success();
    }

    /**
     * Handle meeting started webhook
     * @param array $payload Webhook payload
     */
    private function handle_meeting_started($payload)
    {
        $meeting_id = $payload['object']['id'] ?? '';
        if ($meeting_id) {
            $this->log('info', 'Meeting started', ['meeting_id' => $meeting_id]);
            do_action('kc_zoom_meeting_started', $meeting_id, $payload);
        }
    }

    /**
     * Handle meeting ended webhook
     * @param array $payload Webhook payload
     */
    private function handle_meeting_ended($payload)
    {
        $meeting_id = $payload['object']['id'] ?? '';
        if ($meeting_id) {
            $this->log('info', 'Meeting ended', ['meeting_id' => $meeting_id]);
            do_action('kc_zoom_meeting_ended', $meeting_id, $payload);
        }
    }

    /**
     * Handle participant joined webhook
     * @param array $payload Webhook payload
     */
    private function handle_participant_joined($payload)
    {
        $meeting_id = $payload['object']['id'] ?? '';
        $participant = $payload['object']['participant'] ?? [];

        if ($meeting_id && !empty($participant)) {
            $this->log('info', 'Participant joined', [
                'meeting_id' => $meeting_id,
                'participant' => $participant['user_name'] ?? 'Unknown'
            ]);
            do_action('kc_zoom_participant_joined', $meeting_id, $participant, $payload);
        }
    }

    /**
     * Handle participant left webhook
     * @param array $payload Webhook payload
     */
    private function handle_participant_left($payload)
    {
        $meeting_id = $payload['object']['id'] ?? '';
        $participant = $payload['object']['participant'] ?? [];

        if ($meeting_id && !empty($participant)) {
            $this->log('info', 'Participant left', [
                'meeting_id' => $meeting_id,
                'participant' => $participant['user_name'] ?? 'Unknown'
            ]);
            do_action('kc_zoom_participant_left', $meeting_id, $participant, $payload);
        }
    }

    public function get_authorization_url($doctor_id): string
    {
        $config = $this->get_config();
        $redirect_uri_for_api = $config['redirect_url'];

        $params = [
            'response_type' => 'code',
            'client_id' => $config['client_id'],
            'redirect_uri' => $redirect_uri_for_api,
            'state' => $doctor_id
        ];

        return add_query_arg($params, self::OAUTH_AUTHORIZE_URL);
    }

    public function handle_authorization_callback($doctor_id, $code): bool
    {
        $config = $this->get_config();
        $redirect_uri_for_api = $config['redirect_url'];

        $response = wp_remote_post(self::OAUTH_TOKEN_URL, [
            'headers' => [
                'Authorization' => 'Basic ' . base64_encode($config['client_id'] . ':' . $config['client_secret']),
                'Content-Type' => 'application/x-www-form-urlencoded'
            ],
            'body' => [
                'grant_type' => 'authorization_code',
                'code' => $code,
                'redirect_uri' => $redirect_uri_for_api,
            ]
        ]);

        if (is_wp_error($response)) {
            return false;
        }

        $body = wp_remote_retrieve_body($response);
        $data = json_decode($body, true);

        if (!empty($data['access_token'])) {
            $this->store_doctor_tokens($doctor_id, $data);
            return true;
        }

        return false;
    }

    private function store_doctor_tokens($doctor_id, $token_data)
    {
        // Update status flags using legacy keys
        update_user_meta($doctor_id, 'telemed_type', $this->get_provider_id());
        update_user_meta($doctor_id, 'kiviCare_zoom_telemed_connect', 'on');
        update_user_meta($doctor_id, 'kiviCare_google_meet_connect', 'off');

        // Prepare token data
        $token_payload = [
            'access_token'  => $token_data['access_token'],
            'token_type'    => $token_data['token_type'] ?? 'bearer',
            'refresh_token' => $token_data['refresh_token'],
            'expires_in'    => (int) $token_data['expires_in'],
            'scope'         => $token_data['scope'] ?? '',
            'api_url'       => 'https://api.zoom.us/v2/'
        ];

        // Convert to Object (stdClass) to match old plugin format
        $token_object = (object) $token_payload;

        // Save using legacy meta key
        update_user_meta($doctor_id, 'kiviCare_doctor_zoom_telemed_config', $token_object);
    }

    private function refresh_doctor_token($doctor_id)
    {
        // Get tokens using legacy key
        $tokens = get_user_meta($doctor_id, 'kiviCare_doctor_zoom_telemed_config', true);

        // Normalize to array
        $tokens = (array) $tokens;

        if (!$tokens || empty($tokens['refresh_token'])) {
            return false;
        }

        $config = $this->get_config();
        $response = wp_remote_post(self::OAUTH_TOKEN_URL, [
            'headers' => [
                'Authorization' => 'Basic ' . base64_encode($config['client_id'] . ':' . $config['client_secret']),
                'Content-Type' => 'application/x-www-form-urlencoded'
            ],
            'body' => [
                'grant_type' => 'refresh_token',
                'refresh_token' => $tokens['refresh_token']
            ]
        ]);

        if (is_wp_error($response)) {
            return false;
        }

        $body = wp_remote_retrieve_body($response);
        $data = json_decode($body, true);

        if (!empty($data['access_token'])) {
            $this->store_doctor_tokens($doctor_id, $data);
            return $data['access_token'];
        }

        return false;
    }

    public function get_doctor_access_token($doctor_id)
    {
        // Get from legacy key
        $tokens = get_user_meta($doctor_id, 'kiviCare_doctor_zoom_telemed_config', true);
        
        if (!$tokens) {
            return false;
        }

        // If it's an object (old format), this casts it to array. If it's already array, it stays array.
        $tokens = (array) $tokens;

        if (empty($tokens['access_token'])) {
            return false;
        }

        $this->doctor_id = $doctor_id;
        return $tokens['access_token'];
    }

    /**
     * Get Server-to-Server OAuth access token for Zoom
     * @return string|WP_Error Access token or false on failure
     */
    private function get_server_to_server_token($doctor_id): string|WP_Error
    {
        $doctor_config = $this->get_doctor_config($doctor_id);

        $cache_key = 'kc_zoom_s2s_token_' . md5($doctor_config['account_id']);
        $cached_token = wp_cache_get($cache_key);

        if ($cached_token && $cached_token['expires'] > time()) {
            return $cached_token['token'];
        }

        $account_id = $doctor_config['account_id'];
        $client_id = $doctor_config['client_id'];
        $client_secret = $doctor_config['client_secret'];

        if (empty($account_id) || empty($client_id) || empty($client_secret)) {
            $this->log('error', 'Missing credentials for server-to-server');
            return new WP_Error('missing_credentials', 'Missing account_id, client_id or client_secret for server-to-server');
        }

        $response = wp_remote_post(self::OAUTH_TOKEN_URL, [
            'headers' => [
                'Authorization' => 'Basic ' . base64_encode($client_id . ':' . $client_secret),
                'Content-Type' => 'application/x-www-form-urlencoded'
            ],
            'body' => [
                'grant_type' => 'account_credentials',
                'account_id' => $account_id
            ],
            'timeout' => 30
        ]);

        if (is_wp_error($response)) {
            $this->log('error', 'Server-to-server token request failed: ' . $response->get_error_message());
            return new WP_Error('request_failed', 'Server-to-server token request failed: ' . $response->get_error_message());
        }

        $body = wp_remote_retrieve_body($response);
        $data = json_decode($body, true);

        if (isset($data['access_token'])) {
            $token_data = [
                'token' => $data['access_token'],
                'expires' => time() + ($data['expires_in'] - 300) // Refresh 5 minutes early
            ];
            wp_cache_set($cache_key, $token_data, '', $data['expires_in'] - 300);
            update_user_meta($doctor_id, 'kiviCare_zoom_telemed_connect', 'on');
            return $data['access_token'];
        }

        $this->log('error', 'Failed to get server-to-server token', ['response' => $data]);
        return new WP_Error('token_error', 'Failed to get server-to-server token: ' . ($data['message'] ?? 'Unknown error'));
    }

    private function get_access_token($doctor_id = 0): string|WP_Error
    {
        $config = $this->get_config();

        if ($config['auth_type'] === 'server-to-server') {
            return $this->get_server_to_server_token($doctor_id);
        }

        if ($config['auth_type'] === 'oauth' && $doctor_id) {
            return $this->get_doctor_access_token($doctor_id);
        }

        return new WP_Error('invalid_auth_type', 'Invalid authentication type configured for Zoom');
    }

    /**
     * Disconnect a doctor from Zoom by removing their OAuth tokens
     * 
     * @param int $doctor_id Doctor user ID
     * @return bool True on success, false on failure
     */
    public function disconnect_doctor(int $doctor_id): bool
    {
        try {
            // Use legacy meta keys
            $meta_key_config = 'kiviCare_doctor_zoom_telemed_config';
            $meta_key_connect = 'kiviCare_zoom_telemed_connect';

            delete_user_meta($doctor_id, $meta_key_config);
            update_user_meta($doctor_id, $meta_key_connect, 'off');

            return true;
        } catch (\Exception $e) {
            return false;
        }
    }

    /**
     * Optional: Cancel all future meetings for a disconnected doctor
     * 
     * @param int $doctor_id Doctor user ID
     */
    private function cancel_future_meetings(int $doctor_id)
    {
        try {
            // Get all future appointments for this doctor
            $appointments = $this->get_future_appointments($doctor_id);

            foreach ($appointments as $appointment) {
                $meeting = $this->get_meeting_by_appointment($appointment->id);

                if ($meeting) {
                    $this->delete_meeting($meeting->zoomId);
                    $this->log('info', 'Canceled future meeting', [
                        'appointment_id' => $appointment->id,
                        'meeting_id' => $meeting->zoomId
                    ]);
                }
            }

        } catch (\Exception $e) {
            $this->log('error', 'Failed to cancel future meetings: ' . $e->getMessage(), [
                'doctor_id' => $doctor_id
            ]);
        }
    }

    public function cancel_meeting_by_appointment($appointment_id)
    {
        try {
            $meeting = $this->get_meeting_by_appointment($appointment_id);
            if ($meeting) {
                $this->doctor_id = $meeting->doctor_id; // Set doctor ID from meeting record
                $this->delete_meeting($meeting->zoomId);
                $this->log('info', 'Canceled meeting by appointment', [
                    'appointment_id' => $appointment_id,
                    'meeting_id' => $meeting->zoomId
                ]);
                return true;
            }
            return false;
        } catch (\Exception $e) {
            $this->log('error', 'Failed to cancel meeting by appointment: ' . $e->getMessage(), [
                'appointment_id' => $appointment_id
            ]);
            return false;
        }
    }

    /**
     * Get future appointments for a doctor
     * 
     * @param int $doctor_id Doctor user ID
     * @return array Array of appointment objects
     */
    private function get_future_appointments(int $doctor_id): array
    {
        global $wpdb;

        $currentDate = current_time('Y-m-d');
        $currentTime = current_time('H:i:s');


        $query = KCAppointment::table('a')
            ->select([
                "a.*",
            ])
            ->where('a.doctor_id', $doctor_id);


        $query->where(function ($q) use ($currentDate, $currentTime) {
            $q->where(function ($innerQ) use ($currentDate, $currentTime) {
                // Today's appointments with time later than now
                $innerQ->where('a.appointment_start_date', '=', $currentDate)
                    ->where('a.appointment_start_time', '>', $currentTime);
            })->orWhere('a.appointment_start_date', '>', $currentDate);
            $q->where('a.status', '=', KCAppointment::STATUS_BOOKED); // Exclude cancelled appointments
        });

        return $query->get()->toArray();
    }

    protected function save_zoom_meeting_record($meeting_data)
    {
        // Check if a mapping already exists for this appointment
        $appointment_id = $meeting_data['appointment_id'] ?? 0;
        $existing = KCTAppointmentZoomMapping::query()
            ->where('appointmentId', $appointment_id)
            ->first();

        if ($existing) {
            // Update existing mapping
            $existing->zoomId = $meeting_data['id'] ?? $meeting_data['meeting_id'];
            $existing->zoomUUID = $meeting_data['uuid'] ?? '';
            $existing->startUrl = $meeting_data['start_url'] ?? '';
            $existing->joinUrl = $meeting_data['join_url'] ?? '';
            $existing->password = $meeting_data['password'] ?? '';
            $existing->createdAt = current_time('mysql');
            $existing->save();
            $zoom_mapping = $existing;
        } else {
            // Create new mapping
            $zoom_mapping = KCTAppointmentZoomMapping::create([
            'appointmentId' => $appointment_id,
            'zoomId' => $meeting_data['id'] ?? $meeting_data['meeting_id'],
            'zoomUUID' => $meeting_data['uuid'] ?? '',
            'startUrl' => $meeting_data['start_url'] ?? '',
            'joinUrl' => $meeting_data['join_url'] ?? '',
            'password' => $meeting_data['password'] ?? '',
            'createdAt' => current_time('mysql')
            ]);
        }

        return $zoom_mapping ? $zoom_mapping : false;
    }

    public function get_meeting_by_appointment($appointment_id)
    {
        try {
            return KCTAppointmentZoomMapping::table('azm')
                ->leftJoin(KCAppointment::class,'a.id', '=', 'azm.appointment_id','a')
                ->where('appointmentId', $appointment_id)
                ->first();
        } catch (\Exception $e) {
            $this->log('error', 'Failed to get meeting by appointment: ' . $e->getMessage());
            return null;
        }

    }
    protected function delete_meeting_record($meeting_id)
    {
        try {
            return KCTAppointmentZoomMapping::query()
                ->where('zoomId', $meeting_id)
                ->delete();

        } catch (\Exception $e) {
            $this->log('error', 'Failed to delete meeting record: ' . $e->getMessage());
            return false;
        }
    }
    public function store_error_in_table($response, $appointment_id = 0)
    {
        if (is_wp_error($response)) {
            $error_data = [
                'error_code' => $response->get_error_code() ?? '',
                'error_message' => $response->get_error_message() ?? '',
            ];
            // Store error in a custom table or log
            KCTAppointmentZoomMapping::create(['appointmentId' => $appointment_id, 'zoomId' => -1,'zoomUUID' => -1,'password' => -1,'extra' => json_encode($error_data), 'createdAt' => current_time('mysql')]);
        }
    }

    public function is_doctor_telemed_connected(): bool
    {
        $config = $this->get_config();

        if (isset($config['auth_type']) && $config['auth_type'] === 'server-to-server') {
            return true;
        }

        $is_connected = get_user_meta($this->doctor_id, 'kiviCare_zoom_telemed_connect', true);
        return $is_connected === 'on';
    }

    /**
     * Updates Zoom configuration using only legacy-compatible keys.
     *
     * Only explicitly defined keys are saved to avoid persisting
     * unwanted or newly introduced default options.
     *
     * @param array $new_config Configuration data from the controller.
     * @return bool True on success, false on failure.
     */
    public function update_config($new_config)
    {
        // Build a strict config array to prevent saving unsupported keys.
        $config_to_save = [
            'enableCal'        => $new_config['enableCal'] ?? 'No',
            'client_id'        => $new_config['client_id'] ?? '',
            'client_secret'    => $new_config['client_secret'] ?? '',
            'redirect_url'     => $new_config['redirect_url'] ?? '',
            'auth_type'        => $new_config['auth_type'] ?? 'none',
            'account_id'       => $new_config['account_id'] ?? '',
            'default_settings' => $new_config['default_settings'] ?? [],
        ];

        // Persist configuration.
        $this->config = $config_to_save;

        return update_option($this->settings_key, $this->config);
    }

    /**
     * Retrieves provider configuration and normalizes legacy values.
     *
     * Reads stored options, resolves legacy authentication settings,
     * and returns a fully hydrated configuration array for internal use.
     *
     * @return array Provider configuration.
     */
    public function get_config()
    {
        // Force fresh reads to avoid stale option values.
        wp_cache_delete($this->settings_key, 'options');

        $legacy_s2s_key = defined('KIVICARE_TELEMED_PREFIX')
            ? KIVICARE_TELEMED_PREFIX . 'zoom_telemed_server_to_server_oauth_status'
            : 'kiviCare_zoom_telemed_server_to_server_oauth_status';

        wp_cache_delete($legacy_s2s_key, 'options');

        $saved_config        = get_option($this->settings_key, []);
        $legacy_s2s_status   = get_option($legacy_s2s_key, false);
        $effective_auth_type = 'none';

        // Resolve effective authentication type with legacy fallback support.
        if (isset($saved_config['auth_type']) && $saved_config['auth_type'] !== 'none') {
            $effective_auth_type = $saved_config['auth_type'];
        } elseif ($legacy_s2s_status === 'Yes') {
            $effective_auth_type = 'server-to-server';
        } elseif (isset($saved_config['enableCal']) && $saved_config['enableCal'] === 'Yes') {
            $effective_auth_type = 'oauth';
        }

        $saved_config['auth_type'] = $effective_auth_type;
        $saved_config['enableCal'] = ($effective_auth_type !== 'none') ? 'Yes' : 'No';
        $saved_config['enabled']   = ($effective_auth_type !== 'none');

        if (isset($saved_config['redirect_url'])) {
            $saved_config['redirect_uri'] = $saved_config['redirect_url'];
        }

        return wp_parse_args($saved_config, $this->get_default_config());
    }

}