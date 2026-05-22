<?php

namespace KCGMApp\googlemeet;

use App\abstracts\KCAbstractTelemedProvider;
use App\baseClasses\KCBase;
use App\models\KCAppointment;
use App\models\KCDoctor;
use App\models\KCOption;

use App\baseClasses\KCErrorLogger;
use KCGMApp\models\KCGMAppointmentGoogleMeetMapping;
use DateTime;
use DateTimeZone;
use DateInterval;
use Exception;
use WP_Error;

defined('ABSPATH') || exit;

class KCGMGoogleMeet extends KCAbstractTelemedProvider
{
    private const API_BASE_URL = 'https://www.googleapis.com/calendar/v3/';
    private const OAUTH_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
    private const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';

    private $doctor_id;

    public function get_provider_id(): string
    {
        return 'googlemeet';
    }

    public function get_provider_name(): string
    {
        return 'Google Meet';
    }

    protected function get_default_config(): array
    {
        return [
            'enabled' => false,
            'client_id' => '',
            'client_secret' => '',
            'auth_type' => 'oauth',
            'redirect_uri' => rest_url('kivicare/v1/settings/googlemeet/callback'),
            'default_settings' => [
                'reminders' => true,
                'attendees' => true
            ],
            'webhook_url' => '',
            'webhook_secret' => ''
        ];
    }

    public function is_configured(): bool
    {
        return !empty($this->get_config_value('client_id')) &&
            !empty($this->get_config_value('client_secret'));
    }

    public function update_doctor_config(int $doctor_id, array $config): bool
    {
        $existing = get_user_meta($doctor_id, 'google_meet_config', true);

        if (!is_array($existing)) {
            $existing = [];
        }

        $new_config = array_merge($existing, $config);

        return update_user_meta($doctor_id, 'google_meet_config', $new_config) !== false;
    }

    public function supports_recording(): bool
    {
        return true;
    }

    public function supports_waiting_room(): bool
    {
        return true;
    }

    public function supports_password(): bool
    {
        return false;
    }

    public function get_supported_meeting_types(): array
    {
        return ['instant', 'scheduled', 'recurring'];
    }

    public function get_max_duration(): int
    {
        return 0;
    }

    public function get_max_participants(): int
    {
        return 100;
    }

    public function create_meeting($meeting_data = array()): array|WP_Error
    {
        try {
            $formatted_data = $this->format_meeting_data($meeting_data);

            $appointment = KCAppointment::find($formatted_data['appointment_id']);
            if ($appointment) {
                $start_date = $appointment->appointmentStartDate;
                $start_time = $appointment->appointmentStartTime;
                $end_date = $appointment->appointmentEndDate ?: $start_date;
                $end_time = $appointment->appointmentEndTime;

                $start_datetime_str = $start_date . ' ' . $start_time;
                $end_datetime_str = $end_date . ' ' . $end_time;

                $start_timestamp = strtotime($start_datetime_str);
                $end_timestamp = strtotime($end_datetime_str);

                $formatted_data['start_time'] = date('c', $start_timestamp);
                $formatted_data['end_time'] = date('c', $end_timestamp);

                if (empty($formatted_data['duration']) && $start_timestamp && $end_timestamp) {
                    $formatted_data['duration'] = ($end_timestamp - $start_timestamp) / 60;
                }

                $formatted_data['timezone'] = !empty($formatted_data['timezone']) ? $formatted_data['timezone'] : wp_timezone_string();
            }

            $doctor_id = $formatted_data['doctor_id'] ?? 0;
            $this->doctor_id = $doctor_id;
            $google_data = $this->format_google_event_data($formatted_data);
            $response = $this->make_api_request('POST', 'calendars/primary/events?conferenceDataVersion=1', $google_data, $doctor_id);

            if (is_wp_error($response)) {
                $this->store_error_in_table($response, $formatted_data['appointment_id']);
                return $response;
            }

            $meeting_record = [
                'id' => $response['id'],
                'join_url' => $response['hangoutLink'],
                'start_url' => $response['hangoutLink'],
                'password' => '',
                'appointment_id' => $formatted_data['appointment_id'],
                'event_url' => $response['htmlLink'],
                'created_at' => current_time('mysql')
            ];

            $record_id = $this->save_meeting_record($meeting_record);

            if ($record_id) {
                $this->log('info', __('Google Meet event created and saved', 'kivicare-googlemeet-telemed-addon'), ['event_id' => $response['id'], 'appointment_id' => $formatted_data['appointment_id']]);
                return $meeting_record;
            } else {
                $this->delete_meeting($response['id']);
                return new WP_Error('db_save_failed', __('Failed to save meeting record to database', 'kivicare-googlemeet-telemed-addon'));
            }
        } catch (Exception $e) {
            return new WP_Error('exception', __('Exception creating Google Meet event: ', 'kivicare-googlemeet-telemed-addon') . $e->getMessage());
        }
    }

