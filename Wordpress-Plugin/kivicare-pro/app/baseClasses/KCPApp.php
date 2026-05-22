<?php

namespace KCProApp\baseClasses;

use App\baseClasses\KCModuleRegistry;
use KCProApp\controllers\api\KCPReportsController;
use KCProApp\controllers\api\KCProCustomFormController;
use KCProApp\controllers\api\KCProExtendedEncounterTemplateController;
use KCProApp\controllers\api\KCProFollowupController;
use KCProApp\controllers\api\KCProServiceSessionController;
use KCProApp\controllers\api\KCProPrintEncounterController;
use KCProApp\controllers\api\KCProPrintBillController;
use KCProApp\controllers\api\KCProPrintPrescriptionController;
use KCProApp\controllers\api\KCPSMSWhatsappTemplate;
use KCProApp\controllers\api\KCProBillController;
use KCProApp\controllers\api\KCProClinicController;
use KCProApp\controllers\api\KCProGdprAuditController;
use KCProApp\controllers\api\KCProPatientMedicalReportController;
use KCProApp\controllers\api\KCProTaxController;
use KCProApp\controllers\api\KCProGdprConsentController;
use KCProApp\controllers\api\KCProGdprSettingsController;
use KCProApp\controllers\api\KCPRatingController;
use KCProApp\controllers\filters\KCPAppointmentControllerFilters;
use KCProApp\controllers\filters\KCPPatientControllerFilters;
use KCProApp\controllers\filters\KCPDoctorControllerFilters;
use KCProApp\controllers\filters\KCPEncounterControllerFilters;
use KCProApp\controllers\filters\KCPGdprRegistrationFilters;
use KCProApp\filterClasses\KCPCommonFilters;
use KCProApp\filterClasses\KCGdprExportFilters;
use KCProApp\controllers\api\ProSettings;
use KCProApp\email\KCClinicAdminNotificationListener;
use KCProApp\notifications\KCPNotificationInit;
use KCProApp\controllers\api\GoogleCalendarIntegration;
use KCProApp\controllers\api\KCImportController;
use KCProApp\controllers\api\KCProEncounterController;
use KCProApp\controllers\api\KCProPermissionSetting;
use KCProApp\controllers\api\KCProSidebarSetting;

use KCProApp\services\KCGdprAuditService;
use KCProApp\filterClasses\KCGdprAuditFilters;
use KCProApp\listeners\KCGdprRequestListener;

use KCProApp\cli\KCProFollowupCLI;
use KCProApp\controllers\filters\KCProBookingLimitFilters;
use KCProApp\controllers\filters\KCProSettingsFilters;
use KCProApp\controllers\filters\KCProFollowupFilters;
use KCProApp\controllers\filters\KCProServiceControllerFilters;
use KCProApp\services\KCProReminderService;

/**
 * The code that runs during plugin activation
 */
defined('ABSPATH') or die('Something went wrong');

final class KCPApp
{
    public function init()
    {
        // Register an action to load text domain on init to ensure translations are available throughout
        add_action('init', callback: [$this, 'load_text_domain']);
        add_action('change_locale', callback: [$this, 'load_text_domain']);
        add_filter('kivicare_rest_controller_classes', [$this, 'register_rest_controllers']);

        // Initialize Filters
        KCProSettingsFilters::get_instance();
        KCProFollowupFilters::get_instance();
        KCProBookingLimitFilters::get_instance();
        KCProServiceControllerFilters::get_instance();

        add_action('kivicare_register_modules', [$this, 'register_pro_modules']);

        add_action('rest_api_init', [KCPAppointmentControllerFilters::class, 'get_instance']);
        add_action('rest_api_init', [KCPPatientControllerFilters::class, 'get_instance']);
        add_action('rest_api_init', [KCPDoctorControllerFilters::class, 'get_instance']);
        add_action('rest_api_init', [KCPEncounterControllerFilters::class, 'get_instance']);

        // Google Calendar: Register background sync handler globally (so it works when Action Scheduler runs)
        add_action('kc_gcal_process_event_change', [GoogleCalendarIntegration::getInstance(), 'handleGoogleEventChange']);


        add_action('rest_api_init', [KCPGdprRegistrationFilters::class, 'get_instance']);
        
        // Initialize GDPR Audit Service shutdown hook for log committing
        add_action('plugins_loaded', [KCGdprAuditService::class, 'init'], 12);
        add_filter('rest_request_after_callbacks', [KCGdprRequestListener::class, 'logRestRequest'], 10, 3);
        // Print routes call exit() so rest_request_after_callbacks never fires for them.
        // A dedicated before-hook handles ONLY those routes.
        add_filter('rest_request_before_callbacks', [KCGdprRequestListener::class, 'logPrintRequest'], 10, 3);

        
        add_action('init', function() {
            new KCPCommonFilters();
            new KCGdprAuditFilters();
            new KCGdprExportFilters();
        });

        add_filter('kc_wp_migrations_paths', function ($migration_paths) {
            $migration_paths[] = array(
                'key' => 'kivicare_pro',
                'name' => 'KiviCare Pro',
                'path' => KIVI_CARE_PRO_DIR . '/app/database/migrations'
            );
            return $migration_paths;
        });

        add_action('plugins_loaded', [KCPNotificationInit::class, 'get_instance']);
        add_action('plugins_loaded', [KCProReminderService::class, 'get_instance']);

        // Add filter for pro directory URI
        add_filter('kivicare_dashboard_data', [$this, 'get_pro_dir_uri']);

        //Initialize clinic admin notification listner
        add_action('kivicare_email_notification_listeners_initialized', [$this, 'register_clinic_admin_notification_listener']);

        add_filter('kc_payment_gateways', [$this, 'register_pro_payment_gateways']);

        // Register WP-CLI commands
        if (defined('WP_CLI') && WP_CLI) {
            \WP_CLI::add_command('kivicare followup', KCProFollowupCLI::class);
        }
    }

