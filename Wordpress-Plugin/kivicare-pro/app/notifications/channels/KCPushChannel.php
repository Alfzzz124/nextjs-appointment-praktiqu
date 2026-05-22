<?php

namespace KCProApp\notifications\channels;

use KCProApp\abstracts\KCAbstractNotificationChannel;
use KCApi\pushNotifications\KCPushNotificationSender;

if (!defined('ABSPATH')) {
    exit; // Exit if accessed directly
}

/**
 * Push Notification Channel (Firebase FCM via KiviCare API)
 * 
 * @package KCProApp\notifications\channels
 * @version 1.0.0
 * @author KiviCare Team
 */
class KCPushChannel extends KCAbstractNotificationChannel
{
    protected string $channelName = 'push';

    /**
     * Initialize channel
     */
    protected function init(): void
    {
        // No specific initialization needed
    }

    /**
     * Load configuration
     */
    protected function loadConfiguration(): void
    {
        // Configuration is handled globally in KiviCare API onesignal_config
    }

    /**
     * Validate if the push notification system is ready
     */
    protected function validateConfiguration(): bool
    {
        // 1. KiviCare API plugin must be active
        if (!class_exists('KCApi\pushNotifications\KCPushNotificationSender')) {
            return false;
        }

        // 2. Firebase credentials must be configured
        $config = get_option(KIVI_CARE_PREFIX . 'onesignal_config', []);
        return !empty($config['privat_key']) && 
               !empty($config['client_emaail']) && 
               !empty($config['project_id']);
    }

    /**
     * Send push notification
     */
    public function send(array $recipients, string $subject, string $content, array $data = []): bool
    {
        if (!$this->isConfigured()) {
            $this->log('error', 'Push notification channel not properly configured');
            return false;
        }

        $userId = $recipients['user_id'] ?? 0;
        if (empty($userId)) {
            $this->log('error', 'No user_id provided for push notification');
            return false;
        }

        try {
            $sender = KCPushNotificationSender::get_instance();
            
            // Format data payload for Firebase
            $processedData = array_merge($data, [
                'subject' => $subject,
                'sent_at' => current_time('mysql', true)
            ]);

            return $sender->sendToUser((int) $userId, $subject, $content, $processedData);
        } catch (\Exception $e) {
            $this->log('error', 'Failed to send push notification: ' . $e->getMessage());
            return false;
        }
    }
}