    public function update_meeting($meeting_id, $meeting_data = array()): array|false
    {
        try {
            $formatted_data = $this->format_meeting_data($meeting_data);
            $doctor_id = $formatted_data['doctor_id'] ?? 0;
            $this->doctor_id = $doctor_id; // Set the doctor_id for token access

            $google_data = $this->format_google_event_data($formatted_data);

            // Pass the doctor_id to make_api_request
            $response = $this->make_api_request('PATCH', "calendars/primary/events/{$meeting_id}", $google_data, $doctor_id);

            if (is_wp_error($response)) {
                $this->log('error', __('Failed to update Google Meet event', 'kivicare-googlemeet-telemed-addon'), [
                    'event_id' => $meeting_id,
                    'response' => $response->get_error_message()
                ]);
                return false;
            }

            $updated_meeting = $this->get_meeting($meeting_id);
            if ($updated_meeting) {
                $update_data = [
                    'url' => $updated_meeting['hangoutLink']
                ];

                $this->update_meeting_record($meeting_id, $update_data);
                $this->log('info', __('Google Meet event updated successfully', 'kivicare-googlemeet-telemed-addon'), [
                    'event_id' => $meeting_id
                ]);
                return $updated_meeting;
            }

            return false;
        } catch (Exception $e) {
            $this->log('error', __('Exception updating Google Meet event: ', 'kivicare-googlemeet-telemed-addon') . $e->getMessage());
            return false;
        }
    }

    public function delete_meeting($meeting_id): bool
    {
        try {
            $response = $this->make_api_request('DELETE', "calendars/primary/events/{$meeting_id}", [], $this->doctor_id);

            if (is_wp_error($response)) {
                return false;
            }

            $deleted = $this->delete_meeting_record($meeting_id);

            if ($deleted) {
                $this->log('info', __('Google Meet event deleted from calendar and DB', 'kivicare-googlemeet-telemed-addon'), ['event_id' => $meeting_id]);
            }

            return true;
        } catch (Exception $e) {
            return false;
        }
    }

    public function get_meeting($meeting_id): array|false
    {
        try {
            $response = $this->make_api_request('GET', "calendars/primary/events/{$meeting_id}");

            if (!$response || isset($response['error'])) {
                $this->log('error', __('Failed to get Google Meet event', 'kivicare-googlemeet-telemed-addon'), ['event_id' => $meeting_id, 'response' => $response]);
                return false;
            }

            return $response;
        } catch (Exception $e) {
            $this->log('error', __('Exception getting Google Meet event: ', 'kivicare-googlemeet-telemed-addon') . $e->getMessage());
            return false;
        }
    }