    public function register_clinic_admin_notification_listener()
    {
        KCClinicAdminNotificationListener::get_instance();
    }

    public function register_pro_modules(KCModuleRegistry $moduleRegistry)
    {
        // Register Pro modules here
        $moduleRegistry->registerModule('clinic')
            ->registerModuleController(
                'pro',
                'base',
                KCProClinicController::class,
            );
        // Billing Module
        $moduleRegistry
            ->registerModule("billing")
            ->registerModuleController(
                "billing",
                "bills",
                KCProBillController::class,
            )
            ->registerModuleController(
                "billing",
                "taxes",
                KCProTaxController::class,
            );
        $moduleRegistry
            ->registerModuleController(
                "medical",
                "encounter_templates",
                KCProExtendedEncounterTemplateController::class,
            );

        $moduleRegistry
            ->registerModuleController(
                "patients",
                "medical_reports",
                KCProPatientMedicalReportController::class,
            );
        $moduleRegistry
            ->registerModule('settings')
            ->registerModuleController(
                "setting",
                "pro",
                ProSettings::class,
            )
            ->registerModuleController(
                "setting",
                "custom_forms",
                KCProCustomFormController::class,
            );

        $moduleRegistry
            ->registerModuleController(
                "setting",
                "SmsWhatsappTemplate",
                KCPSMSWhatsappTemplate::class,
            );
        $moduleRegistry
            ->registerModuleController(
                "setting",
                "google_calendar_integration",
                GoogleCalendarIntegration::class,
            );

        // Import Module
        $moduleRegistry
            ->registerModule("import")
            ->registerModuleController(
                "import",
                "base",
                KCImportController::class,
            );


        $moduleRegistry
            ->registerModule("reports")
            ->registerModuleController(
                "reports",
                "base",
                KCPReportsController::class,
            );

        $moduleRegistry
            ->registerModule("rating")
            ->registerModuleController(
                "rating",
                "base",
                KCPRatingController::class,
            );

        $moduleRegistry
        ->registerModuleController(
            "encounter",
            "encounter_print",
            KCProPrintEncounterController::class,
        );

        $moduleRegistry
        ->registerModuleController(
            "billing",
            "bill_print",
            KCProPrintBillController::class,
        );

        $moduleRegistry
        ->registerModuleController(
            "prescription",
            "prescription_print",
            KCProPrintPrescriptionController::class,
        );
        
        $moduleRegistry
        ->registerModuleController(
            "encounter",
            "pro_encounter",
            KCProEncounterController::class,
        );
        $moduleRegistry
        ->registerModuleController(
            "settings",
            "permission_setting",
            KCProPermissionSetting::class,
        );
        $moduleRegistry
        ->registerModuleController(
            "settings",
            "sidebar_setting",
            KCProSidebarSetting::class,
        );
        $moduleRegistry
            ->registerModule("followups")
            ->registerModuleController(
                "followups",
                "base",
                KCProFollowupController::class,
            );

        // GDPR Consent Module
        $moduleRegistry
        ->registerModule("gdpr")
        ->registerModuleController(
            "gdpr",
            "consent",
            KCProGdprConsentController::class,
        )
        ->registerModuleController(
            "gdpr",
            "settings",
            KCProGdprSettingsController::class,
        )
        ->registerModuleController(
            "gdpr",
            "audit",
            KCProGdprAuditController::class,
        );
        $moduleRegistry
            ->registerModule("service_sessions")
            ->registerModuleController(
                "service_sessions",
                "base",
                KCProServiceSessionController::class,
            );
    }
    /**
     * Load plugin text domain for translation
     *
     * @return void
     */
    public function load_text_domain()
    {
        // Load the plugin text domain properly
        $domain = 'kivicare-pro';
        $locale = determine_locale();
        $mofile = $domain . '-' . $locale . '.mo';

        // Try to load from the languages directory first
        if (load_textdomain($domain, KIVI_CARE_PRO_DIR . 'languages/' . $mofile)) {
            return;
        }

        // Otherwise use the standard WordPress approach
        load_plugin_textdomain($domain, false, dirname(KIVI_CARE_PRO_BASE_NAME) . '/languages/');
    }

    /**
     * Get pro directory URI
     *
     * @return string Pro directory URI
     */
    public function get_pro_dir_uri($dashboard_data)
    {
        $dashboard_data['kivicare_pro_dir_uri'] = defined('KIVI_CARE_PRO_DIR_URI') ? KIVI_CARE_PRO_DIR_URI : '';
        return $dashboard_data;
    }

    /**
     * Register Pro Payment Gateways
     * 
     * @param array $gateways
     * @return array
     */
    public function register_pro_payment_gateways($gateways)
    {
        $gateways['woocommerce'] = [
            'class'        => 'App\\paymentGateways\\KCWooCommerce',
            'settings_key' => KIVI_CARE_PREFIX . 'woocommerce_payment'
        ];

        return $gateways;
    }
}
