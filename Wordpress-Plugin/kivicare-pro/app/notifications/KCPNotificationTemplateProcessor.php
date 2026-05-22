<?php

namespace KCProApp\notifications;

use App\baseClasses\KCNotificationDynamicKeys;

defined('ABSPATH') or die('Something went wrong');

/**
 * Notification Template Processor - Handles dynamic key replacement and template processing for notifications
 */
class KCPNotificationTemplateProcessor
{
    private KCNotificationDynamicKeys $dynamicKeys;
    private static ?KCPNotificationTemplateProcessor $instance = null;

    public function __construct()
    {
        $this->dynamicKeys = new KCNotificationDynamicKeys();
    }

    public static function get_instance(): KCPNotificationTemplateProcessor
    {
        if (self::$instance === null) {
            self::$instance = new self();
        }
        return self::$instance;
    }

    /**
     * Process template content with dynamic data replacement
     */
    public function processTemplate(string $templateContent, array $data = []): string
    {
        // Replace dynamic keys with actual data
        $processedContent = $this->replaceDynamicKeys($templateContent, $data);
        
        // Convert HTML to plain text for notification
        $processedContent = $this->convertHtmlToText($processedContent);
        
        // Apply filters for custom processing
        $processedContent = apply_filters('kivicare_process_notification_template', $processedContent, $data);
        
        return $processedContent;
    }

    /**
     * Replace dynamic keys with actual data
     */
    public function replaceDynamicKeys(string $content, array $data): string
    {
        // Extract all dynamic keys from content
        $keysInContent = $this->dynamicKeys->extractKeysFromContent($content);
        
        if (empty($keysInContent)) {
            return $content;
        }

        // Process each key
        foreach ($keysInContent as $key) {
            $keyName = $this->extractKeyName($key);
            $value = $this->getKeyValue($keyName, $data);
            
            if ($value !== null) {
                $content = str_replace($key, $value, $content);
            }
        }

        return $content;
    }

    /**
     * Extract content variables for Twilio Content SID
     * Returns a comprehensive associative array of all available data
     */
    public function extractContentVariables(string $content, array $data): array
    {
        $variables = [];
        
        // Get the complete key mapping which includes all available data
        $keyMapping = $this->getKeyMapping($data);
        
        // Add all mapped keys to variables
        foreach ($keyMapping as $key => $value) {
            if ($value !== null && $value !== '') {
                $variables[$key] = $value;
            }
        }
        
        // Add special keys
        $specialKeys = [
            'current_date',
            'current_date_time',
            'login_url',
            'widgets_login_url',
            'appointment_page_url',
            'site_url'
        ];
        
        foreach ($specialKeys as $keyName) {
            $value = $this->handleSpecialKeys($keyName, $data);
            if ($value !== null && $value !== '') {
                $variables[$keyName] = $value;
            }
        }
        
        // Add any direct data keys that aren't already included
        foreach ($data as $key => $value) {
            if (!isset($variables[$key]) && is_scalar($value) && $value !== '') {
                $variables[$key] = (string) $value;
            }
        }

        return $variables;
    }

    /**
     * Get value for a specific dynamic key
     */
    private function getKeyValue(string $keyName, array $data): ?string
    {
        // Handle nested data structure
        if (strpos($keyName, '.') !== false) {
            return $this->getNestedValue($keyName, $data);
        }

        // Direct mapping for common keys
        $keyMapping = $this->getKeyMapping($data);
        
        if (isset($keyMapping[$keyName])) {
            return $keyMapping[$keyName];
        }

        // Check if key exists directly in data
        if (isset($data[$keyName])) {
            return (string) $data[$keyName];
        }

        // Handle special dynamic keys
        return $this->handleSpecialKeys($keyName, $data);
    }

    /**
     * Get nested value from data array
     */
    private function getNestedValue(string $keyPath, array $data): ?string
    {
        $keys = explode('.', $keyPath);
        $value = $data;
        
        foreach ($keys as $key) {
            if (!isset($value[$key])) {
                return null;
            }
            $value = $value[$key];
        }
        
        return is_array($value) ? null : (string) $value;
    }