    public function test_connection($data = [], $doctor_id = 0): array
    {
        try {
            $response = $this->make_api_request('GET', 'calendars/primary', [], $doctor_id);

            if (!is_wp_error($response)) {
                return [
                    'success' => true,
                    'message' => __('Successfully connected to Google Calendar API', 'kivicare-googlemeet-telemed-addon'),
                    'data' => [
                        'calendar_id' => $response['id'] ?? '',
                        'summary' => $response['summary'] ?? ''
                    ]
                ];
            } else {
                return [
                    'success' => false,
                    'message' => __('Failed to connect to Google API: ', 'kivicare-googlemeet-telemed-addon') . ($response->get_error_message() ?? 'Unknown error'),
                    'error_code' => $response->get_error_code() ?? ''
                ];
            }
        } catch (Exception $e) {
            return [
                'success' => false,
                'message' => __('Connection test failed: ', 'kivicare-googlemeet-telemed-addon') . $e->getMessage()
            ];
        }
    }

    public function handle_webhook()
    {
        $headers = getallheaders();
        $channel_id = $headers['X-Goog-Channel-ID'] ?? '';
        $resource_id = $headers['X-Goog-Resource-ID'] ?? '';
        $resource_state = $headers['X-Goog-Resource-State'] ?? '';

        if (!$channel_id || !$resource_id) {
            wp_send_json_error(['message' => __('Invalid webhook headers', 'kivicare-googlemeet-telemed-addon')], 400);
        }

        $this->log('info', __('Received Google Calendar webhook', 'kivicare-googlemeet-telemed-addon'), [
            'channel_id' => $channel_id,
            'resource_id' => $resource_id,
            'resource_state' => $resource_state
        ]);

        wp_send_json_success();
    }

    public function get_doctor_config(int $doctor_id): array
    {
        $config = get_user_meta($doctor_id, 'google_meet_config', true);

        if (empty($config)) {
            return [];
        }

        return [
            'client_id' => $config['client_id'] ?? '',
            'client_secret' => $config['client_secret'] ?? '',
            'auth_type' => $config['auth_type'] ?? 'none',
            'default_settings' => $config['default_settings'] ?? []
        ];
    }

    public function get_authorization_url($doctor_id): string
    {
        $config = KCOption::get('google_meet_setting', []);
        $redirect_uri = rest_url('kivicare/v1/settings/googlemeet/callback');

        $params = [
            'client_id' => $config['client_id'],
            'redirect_uri' => $redirect_uri,
            'response_type' => 'code',
            'scope' => 'https://www.googleapis.com/auth/calendar',
            'access_type' => 'offline',
            'prompt' => 'consent',
            'state' => $doctor_id
        ];
        KCErrorLogger::instance()->error('Authorization URL params: ' . print_r($params, true));

        return add_query_arg($params, self::OAUTH_AUTHORIZE_URL);
    }

    public function handle_google_meet_authorization_callback($doctor_id, $code): bool
    {
        $config = KCOption::get('google_meet_setting', []);
        $redirect_uri = rest_url('kivicare/v1/settings/googlemeet/callback');

        KCErrorLogger::instance()->error('[Google Meet] Using client_id: ' . $config['client_id']);
        KCErrorLogger::instance()->error('[Google Meet] Using client_secret: ' . substr($config['client_secret'], 0, 6) . '***');

        $response = wp_remote_post('https://oauth2.googleapis.com/token', [
            'headers' => [
                'Content-Type' => 'application/x-www-form-urlencoded',
            ],
            'body' => [
                'code' => $code,
                'client_id' => $config['client_id'],
                'client_secret' => $config['client_secret'],
                'redirect_uri' => $redirect_uri,
                'grant_type' => 'authorization_code',
            ],
        ]);

        if (is_wp_error($response)) {
            KCErrorLogger::instance()->error('[Google Meet] ERROR: Token request failed ' . $response->get_error_message());
            return false;
        }

        $body = wp_remote_retrieve_body($response);
        $data = json_decode($body, true);

        KCErrorLogger::instance()->error('[Google Meet] Token response: ' . print_r($data, true));

        if (!empty($data['access_token'])) {
            $this->store_doctor_tokens($doctor_id, $data);
            return true;
        }

        KCErrorLogger::instance()->error('[Google Meet] ERROR: Failed to obtain access token Context: ' . $body);
        return false;
    }

