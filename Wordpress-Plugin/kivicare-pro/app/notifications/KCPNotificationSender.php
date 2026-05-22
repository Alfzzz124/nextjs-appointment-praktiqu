<?php

namespace KCProApp\notifications;

use KCProApp\interfaces\KCNotificationChannel;
use App\baseClasses\KCErrorLogger;
use WP_Error;

defined('ABSPATH') or die('Something went wrong');

/**
 * Notification Sender - Handles sending notifications with template processing
 */
class KCPNotificationSender
{
    private KCPNotificationTemplateManager $templateManager;
    private KCPNotificationTemplateProcessor $templateProcessor;
    private array $channels = [];
    private static ?KCPNotificationSender $instance = null;

    public function __construct()
    {
        $this->templateManager = KCPNotificationTemplateManager::getInstance();
        $this->templateProcessor = KCPNotificationTemplateProcessor::get_instance();
    }

    public static function get_instance(): KCPNotificationSender
    {
        if (self::$instance === null) {
            self::$instance = new self();
        }
        return self::$instance;
    }

    public function registerChannel(string $name, KCNotificationChannel $channel): void
    {
        $this->channels[$name] = $channel;
    }

    public function getChannel(string $name): ?KCNotificationChannel
    {
        return $this->channels[$name] ?? null;
    }

    public function execute_notification(string $templateName, array $recipients, array $data, array $options): array|WP_Error
    {
        try {
            $template = $this->templateManager->getTemplate($templateName, 'sms_tmp');
            if (!$template) {
                return new WP_Error('template_not_found', 'Template not found');
            }

            $data['content_sid'] = $template?->content_sid ?? '';

            // Build content variables for Twilio Content SID if content_sid is present
            if (!empty($data['content_sid'])) {
                $data['content_variables'] = $this->templateProcessor->extractContentVariables($template->post_content, $data);
            }

            $processedContent = $this->templateProcessor->processTemplate($template->post_content, $data);
            if (empty($processedContent)) {
                return new WP_Error('template_processing_failed', 'Template processing resulted in empty content');
            }

            $subject = $options['subject'] ?? $template->post_title;
            $channels = $options['channels'] ?? ['twilio','custom','push'];
            $validChannels = $this->validateChannels($channels);

            if (empty($validChannels)) {
                return new WP_Error('no_valid_channels', 'No valid notification channels available');
            }

            return $this->sendThroughChannels($validChannels, $recipients, $subject, $processedContent, $data);
        } catch (\Exception $e) {
            return new WP_Error('notification_send_error', $e->getMessage());
        }
    }

    private function validateChannels(array $channels): array
    {
        return array_filter($channels, fn($channelName) => isset($this->channels[$channelName]));
    }

    private function sendThroughChannels(array $channels, array $recipients, string $subject, string $content, array $data): array
    {
        $results = [];
        foreach ($channels as $channelName) {
            $channel = $this->getChannel($channelName);
            if ($channel) {
                $results[$channelName] = $channel->send($recipients, $subject, $content, $data);
            }
        }
        return $results;
    }

    public function getRecipientFromAppointmentData(array $appointmentData, string $recipientType): ?array
    {
        $recipient = $appointmentData[$recipientType] ?? null;
        if (!$recipient) {
            return null;
        }
        return [
            'phone' => $recipient['mobile_number'] ?? $recipient['telephone_no'] ?? '',
            'email' => $recipient['email'] ?? '',
            'name' => $recipient['display_name'] ?? $recipient['name'] ?? '',
            'user_id' => $recipient['id'] ?? 0
        ];
    }

    /**
     * Test notification configuration by sending a test message
     * 
     * @param string $mobile Mobile number to send test message to
     * @param string $content Message content to send
     * @param array $data Additional data for template processing
     * @param array $options Channel options
     * @return bool|WP_Error True on success, WP_Error on failure
     */
    public function testNotificationConfiguration(string $mobile, string $content, array $data = [], array $options = []): bool|WP_Error
    {
        try {
            // Ensure notification system is initialized
            if (class_exists('KCProApp\notifications\KCPNotificationInit')) {
                \KCProApp\notifications\KCPNotificationInit::get_instance();
            }

            // Determine channels based on options
            $channelType = $options['twilio_channel'] ?? 'twilio';
            
            // Register channels if not already registered
            if (!$this->getChannel('twilio')) {
                $this->registerChannel('twilio', new \KCProApp\notifications\channels\KCTwilioChannel());
            }
            if (!$this->getChannel('sms')) {
                $this->registerChannel('sms', new \KCProApp\notifications\channels\KCTwilioChannel());
            }
            if (!$this->getChannel('whatsapp')) {
                $this->registerChannel('whatsapp', new \KCProApp\notifications\channels\KCTwilioChannel());
            }
            
            // Add channel type to data for the channel to use
            $data['twilio_channel'] = $channelType;

            // Get the channel and send directly
            $channel = $this->getChannel($channelType);
            if (!$channel) {
                KCErrorLogger::instance()->error("Channel not found: {$channelType}. Available channels: " . implode(', ', array_keys($this->channels)));
                return new WP_Error('channel_not_found', 'Notification channel not found');
            }

            // Prepare recipient data as expected by the Twilio channel
            $recipients = [
                'phone' => $mobile,
                'email' => '',
                'name' => 'Test User',
                'user_id' => 0
            ];

            // Send the test message
            $result = $channel->send($recipients, 'Test Message', $content, $data);
            if ($result) {
                return true;
            }

            return new WP_Error('test_send_failed', 'Failed to send test message');
        } catch (\Exception $e) {
            return new WP_Error('test_send_error', $e->getMessage());
        }
    }
}