    /**
     * Get comprehensive key mapping from data
     */
    private function getKeyMapping(array $data): array
    {
        $mapping = [];

        // Appointment data mapping
        if (isset($data['appointment'])) {
            $appointment = $data['appointment'];
            $mapping['appointment_date'] = $appointment['appointment_start_date'] ?? '';
            $mapping['appointment_time'] = $appointment['appointment_start_time'] ?? '';
            $mapping['appointment_id'] = $appointment['id'] ?? '';
            $mapping['service_name'] = $appointment['service_name'] ?? '';
            $mapping['total_amount'] = $appointment['total_amount'] ?? '';
        }

        // Patient data mapping
        if (isset($data['patient'])) {
            $patient = $data['patient'];
            $mapping['patient_name'] = $patient['display_name'] ?? $patient['user_nicename'] ?? '';
            $mapping['patient_email'] = $patient['email'] ?? '';
            $mapping['patient_contact_number'] = $patient['mobile_number'] ?? '';
        }

        // Doctor data mapping
        if (isset($data['doctor'])) {
            $doctor = $data['doctor'];
            $mapping['doctor_name'] = $doctor['display_name'] ?? $doctor['user_nicename'] ?? '';
            $mapping['doctor_email'] = $doctor['email'] ?? '';
            $mapping['doctor_contact_number'] = $doctor['mobile_number'] ?? '';
        }

        // Clinic data mapping
        if (isset($data['clinic'])) {
            $clinic = $data['clinic'];
            $mapping['clinic_name'] = $clinic['name'] ?? '';
            $mapping['clinic_email'] = $clinic['email'] ?? '';
            // Use ternary to handle empty strings, not just null values
            $mapping['clinic_contact_number'] = !empty($clinic['telephone_no']) ? $clinic['telephone_no'] : ($clinic['mobile_number'] ?? '');
            $mapping['clinic_address'] = $this->formatClinicAddress($clinic);
        }

        // User data mapping (for registration)
        if (isset($data['user_email'])) {
            $mapping['user_email'] = $data['user_email'];
        }
        if (isset($data['user_name'])) {
            $mapping['user_name'] = $data['user_name'];
        }
        if (isset($data['user_password'])) {
            $mapping['user_password'] = $data['user_password'];
        }
        if (isset($data['user_role'])) {
            $mapping['user_role'] = $data['user_role'];
        }
        if (isset($data['user_contact'])) {
            $mapping['user_contact'] = $data['user_contact'];
        }

        // Video conference links
        if (isset($data['zoom_link'])) {
            $mapping['zoom_link'] = $data['zoom_link'];
        }
        if (isset($data['add_doctor_zoom_link'])) {
            $mapping['add_doctor_zoom_link'] = $data['add_doctor_zoom_link'];
        }
        if (isset($data['meet_link'])) {
            $mapping['meet_link'] = $data['meet_link'];
        }
        if (isset($data['meet_event_link'])) {
            $mapping['meet_event_link'] = $data['meet_event_link'];
        }

        // Prescription data
        if (isset($data['prescription'])) {
            $mapping['prescription'] = $data['prescription'];
        }

        return $mapping;
    }

    /**
     * Handle special dynamic keys that require computation
     */
    private function handleSpecialKeys(string $keyName, array $data): ?string
    {
        switch ($keyName) {
            case 'current_date':
                return current_time('Y-m-d');
                
            case 'current_date_time':
                return current_time('Y-m-d H:i:s');
                
            case 'login_url':
                return wp_login_url();
                
            case 'widgets_login_url':
                return $this->getWidgetsLoginUrl();
                
            case 'appointment_page_url':
                return $this->getAppointmentPageUrl();
                
            case 'site_url':
                return get_site_url();
                
            default:
                // Try to get from WordPress options or custom functions
                return $this->getCustomKeyValue($keyName, $data);
        }
    }

    /**
     * Get custom key value from hooks or options
     */
    private function getCustomKeyValue(string $keyName, array $data): ?string
    {
        // Allow plugins to provide custom key values
        $customValue = apply_filters('kivicare_custom_notification_key_value', null, $keyName, $data);
        
        if ($customValue !== null) {
            return (string) $customValue;
        }

        // Check WordPress options
        $optionValue = get_option('kivicare_notification_key_' . $keyName);
        if ($optionValue !== false) {
            return (string) $optionValue;
        }

        return null;
    }

