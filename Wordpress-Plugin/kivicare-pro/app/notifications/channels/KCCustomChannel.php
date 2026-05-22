<?php

namespace KCProApp\notifications\channels;

use App\models\KCCustomNotification;
use Exception;
use KCProApp\abstracts\KCAbstractNotificationChannel;

if (!defined('ABSPATH')) {
    exit; // Exit if accessed directly
}

/**
 * Custom Notification Channel for handling various notification services
 * 
 * @package KCProApp\notifications\channels
 * @version 1.0.0
 * @author KiviCare Team
 */
class KCCustomChannel extends KCAbstractNotificationChannel
{
    protected string $channelName = 'custom';
    private ?array $serviceConfig = null;
    private int $serviceId;

    /**
     * Initialize channel-specific settings
     */
    protected function init(): void
    {
        // Channel-specific initialization
    }

    /**
     * Load configuration from database
     */
    protected function loadConfiguration(): void
    {
        // Configuration will be loaded per service in send method
    }

    /**
     * Validate configuration before sending
     */
    protected function validateConfiguration(): bool
    {
        return $this->serviceConfig !== null &&
            !empty($this->serviceConfig['server_url']) &&
            $this->serviceConfig['is_active'];
    }

    /**
     * Send notification through all active custom services
     */
    public function send(array $recipients, string $subject, string $content, array $data = []): bool
    {
        try {
            if (!$this->validateRecipients($recipients)) {
                $this->log('error', 'Invalid recipients data provided');
                return false;
            }

            // Get all active services
            $activeServices = KCCustomNotification::query()->where('is_active', 1)->get();

            if (empty($activeServices)) {
                $this->log('error', 'No active notification services found');
                return false;
            }

            $successCount = 0;
            $totalServices = count($activeServices);

            foreach ($activeServices as $service) {
                try {
                    $this->serviceId = $service->id;

                    // Load service configuration
                    $this->loadServiceConfig($this->serviceId);

                    if (!$this->isConfigured()) {
                        $this->log('warning', 'Service not properly configured, skipping', [
                            'service_id' => $this->serviceId,
                            'service_name' => $service->server_name
                        ]);
                        continue;
                    }

                    // Send notification through this service
                    $result = $this->sendCustomRequest($recipients, $subject, $content, $data);

                    if ($result) {
                        $this->log('info', 'Notification sent successfully through service', [
                            'service_id' => $this->serviceId,
                            'service_name' => $service->server_name,
                            'recipients' => $recipients
                        ]);
                        $successCount++;
                    } else {
                        $this->log('warning', 'Failed to send notification through service', [
                            'service_id' => $this->serviceId,
                            'service_name' => $service->server_name
                        ]);
                    }

                } catch (Exception $serviceException) {
                    $this->log('error', 'Service-specific error: ' . $serviceException->getMessage(), [
                        'service_id' => $this->serviceId,
                        'service_name' => $service->server_name ?? 'Unknown'
                    ]);
                    // Continue with next service
                }
            }

            $overallSuccess = $successCount > 0;

            $this->log('info', 'Notification sending completed', [
                'total_services' => $totalServices,
                'successful_sends' => $successCount,
                'overall_success' => $overallSuccess
            ]);

            return $overallSuccess;

        } catch (Exception $e) {
            $this->log('error', 'Send failed: ' . $e->getMessage(), [
                'recipients' => $recipients
            ]);
            return false;
        }
    }

    /**
     * Load service configuration from database
     */
    private function loadServiceConfig(int $serviceId): void
    {
        $service = KCCustomNotification::find($serviceId);

        if ($service) {
            $this->serviceConfig = [
                'id' => $service->id,
                'server_type' => $service->server_type,
                'server_name' => $service->server_name,
                'server_url' => $service->server_url,
                'port' => $service->port,
                'http_method' => $service->http_method,
                'auth_method' => $service->auth_method,
                'auth_config' => json_decode($service->auth_config ?? '{}', true) ?: [],
                'sender_name' => $service->sender_name,
                'sender_email' => $service->sender_email,
                'enable_ssl' => (bool) $service->enable_ssl,
                'content_type' => $service->content_type,
                'custom_headers' => json_decode($service->custom_headers??'{}', true) ?: [],
                'query_params' => json_decode($service->query_params??'{}', true) ?: [],
                'request_body' => $service->request_body,
                'is_active' => (bool) $service->is_active
            ];
        }
    }