    private function store_doctor_tokens($doctor_id, $token_data)
    {
        $existing_json = get_user_meta($doctor_id, 'google_meet_access_token', true);
        $existing_tokens = !empty($existing_json) ? json_decode($existing_json, true) : [];

        update_user_meta($doctor_id, 'telemed_type', $this->get_provider_id());
        update_user_meta($doctor_id, 'kiviCare_google_meet_connect', 'on');
        update_user_meta($doctor_id, 'kiviCare_zoom_telemed_connect', 'off');

        $new_data = [
            'access_token' => $token_data['access_token'],
            'refresh_token' => !empty($token_data['refresh_token']) ? $token_data['refresh_token'] : ($existing_tokens['refresh_token'] ?? ''),
            'expires_in' => time() + ($token_data['expires_in'] - 300),
            'scope' => $token_data['scope'] ?? ''
        ];

        update_user_meta($doctor_id, 'google_meet_access_token', json_encode($new_data));
        update_user_meta($doctor_id, 'kiviCare_doctor_meet_id', 'primary');
    }

    private function refresh_doctor_token($doctor_id)
    {
        $tokens_json = get_user_meta($doctor_id, 'google_meet_access_token', true);
        $tokens = !empty($tokens_json) ? json_decode($tokens_json, true) : [];

        if (empty($tokens) || empty($tokens['refresh_token'])) {
            $this->log('error', __('No refresh token found for doctor', 'kivicare-googlemeet-telemed-addon'), ['doctor_id' => $doctor_id]);
            return false;
        }

        $config = \App\models\KCOption::get('google_meet_setting', []);

        $response = wp_remote_post(self::OAUTH_TOKEN_URL, [
            'body' => [
                'refresh_token' => $tokens['refresh_token'],
                'client_id' => $config['client_id'],
                'client_secret' => $config['client_secret'],
                'grant_type' => 'refresh_token'
            ]
        ]);

        if (is_wp_error($response)) {
            $this->log('error', __('Token refresh failed: ', 'kivicare-googlemeet-telemed-addon') . $response->get_error_message());
            return false;
        }

        $body = wp_remote_retrieve_body($response);
        $data = json_decode($body, true);

        if (!empty($data['access_token'])) {
            $this->store_doctor_tokens($doctor_id, $data);
            return $data['access_token'];
        }

        $this->log('error', __('Failed to refresh token', 'kivicare-googlemeet-telemed-addon'), ['response' => $data]);
        return false;
    }

    public function get_doctor_access_token($doctor_id)
    {
        $tokens_json = get_user_meta($doctor_id, 'google_meet_access_token', true);
        $tokens = !empty($tokens_json) ? json_decode($tokens_json, true) : [];

        if (empty($tokens) || empty($tokens['access_token'])) {
            return false;
        }

        if (time() > ($tokens['expires_in'] ?? 0)) {
            return $this->refresh_doctor_token($doctor_id);
        }

        $this->doctor_id = $doctor_id;
        return $tokens['access_token'];
    }

    private function get_access_token($doctor_id): string|WP_Error
    {
        // If doctor_id is 0, try to use the instance doctor_id
        if ($doctor_id === 0 && $this->doctor_id > 0) {
            $doctor_id = $this->doctor_id;
        }

        $config = $this->get_config();

        if ($config['auth_type'] === 'oauth' && $doctor_id && $doctor_id > 0) {
            $token = $this->get_doctor_access_token($doctor_id);
            if (!$token) {
                return new WP_Error('no_token', __('No valid access token for doctor', 'kivicare-googlemeet-telemed-addon'));
            }

            return $token;
        }

        return new WP_Error('invalid_auth_type', __('Invalid authentication type configured for Google Meet', 'kivicare-googlemeet-telemed-addon'));
    }

