<?php

namespace KCProApp\notifications\channels;

use App\models\KCOption;
use Exception;
use KCProApp\abstracts\KCAbstractNotificationChannel;

if (!defined('ABSPATH')) {
    exit; // Exit if accessed directly
}

/**
 * Twilio Notification Channel (SMS & WhatsApp) using WordPress HTTP API
 * 
 * @package KCProApp\notifications\channels
 * @version 2.0.0
 * @author KiviCare Team
 */
class KCTwilioChannel extends KCAbstractNotificationChannel
{
    const TWILIO_API_BASE = 'https://api.twilio.com/2010-04-01/Accounts/';
    const SMS_MAX_LENGTH = 1600;
    const WHATSAPP_MAX_LENGTH = 4096;

    protected string $channelName = 'twilio';
    private array $whatsappConfig;
    private array $smsConfig;

    /**
     * Initialize channel-specific settings
     */
    protected function init(): void
    {
        // Channel-specific initialization if needed
    }

    /**
     * Load Twilio configurations from database
     */
    protected function loadConfiguration(): void
    {
        $whatsappData = KCOption::get('whatsapp_config_data',[
            'wa_account_id' => '',
            'wa_auth_token' => '',
            'wa_from_number' => ''
        ],'');
        $this->whatsappConfig = is_array($whatsappData) ? $whatsappData : [];

        $smsData = KCOption::get('sms_config_data', [
            'twilio_account_sid' => '',
            'twilio_auth_token' => '',
            'twilio_from_number' => ''
        ],'');
        $this->smsConfig = is_array($smsData) ? $smsData : [];
    }

    /**
     * Validate configuration before sending
     */
    protected function validateConfiguration(): bool
    {
        // Check if at least one service is configured
        $smsConfigured = !empty($this->smsConfig['twilio_account_sid']) &&
            !empty($this->smsConfig['twilio_auth_token']) &&
            !empty($this->smsConfig['twilio_from_number']);

        $whatsappConfigured = !empty($this->whatsappConfig['wa_account_id']) &&
            !empty($this->whatsappConfig['wa_auth_token']) &&
            !empty($this->whatsappConfig['wa_from_number']);

        return $smsConfigured || $whatsappConfigured;
    }

    /**
     * Send notification through Twilio (SMS or WhatsApp)
     */
    public function send(array $recipients, string $subject, string $content, array $data = []): bool
    {
        if (!$this->validateRecipients($recipients)) {
            $this->log('error', 'Invalid recipients data provided');
            return false;
        }

        $phone = $recipients['phone'] ?? '';
        if (empty($phone)) {
            $this->log('error', 'No phone number provided in recipients');
            return false;
        }

        if (!$this->isValidPhone($phone)) {
            $this->log('error', 'Invalid phone number format', ['phone' => $phone]);
            return false;
        }

        $channelTypes = $data['twilio_channel'] ?? ['sms', 'whatsapp'];
        if (is_string($channelTypes)) {
            $channelTypes = [$channelTypes];
        }


        $overallSuccess = false;
        $formattedPhone = $this->formatPhoneNumber($phone);

        foreach ($channelTypes as $channelType) {
            try {
                $credentials = $this->getCredentials($channelType);
                if (!$credentials) {
                    continue;
                }

                $sent = false;
                if ($channelType === 'whatsapp') {
                    $sent = $this->sendWhatsApp(
                        $credentials['sid'],
                        $credentials['token'],
                        $formattedPhone,
                        $subject,
                        $content,
                        $credentials['from_number'],
                        $data
                    );
                } else { // Default to sms
                    $sent = $this->sendSMS(
                        $credentials['sid'],
                        $credentials['token'],
                        $formattedPhone,
                        $content,
                        $credentials['from_number'],
                        $data
                    );
                }

                if ($sent) {
                    $overallSuccess = true;
                }
            } catch (Exception $e) {
                $this->log('error', "Send failed for channel {$channelType}: " . $e->getMessage(), [
                    'phone' => $phone,
                    'channel' => $channelType
                ]);
            }
        }

        return $overallSuccess;
    }

    /**
     * Get credentials based on channel type
     */
    private function getCredentials(string $channelType): ?array
    {
        if ($channelType === 'whatsapp') {
            $sid = $this->whatsappConfig['wa_account_id'] ?? '';
            $token = $this->whatsappConfig['wa_auth_token'] ?? '';
            $fromNumber = $this->whatsappConfig['wa_to_number'] ?? '';
            $enable = $this->whatsappConfig['enableWhatsApp'] ?? false;
        } else {
            $sid = $this->smsConfig['account_id'] ?? '';
            $token = $this->smsConfig['auth_token'] ?? '';
            $fromNumber = $this->smsConfig['to_number'] ?? '';
            $enable = $this->smsConfig['enableSMS'] ?? false;
        }

        // Explicitly check for string 'true' or boolean true
        $enable = ($enable === 'true' || $enable === true || $enable === '1' || $enable === 1);

        if (empty($sid) || empty($token) || empty($fromNumber) || !$enable) {
            return null;
        }

        return [
            'sid' => $sid,
            'token' => $token,
            'from_number' => $fromNumber
        ];
    }