    /**
     * Send custom request to configured service
     */
    private function sendCustomRequest(array $recipients, string $subject, string $content, array $data): bool
    {
        $headers = ['Content-Type' => $this->serviceConfig['content_type']];

        // Add authentication headers
        $this->addAuthenticationHeaders($headers);

        // Add custom headers
        $this->addCustomHeaders($headers);

        // Prepare request body
        $body = $this->prepareRequestBody($recipients, $subject, $content, $data);


        // Prepare URL with query parameters
        $url = $this->prepareRequestUrl();

        // Configure request arguments
        $args = [
            'method' => $this->serviceConfig['http_method'],
            'headers' => $headers,
            'timeout' => 30,
        ];

        // Add body for POST/PUT/PATCH requests
        if (in_array($this->serviceConfig['http_method'], ['POST', 'PUT', 'PATCH']) && !empty($body)) {
            $content_type = $args['headers']['Content-Type'] ?? 'application/x-www-form-urlencoded';

            if (stripos($content_type, 'application/json') !== false) {
                // Ensure body is JSON
                if (!is_array($body)) {
                    $decoded = json_decode($body, true);
                    if (json_last_error() === JSON_ERROR_NONE) {
                        $args['body'] = wp_json_encode($decoded);
                    } else {
                        $args['body'] = $body; // already raw JSON string
                    }
                } else {
                    $args['body'] = wp_json_encode($body);
                }

            } elseif (stripos($content_type, 'application/x-www-form-urlencoded') !== false) {
                // Ensure proper URL encoding
                if (is_string($body)) {
                    // replace + with %2B before parsing to avoid losing +
                    $safe_body = str_replace('+', '%2B', $body);
                    parse_str($safe_body, $parsed);
                    $args['body'] = http_build_query($parsed);
                } else {
                    $args['body'] = http_build_query((array) $body);
                }
            } else {
                // Fallback: send raw
                $args['body'] = $body;
            }
        }

        // Apply filters to allow modification of URL and request arguments
        $url = apply_filters('kc_custom_notification_request_url', $url, $this->serviceConfig, $recipients, $subject, $content, $data);
        $args = apply_filters('kc_custom_notification_request_args', $args, $this->serviceConfig, $recipients, $subject, $content, $data);

        // Send request
        $response = wp_remote_request($url, $args);


        if (is_wp_error($response)) {
            throw new Exception('HTTP request failed: ' . $response->get_error_message());
        }

        $responseCode = wp_remote_retrieve_response_code($response);

        // Consider 2xx status codes as success
        return $responseCode >= 200 && $responseCode < 300;
    }

    /**
     * Add authentication headers based on configured method
     */
    private function addAuthenticationHeaders(array &$headers): void
    {
        $authConfig = $this->serviceConfig['auth_config'];

        switch ($this->serviceConfig['auth_method']) {
            case 'apikey':
                if (!empty($authConfig['api_key'])) {
                    $headers['Authorization'] = $authConfig['api_key'];
                }
                break;

            case 'basic':
                if (!empty($authConfig['username']) && !empty($authConfig['password'])) {
                    $headers['Authorization'] = 'Basic ' . base64_encode(
                        $authConfig['username'] . ':' . $authConfig['password']
                    );
                }
                break;

            case 'bearer':
                if (!empty($authConfig['token'])) {
                    $headers['Authorization'] = 'Bearer ' . $authConfig['token'];
                    break;
                }

                if (!empty($authConfig['access_token'])) {
                    // Check if token is expired
                    if (!empty($authConfig['token_expiry'])) {
                        $expiryTime = strtotime($authConfig['token_expiry']);
                        if ($expiryTime && $expiryTime <= time()) {
                            $this->log('warning', 'OAuth token expired', [
                                'service_id' => $this->serviceId,
                                'expiry' => $authConfig['token_expiry']
                            ]);
                            return;
                        }
                    }
                    $headers['Authorization'] = 'Bearer ' . $authConfig['access_token'];
                }
                break;
        }
    }

    /**
     * Add custom headers from configuration
     */
    private function addCustomHeaders(array &$headers): void
    {
        foreach ($this->serviceConfig['custom_headers'] as $header) {
            if (!empty($header['key']) && !empty($header['value'])) {
                $headers[$header['key']] = $header['value'];
            }
        }
    }

    /**
     * Prepare request URL with query parameters
     */
    private function prepareRequestUrl(): string
    {
        $url = $this->serviceConfig['server_url'];

        if (!empty($this->serviceConfig['query_params'])) {
            $queryString = http_build_query(
                array_filter($this->serviceConfig['query_params'], function ($param) {
                    return !empty($param['key']) && !empty($param['value']);
                })
            );

            if ($queryString) {
                $url .= (strpos($url, '?') !== false ? '&' : '?') . $queryString;
            }
        }

        return $url;
    }

    /**
     * Prepare request body with variable substitution
     */
    private function prepareRequestBody(array $recipients, string $subject, string $content, array $data): string
    {
        $body = urldecode($this->serviceConfig['request_body']) ?: '';

        // Replace template variables
        $replacements = [
            '{{receiver_email}}' => $recipients['email'] ?? '',
            '{{receiver_number}}' => $recipients['phone'] ?? '',
            '{{subject}}' => $subject,
            '{{content}}' => $content,
            '{{timestamp}}' => current_time('mysql'),
            '{{clinic_name}}' => get_option('blogname', ''),
            '{{content_sid}}' => $data['content_sid'] ?? ''
        ];


        $body = str_replace(
            array_keys($replacements),
            array_values($replacements),
            $body
        );

        // Handle JSON content type
        if ($this->serviceConfig['content_type'] === 'application/json') {
            return json_encode($body);
        }

        return $body;
    }
}