    public function disconnect_doctor(int $doctor_id): bool
    {
        try {
            delete_user_meta($doctor_id, 'google_meet_access_token');
            update_user_meta($doctor_id, 'kiviCare_google_meet_connect', 'off');
            delete_user_meta($doctor_id, 'kiviCare_doctor_meet_id');

            $this->log('info', __('Doctor disconnected from Google Meet', 'kivicare-googlemeet-telemed-addon'), ['doctor_id' => $doctor_id]);
            return true;
        } catch (\Exception $e) {
            $this->log('error', __('Exception disconnecting doctor: ', 'kivicare-googlemeet-telemed-addon') . $e->getMessage(), ['doctor_id' => $doctor_id]);
            return false;
        }
    }

    public function cancel_meeting_by_appointment($appointment_id)
    {
        try {
            $meeting = $this->get_meeting_by_appointment($appointment_id);
            if ($meeting) {
                $this->doctor_id = $meeting->doctor_id;
                $this->delete_meeting($meeting->eventId);
                $this->log('info', __('Canceled meeting by appointment', 'kivicare-googlemeet-telemed-addon'), [
                    'appointment_id' => $appointment_id,
                    'event_id' => $meeting->eventId
                ]);
                return true;
            }
            return false;
        } catch (Exception $e) {
            $this->log('error', __('Failed to cancel meeting by appointment: ', 'kivicare-googlemeet-telemed-addon') . $e->getMessage(), [
                'appointment_id' => $appointment_id
            ]);
            return false;
        }
    }

    public function get_meeting_by_appointment($appointment_id)
    {
        try {
            return KCGMAppointmentGoogleMeetMapping::table('agmm')
                ->leftJoin(KCAppointment::class, 'a.id', '=', 'agmm.appointment_id', 'a')
                ->where('appointmentId', $appointment_id)
                ->first();
        } catch (Exception $e) {
            $this->log('error', __('Failed to get meeting by appointment: ', 'kivicare-googlemeet-telemed-addon') . $e->getMessage());
            return null;
        }
    }

    protected function save_zoom_meeting_record($meeting_data)
    {
        $this->log('warning', __('Attempted to call Zoom-specific method save_zoom_meeting_record in Google Meet provider', 'kivicare-googlemeet-telemed-addon'));
        return false;
    }

    protected function update_zoom_meeting_record($meeting_id, $meeting_data)
    {
        $this->log('warning', __('Attempted to call Zoom-specific method update_zoom_meeting_record in Google Meet provider', 'kivicare-googlemeet-telemed-addon'));
        return false;
    }

    protected function delete_meeting_record($meeting_id)
    {
        try {
            return KCGMAppointmentGoogleMeetMapping::query()
                ->where('eventId', $meeting_id)
                ->delete();
        } catch (Exception $e) {
            $this->log('error', __('Failed to delete meeting record: ', 'kivicare-googlemeet-telemed-addon') . $e->getMessage());
            return false;
        }
    }

    public function store_error_in_table($response, $appointment_id = 0)
    {
        if (is_wp_error($response)) {

            $error_data = [
                'error_code' => $response->get_error_code() ?? '',
                'error_message' => $response->get_error_message() ?? ''
            ];

            KCGMAppointmentGoogleMeetMapping::create([
                'appointmentId' => $appointment_id,
                'eventId' => -1,
                'url' => -1,
                'password' => -1,
                'extra' => json_encode($error_data),
                'createdAt' => current_time('mysql')
            ]);
        }
    }

    public function is_doctor_telemed_connected(): bool
    {
        $is_connected = get_user_meta($this->doctor_id, 'kiviCare_google_meet_connect', true);
        return $is_connected === 'on';
    }

