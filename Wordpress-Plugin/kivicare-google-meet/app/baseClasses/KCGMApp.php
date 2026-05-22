<?php

namespace KCGMApp\baseClasses;

use App\baseClasses\KCModuleRegistry;
use KCGMApp\controllers\api\KCGMGoogleMeetController;
use KCGMApp\controllers\filters\KCGMAppointmentControllerFilters;
use KCGMApp\googlemeet\KCGMGoogleMeet;

defined('ABSPATH') || exit;

final class KCGMApp
{
    public function init()
    {
        add_action('init', [$this, 'load_text_domain']);
        add_filter('kc_telemed_providers', [$this, 'register_providers']);
        add_action('kivicare_register_modules', [$this, 'register_google_meet_modules']);
        add_action('kivicare_after_register_routes_appointments/base', [KCGMAppointmentControllerFilters::class, 'get_instance']);
        add_filter('kc_wp_migrations_paths', function ($migration_paths) {
            $migration_paths[] = [
                'key' => 'kivicare_google_meet',
                'name' => 'KiviCare Google Meet',
                'path' => KIVICARE_GOOGLE_MEET_DIR . '/app/database/migrations'
            ];
            return $migration_paths;
        });
        //Payment Gateway
        add_filter('kc_payment_gateways', [$this, 'register_google_meet_payment_gateways']);
    }

    public function register_google_meet_payment_gateways($gateways)
    {
        $gateways['woocommerce'] = [
            'class' => 'App\\paymentGateways\\KCWooCommerce',
            'settings_key' => KIVI_CARE_PREFIX . 'woocommerce_payment'
        ];

        return $gateways;
    }

    public function register_google_meet_modules(KCModuleRegistry $moduleRegistry)
    {
        $moduleRegistry->registerModuleController(
            "setting",
            "google_meet",
            KCGMGoogleMeetController::class
        );
    }

    public function register_providers($providers)
    {
        $providers['googlemeet'] = [
            'class' => KCGMGoogleMeet::class,
            'settings_key' => KIVICARE_GOOGLE_MEET_PREFIX . 'google_meet_setting',
            'name' => 'Google Meet',
            'description' => 'Video consultations via Google Meet platform'
        ];
        return $providers;
    }

    public function load_text_domain()
    {
        $domain = 'kivicare-googlemeet-telemed-addon';
        $locale = determine_locale();
        $mofile = $domain . '-' . $locale . '.mo';

        if (load_textdomain($domain, KIVICARE_GOOGLE_MEET_DIR . '/languages/' . $mofile)) {
            return;
        }

        load_plugin_textdomain($domain, false, dirname(KIVICARE_GOOGLE_MEET_BASE_PATH) . '/languages/');
    }
}