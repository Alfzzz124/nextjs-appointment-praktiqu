<?php

namespace KCProApp\controllers\filters;

use App\baseClasses\KCErrorLogger;
use KCProApp\models\KCGdprConsent;

defined('ABSPATH') or die('Something went wrong');

class KCPGdprRegistrationFilters
{
    private static ?KCPGdprRegistrationFilters $instance = null;

    public function __construct()
    {
        // Hook into user registration successfully completed in Lite AuthController
        add_action('kivicare_after_user_register', [$this, 'processRegistrationConsent'], 10, 2);
    }

    public static function get_instance(): ?KCPGdprRegistrationFilters
    {
        if (!isset(self::$instance)) {
            self::$instance = new self();
        }
        return self::$instance;
    }

    /**
     * Process GDPR consent when a user registers.
     *
     * @param int   $userId The newly registered user ID
     * @param array $params The registration payload parameters
     * @return void
     */
    public function processRegistrationConsent(int $userId, array $params): void
    {
        try {
            // Handle both single consent object and array of consents
            $consents = [];
            
            if (!empty($params['gdpr_consent']) && is_array($params['gdpr_consent'])) {
                // Check if it's a single consent object or array of consents
                if (isset($params['gdpr_consent']['consent_type'])) {
                    // Single consent object
                    $consents[] = $params['gdpr_consent'];
                } else {
                    // Array of consent objects
                    $consents = $params['gdpr_consent'];
                }
            }

            if (empty($consents)) {
                return; // No consent data sent
            }

            foreach ($consents as $consentData) {
                $consentType      = isset($consentData['consent_type'])       ? sanitize_text_field($consentData['consent_type'])       : '';
                $consentVersionId = isset($consentData['consent_version_id']) ? sanitize_text_field($consentData['consent_version_id']) : '';

                if (empty($consentType)) {
                    KCErrorLogger::instance()->error("Missing consent_type for user #{$userId}");
                    continue;
                }

                if (empty($consentVersionId)) {
                    KCErrorLogger::instance()->error("Missing consent_version_id for user #{$userId}, consent_type: {$consentType}");
                    continue;
                }

                $consent                     = new KCGdprConsent();
                $consent->user_id            = $userId;
                $consent->consent_type       = $consentType;
                $consent->consent_version_id = $consentVersionId;
                $consent->status             = 'granted';
                $consent->granted_at         = current_time('mysql');
                $consent->ip_address         = $_SERVER['REMOTE_ADDR'] ?? null;
                $consent->user_agent         = $_SERVER['HTTP_USER_AGENT'] ?? null;
                $consent->method             = 'web_form';
                $consent->proof_reference    = 'User registration checkbox';
                $consent->created_at         = current_time('mysql');
                $consent->save();
            }

        } catch (\Exception $e) {
            // Log error but never fatal the user registration process
            KCErrorLogger::instance()->error('Failed to log registration consent: ' . $e->getMessage());
        }
    }
}