    private function format_google_event_data($meeting_data): array
    {
        $default_settings = $this->get_config_value('default_settings', []);
        $timezone = $meeting_data['timezone'] ?? wp_timezone_string();

        $start_datetime = new DateTime($meeting_data['start_time'], new DateTimeZone($timezone));
        $end_datetime = new DateTime($meeting_data['end_time'], new DateTimeZone($timezone));

        $google_data = [
            'summary' => $meeting_data['topic'] ?? 'Telemedical Consultation',
            'description' => $meeting_data['topic'] ?? 'Telemedical Consultation',
            'start' => [
                'dateTime' => $start_datetime->format('Y-m-d\TH:i:sP'),
                'timeZone' => $timezone
            ],
            'end' => [
                'dateTime' => $end_datetime->format('Y-m-d\TH:i:sP'),
                'timeZone' => $timezone
            ],
            'conferenceData' => [
                'createRequest' => [
                    'requestId' => wp_generate_uuid4(),
                    'conferenceSolutionKey' => [
                        'type' => 'hangoutsMeet'
                    ]
                ]
            ],
            'reminders' => [
                'useDefault' => $default_settings['reminders'] ?? true
            ]
        ];

        // Filter out empty email addresses
        if (!empty($meeting_data['attendees'])) {
            $valid_attendees = array_filter($meeting_data['attendees'], function ($email) {
                return !empty($email) && filter_var($email, FILTER_VALIDATE_EMAIL);
            });

            if (!empty($valid_attendees)) {
                $google_data['attendees'] = array_map(function ($email) {
                    return ['email' => $email];
                }, $valid_attendees);
            }
        }

        if ($meeting_data['type'] === 'recurring') {
            $google_data['recurrence'] = [
                'RRULE:FREQ=DAILY;COUNT=30'
            ];
        }

        return $google_data;
    }

    private function make_api_request($method, $endpoint, $data = [], $doctor_id = 0): array|WP_Error
    {
        if (empty($endpoint) || !is_string($endpoint)) {
            $this->log('error', __('Invalid endpoint for API request', 'kivicare-googlemeet-telemed-addon'), [
                'method' => $method,
                'endpoint' => $endpoint
            ]);
            return new WP_Error('invalid_endpoint', __('Invalid endpoint provided', 'kivicare-googlemeet-telemed-addon'));
        }

        // Use the passed doctor_id, fall back to instance doctor_id if not provided
        $target_doctor_id = $doctor_id ?: $this->doctor_id;

        $access_token = $this->get_access_token($target_doctor_id);

        if (is_wp_error($access_token)) {
            $this->log('error', __('Failed to get access token for API request', 'kivicare-googlemeet-telemed-addon'), ['doctor_id' => $target_doctor_id]);
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
            $this->log('error', __('API request failed: ', 'kivicare-googlemeet-telemed-addon') . $response->get_error_message(), [
                'endpoint' => $endpoint,
                'method' => $method
            ]);
            return $response;
        }

        $response_code = wp_remote_retrieve_response_code($response);
        $body = wp_remote_retrieve_body($response);

        if ($response_code >= 200 && $response_code < 300) {
            if (empty($body) && $method === 'DELETE') {
                return ['success' => true];
            }

            $decoded = json_decode($body, true);
            return $decoded !== null ? $decoded : ['success' => true];
        }

        $error_data = json_decode($body, true) ?: [];
        $error_message = $error_data['error']['message'] ?? __('Unknown error', 'kivicare-googlemeet-telemed-addon');
        $error_code = $response_code;

        switch ($response_code) {
            case 401:
                $error_message = __('Authentication error: Invalid or expired token', 'kivicare-googlemeet-telemed-addon');
                break;
            case 403:
                $error_message = __('Permission denied: Check API scopes or quotas', 'kivicare-googlemeet-telemed-addon');
                break;
            case 404:
                $error_message = __('Resource not found', 'kivicare-googlemeet-telemed-addon');
                break;
        }

        $this->log('error', __('API request returned error', 'kivicare-googlemeet-telemed-addon'), [
            'endpoint' => $endpoint,
            'method' => $method,
            'status_code' => $response_code,
            'error' => $error_data
        ]);

        return new WP_Error('api_error', $error_message, [
            'code' => $error_code,
            'data' => $error_data
        ]);
    }
}