    /**
     * Extract key name from dynamic key (remove {{ and }})
     */
    private function extractKeyName(string $key): string
    {
        return trim(str_replace(['{{', '}}'], '', $key));
    }

    /**
     * Format clinic address from clinic data
     */
    private function formatClinicAddress(array $clinic): string
    {
        $addressParts = array_filter([
            $clinic['address'] ?? '',
            $clinic['city'] ?? '',
            $clinic['postal_code'] ?? '',
            $clinic['country'] ?? ''
        ]);
        
        return implode(', ', $addressParts);
    }

    /**
     * Convert HTML content to plain text for notification
     */
    private function convertHtmlToText(string $content): string
    {
        // Replace <br> and <p> tags with line breaks
        $content = str_replace(['<br>', '<br/>', '<br />', '</p>'], "\n", $content);
        $content = str_replace('<p>', '', $content);
        
        // Remove all HTML tags
        $content = wp_strip_all_tags($content);
        
        // Clean up multiple line breaks
        $content = preg_replace('/\n\s*\n/', "\n\n", $content);
        
        // Trim whitespace
        $content = trim($content);
        
        return $content;
    }

    /**
     * Get widgets login URL
     */
    private function getWidgetsLoginUrl(): string
    {
        $page = get_option('kivicare_widget_login_page');
        return $page ? get_permalink($page) : wp_login_url();
    }

    /**
     * Get appointment booking page URL
     */
    private function getAppointmentPageUrl(): string
    {
        $page = get_option('kivicare_appointment_page');
        return $page ? get_permalink($page) : home_url('/appointments');
    }

    /**
     * Validate template against available keys
     */
    public function validateTemplate(string $templateName, string $content): array
    {
        return $this->dynamicKeys->validateTemplateKeys($templateName, $content);
    }

    /**
     * Get available keys for a template
     */
    public function getAvailableKeys(string $templateName): array
    {
        return $this->dynamicKeys->getDynamicKeys($templateName);
    }

    /**
     * Preview template with sample data
     */
    public function previewTemplate(string $templateContent, string $templateName): string
    {
        $sampleData = $this->getSampleDataForTemplate($templateName);
        return $this->processTemplate($templateContent, $sampleData);
    }

    /**
     * Get sample data for template preview
     */
    public function getSampleDataForTemplate(string $templateName): array
    {
        $sampleData = [
            'appointment' => [
                'id' => '123',
                'appointment_start_date' => '2024-08-15',
                'appointment_start_time' => '10:00 AM',
                'service_name' => 'General Consultation',
                'total_amount' => '$50.00'
            ],
            'patient' => [
                'display_name' => 'John Doe',
                'email' => 'john.doe@example.com',
                'mobile_number' => '+1234567890'
            ],
            'doctor' => [
                'display_name' => 'Dr. Smith',
                'email' => 'dr.smith@clinic.com',
                'mobile_number' => '+1234567891'
            ],
            'clinic' => [
                'name' => 'Sample Medical Clinic',
                'email' => 'info@clinic.com',
                'telephone_no' => '+1234567892',
                'address' => '123 Medical St',
                'city' => 'Healthcare City',
                'postal_code' => '12345',
                'country' => 'USA'
            ],
            'user_email' => 'user@example.com',
            'user_name' => 'sampleuser',
            'user_password' => 'temp123',
            'user_role' => 'patient',
            'zoom_link' => 'https://zoom.us/j/123456789',
            'meet_link' => 'https://meet.google.com/abc-defg-hij',
            'prescription' => 'Sample prescription details'
        ];

        return apply_filters('kivicare_notification_template_sample_data', $sampleData, $templateName);
    }

    /**
     * Format notification content for different channels
     */
    public function formatForChannel(string $content, string $channel = 'notification'): string
    {
        switch ($channel) {
            case 'whatsapp':
                return $this->formatForWhatsApp($content);
            case 'notification':
            default:
                return $this->formatForNotification($content);
        }
    }

    /**
     * Format content for notification (character limit: 160)
     */
    private function formatForNotification(string $content): string
    {
        // Limit to 160 characters for single notification
        return substr($content, 0, 160);
    }

    /**
     * Format content for WhatsApp (character limit: 4096)
     */
    private function formatForWhatsApp(string $content): string
    {
        // WhatsApp allows up to 4096 characters
        return substr($content, 0, 4096);
    }
}