    /**
     * Send SMS message using WordPress HTTP API
     */
    private function sendSMS(
        string $sid,
        string $token,
        string $phone,
        string $content,
        string $from,
        array $data = []
    ): bool {
        $url = self::TWILIO_API_BASE . $sid . '/Messages.json';

        $body = [
            'To' => $phone,
            'From' => $from
        ];

        // Use Content SID approach if provided
        if (!empty($data['content_sid'])) {
            $body['ContentSid'] = $data['content_sid'];
            
            // Add content variables if provided
            if (!empty($data['content_variables']) && is_array($data['content_variables'])) {
                $body['ContentVariables'] = json_encode($data['content_variables']);
            }
        } else {
            // Fallback to traditional Body approach
            $body['Body'] = $this->sanitizeSmsContent($content);
        }

        return $this->sendTwilioRequest($url, $sid, $token, $body);
    }

    /**
     * Send WhatsApp message using WordPress HTTP API
     */
    private function sendWhatsApp(
        string $sid,
        string $token,
        string $phone,
        string $subject,
        string $content,
        string $from,
        array $data
    ): bool {
        $url = self::TWILIO_API_BASE . $sid . '/Messages.json';

        $body = [
            'To' => 'whatsapp:' . $phone,
            'From' => 'whatsapp:+' . str_replace('+', '', $from)
        ];

        // Use Content SID approach if provided
        if (!empty($data['content_sid'])) {
            $body['ContentSid'] = $data['content_sid'];
            
            // Add content variables if provided
            if (!empty($data['content_variables']) && is_array($data['content_variables'])) {
                $body['ContentVariables'] = json_encode($data['content_variables']);
            }
        } else {
            // Fallback to traditional Body approach
            $body['Body'] = $this->prepareWhatsAppContent($subject, $content, $data);
        }

        return $this->sendTwilioRequest($url, $sid, $token, $body);
    }

    /**
     * Send request to Twilio API using WordPress HTTP functions with enhanced error handling
     */
    private function sendTwilioRequest(
        string $url,
        string $sid,
        string $token,
        array $body
    ): bool {
        $args = [
            'method' => 'POST',
            'headers' => [
                'Authorization' => 'Basic ' . base64_encode($sid . ':' . $token),
                'Content-Type' => 'application/x-www-form-urlencoded'
            ],
            'body' => $body,
            'timeout' => 15,
            'user-agent' => 'KiviCare-Twilio-Client/1.0'
        ];

        $response = wp_remote_post($url, $args);

        if (is_wp_error($response)) {
            throw new Exception('HTTP Error: ' . $response->get_error_message());
        }

        $responseCode = wp_remote_retrieve_response_code($response);
        $responseBody = wp_remote_retrieve_body($response);

        if ($responseCode !== 201) {
            $error = $this->parseTwilioError($responseBody);
            throw new Exception("Twilio API error {$responseCode}: {$error}");
        }

        // Validate response data
        $responseData = json_decode($responseBody, true);
        if (json_last_error() !== JSON_ERROR_NONE) {
            throw new Exception('Invalid JSON response from Twilio');
        }

        return isset($responseData['sid']);
    }

    /**
     * Parse error message from Twilio response with enhanced error details
     */
    private function parseTwilioError(string $responseBody): string
    {
        $data = json_decode($responseBody, true);

        if (json_last_error() !== JSON_ERROR_NONE) {
            return 'Invalid response format';
        }

        if (isset($data['message'])) {
            return $data['message'];
        }

        if (isset($data['code'], $data['more_info'])) {
            return "Code {$data['code']} - {$data['more_info']}";
        }

        if (isset($data['error_code'], $data['error_message'])) {
            return "Error {$data['error_code']}: {$data['error_message']}";
        }

        return 'Unknown error occurred';
    }

    /**
     * Prepare WhatsApp content with enhanced formatting and interactive elements
     */
    private function prepareWhatsAppContent(string $subject, string $content, array $data): string
    {
        // Strip HTML tags and sanitize
        $text = wp_strip_all_tags($content);
        $text = preg_replace('/\s+/', ' ', $text);
        $text = trim($text);

        // Prepend subject if exists
        if (!empty($subject)) {
            $text = "*{$subject}*\n\n{$text}";
        }

        // Add clinic signature
        $signature = $this->getSignature();

        // Combine all parts and ensure length limit
        $fullContent = $text . $signature;

        return substr($fullContent, 0, self::WHATSAPP_MAX_LENGTH);
    }

    /**
     * Get clinic signature for messages
     */
    private function getSignature(): string
    {
        $clinicName = get_option('blogname', 'KiviCare');
        $clinicPhone = get_option('kivicare_clinic_phone', '');
        $clinicEmail = get_option('kivicare_clinic_email', '');

        $signature = "\n\n---\n_{$clinicName}_";

        if (!empty($clinicPhone)) {
            $signature .= "\n📞 {$clinicPhone}";
        }

        if (!empty($clinicEmail)) {
            $signature .= "\n✉️ {$clinicEmail}";
        }

        return $signature;
    }

    /**
     * Sanitize SMS content
     */
    private function sanitizeSmsContent(string $content): string
    {
        // Strip HTML tags and limit to SMS length
        $text = wp_strip_all_tags($content);
        return substr($text, 0, self::SMS_MAX_LENGTH);
    }
}
