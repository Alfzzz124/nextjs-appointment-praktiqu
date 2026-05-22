<?php

namespace KCProApp\abstracts;

use KCProApp\interfaces\KCNotificationChannel;
use App\baseClasses\KCErrorLogger;

if (!defined('ABSPATH')) {
    exit; // Exit if accessed directly
}

/**
 * Abstract Notification Channel
 * Base class for all notification channel implementations
 * 
 * @package KCProApp\abstracts
 * @version 1.0.0
 * @author KiviCare Team
 */
abstract class KCAbstractNotificationChannel implements KCNotificationChannel
{
    /**
     * Channel configuration
     * @var array
     */
    protected array $config = [];
    
    /**
     * Channel name/identifier
     * @var string
     */
    protected string $channelName = '';
    
    /**
     * Maximum retry attempts for failed sends
     * @var int
     */
    protected int $maxRetries = 3;
    
    /**
     * Delay between retries (in seconds)
     * @var int
     */
    protected int $retryDelay = 5;
    
    /**
     * Constructor
     */
    public function __construct()
    {
        $this->loadConfiguration();
        $this->init();
    }
    
    /**
     * Initialize channel-specific settings
     */
    abstract protected function init(): void;
    
    /**
     * Load configuration from database or options
     */
    abstract protected function loadConfiguration(): void;
    
    /**
     * Validate configuration before sending
     */
    abstract protected function validateConfiguration(): bool;
    
    /**
     * Get channel name
     */
    public function getChannelName(): string
    {
        return $this->channelName;
    }
    
    /**
     * Check if channel is properly configured
     */
    public function isConfigured(): bool
    {
        return $this->validateConfiguration();
    }
    
    /**
     * Validate recipients data
     */
    protected function validateRecipients(array $recipients): bool
    {
        return !empty($recipients) && 
               (!empty($recipients['phone']) || !empty($recipients['email']));
    }
    
    /**
     * Sanitize content for the specific channel
     */
    protected function sanitizeContent(string $content): string
    {
        // Remove dangerous HTML and scripts
        $content = wp_strip_all_tags($content);
        
        // Normalize whitespace
        $content = preg_replace('/\s+/', ' ', $content);
        
        return trim($content);
    }
    
    /**
     * Log channel activity
     */
    protected function log(string $level, string $message, array $context = []): void
    {
        $logMessage = sprintf(
            '[%s] %s: %s',
            $this->channelName,
            strtoupper($level),
            $message
        );
        
        if (!empty($context)) {
            $logMessage .= ' ' . wp_json_encode($context);
        }
        
        KCErrorLogger::instance()->error($logMessage);
    }
    
    
    
    /**
     * Format phone number to international format
     */
    protected function formatPhoneNumber(string $phone): string
    {
        // Remove all non-numeric characters
        $phone = preg_replace('/[^0-9]/', '', $phone);
        
        // Add country code if missing (default to US)
        $defaultCountryCode = get_option('kc_default_country_code', '1');
        
        if (strlen($phone) === 10) {
            $phone = $defaultCountryCode . $phone;
        }
        
        return '+' . $phone;
    }
    
    /**
     * Validate phone number format
     */
    protected function isValidPhone(string $phone): bool
    {
        $formatted = $this->formatPhoneNumber($phone);
        return preg_match('/^\+[1-9]\d{1,14}$/', $formatted);
    }
    
    /**
     * Validate email format
     */
    protected function isValidEmail(string $email): bool
    {
        return filter_var($email, FILTER_VALIDATE_EMAIL) !== false;
    }
    
    /**
     * Get configuration value
     */
    protected function getConfig(string $key, $default = null)
    {
        return $this->config[$key] ?? $default;
    }
    
    /**
     * Set configuration value
     */
    protected function setConfig(string $key, $value): void
    {
        $this->config[$key] = $value;
    }
}
