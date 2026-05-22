<?php
namespace KCTApp\baseClasses;

use App\baseClasses\KCModuleRegistry;
use KCTApp\controllers\api\KCTZoomController;
use KCTApp\controllers\filters\KCTAppointmentControllerFilters;
use KCTApp\telemed\KCTZoom;


if (!defined('ABSPATH')) {
    exit; // Exit if accessed directly.
}
/**
 * KCTApp class
 * This class serves as the base application class for the KiviCare Telemed add-on.
 * @package TeleMedApp\baseClasses
 * @since 2.0.0
 */
final class KCTApp
{
    /**
     * Initialize the application.
     */
    public function init()
    {
        // Code to set up the application, such as loading configurations, setting up hooks, etc.
        add_action('init', [$this, 'load_text_domain']);
        add_filter('kc_telemed_providers', [$this, 'register_providers']);
        add_action('kivicare_register_modules', [$this, 'register_telemed_modules']);

        add_action('kivicare_after_register_routes_appointments/base', [KCTAppointmentControllerFilters::class, 'get_instance']);

        add_filter('kc_wp_migrations_paths', function ($migration_paths) {
            $migration_paths[] = array(
                'key' => 'kivicare_telemed',
                'name' => 'KiviCare Telemed',
                'path' => KIVICARE_TELEMED_DIR . '/app/database/migrations'
            );
            return $migration_paths;
        });

        //Payment Gateway
        add_filter('kc_payment_gateways', [$this, 'register_telemed_payment_gateways']);
    }

    public function register_telemed_payment_gateways($gateways){
        $gateways['woocommerce'] = [
            'class'        => 'App\\paymentGateways\\KCWooCommerce',
            'settings_key' => KIVI_CARE_PREFIX . 'woocommerce_payment'
        ];

        return $gateways;
    }

    /**
     * Register Telemed modules
     * This method registers the Telemed modules for the KiviCare Telemed add-on.
     */
    public function register_telemed_modules(KCModuleRegistry $moduleRegistry)
    {
        $moduleRegistry
            ->registerModuleController(
                "system",
                "zoom_telemed",
                KCTZoomController::class,
            );
    }

    /**
     * Register telemed providers
     * @param array $providers Existing providers
     * @return array
     */
    public function register_providers($providers)
    {
        $providers['zoom'] = [
            'class' => KCTZoom::class,
            'settings_key' => KIVI_CARE_PREFIX . 'zoom_telemed_setting',
            'name' => 'Zoom Meetings',
            'description' => 'Video consultations via Zoom platform'
        ];

        return $providers;
    }

    /**
     * Load plugin text domain for translation
     *
     * @return void
     */
    public function load_text_domain()
    {
        // Load the plugin text domain properly
        $domain = 'kiviCare-telemed-addon';
        $locale = determine_locale();
        $mofile = $domain . '-' . $locale . '.mo';

        // Try to load from the languages directory first
        if (load_textdomain($domain, KIVICARE_TELEMED_DIR . '/languages/' . $mofile)) {
            return;
        }

        // Otherwise use the standard WordPress approach
        load_plugin_textdomain($domain, false, dirname(KIVICARE_TELEMED_BASE_PATH) . '/languages/');
    }
}