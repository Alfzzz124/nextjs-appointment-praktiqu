<?php

namespace KCProApp\notifications\channels;

use KCProApp\abstracts\KCAbstractNotificationChannel;

if (!defined('ABSPATH')) {
    exit; // Exit if accessed directly
}

/**
 * Email Notification Channel (using wp_mail)
 * 
 * @package KCProApp\notifications\channels
 * @version 1.0.0
 * @author KiviCare Team
 */
class KCEmailChannel extends KCAbstractNotificationChannel
{
    protected string $channelName = 'email';

    /**
     * Initialize channel
     */
    protected function init(): void
    {
        // No specific initialization needed for wp_mail
    }

    /**
     * Load configuration
     */
    protected function loadConfiguration(): void
    {
        // wp_mail uses global WordPress / server settings
    }

    /**
     * Validate configuration
     */
    protected function validateConfiguration(): bool
    {
        return true; // wp_mail is always "available" as a function
    }

    /**
     * Send email notification
     */
    public function send(array $recipients, string $subject, string $content, array $data = []): bool
    {
        $email = $recipients['email'] ?? '';
        if (empty($email)) {
            $this->log('error', 'No email address provided in recipients');
            return false;
        }

        if (!$this->isValidEmail($email)) {
            $this->log('error', 'Invalid email address format', ['email' => $email]);
            return false;
        }

        try {
            // Allow HTML in emails
            add_filter('wp_mail_content_type', [$this, 'setHtmlContentType']);
            
            $result = wp_mail($email, $subject, $content);
            
            // Revert content type to default
            remove_filter('wp_mail_content_type', [$this, 'setHtmlContentType']);

            if (!$result) {
                $this->log('error', 'wp_mail failed to send email', ['to' => $email]);
                return false;
            }

            return true;
        } catch (\Exception $e) {
            $this->log('error', 'Failed to send email: ' . $e->getMessage());
            return false;
        }
    }

    /**
     * Set content type to HTML
     */
    public function setHtmlContentType(): string
    {
        return 'text/html';
    }
}
