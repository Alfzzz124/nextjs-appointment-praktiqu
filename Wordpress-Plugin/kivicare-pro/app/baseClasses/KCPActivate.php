<?php

namespace KCProApp\baseClasses;

use App\baseClasses\KCMigration;
use App\baseClasses\KCErrorLogger;

defined('ABSPATH') or die('Something went wrong');

final class KCPActivate
{
    public static function activate()
    {
        // First ensure the base plugin's migration system is available
        if (class_exists('\\App\\baseClasses\\KCMigration')) {
            // Run pro-specific migrations
            self::runProMigrations();
        } else {
            // Log error or notify that base plugin is required
            KCErrorLogger::instance()->error('KiviCare base plugin is required for Pro version to work correctly');
        }

        // Add Default Settings Option if not exists
        self::addModuleConfig();
    }

    private static function runProMigrations()
    {
        // Define a separate migration path for Pro plugin
      
         add_filter('kc_wp_migrations_paths', function ($migration_paths) {
            $migration_paths[] = array(
                'key' => 'kivicare_pro',
                'name' => 'KiviCare Pro',
                'path' => KIVI_CARE_PRO_DIR . '/app/database/migrations'
            );
            return $migration_paths;
        });

        // Use the main plugin's migration class
        KCMigration::migrate();

        // Remove our filter to avoid affecting other migrations
        remove_filter('kc_wp_migrations_paths', '__return_true');
    }

    /**
     * add default configuration value
     * @return void
     */
    public static function addModuleConfig()
    {
        $prefix = KIVI_CARE_PRO_PREFIX;
        $prescription_module = [
            'prescription_module_config' => [
                [
                    'name' => 'prescription',
                    'label' => 'Prescription',
                    'status' => '1'
                ]
            ],
        ];
        add_option($prefix . 'prescription_module', json_encode($prescription_module));

        $encounter_modules = [
            'encounter_module_config' => [
                [
                    'name' => 'problem',
                    'label' => 'Problem',
                    'status' => '1'
                ],
                [
                    'name' => 'observation',
                    'label' => 'Observations',
                    'status' => '1'
                ],
                [
                    'name' => 'note',
                    'label' => 'Note',
                    'status' => '1'
                ],
                [
                    'name' => 'report',
                    'label' => 'Medical Report',
                    'status' => '1'
                ]
            ],
        ];
        add_option($prefix . 'encounter_modules', json_encode($encounter_modules));

        $lang_option = [
            'lang_option' => [
                [
                    'label' => 'English',
                    'id' => 'en'
                ],
                [
                    'label' => 'Arabic',
                    'id' => 'ar'
                ],
                [
                    'label' => 'Greek',
                    'id' => 'gr'
                ],
                [
                    'label' => 'French',
                    'id' => 'fr'
                ]
            ],
        ];
        add_option($prefix . 'lang_option', json_encode($lang_option));
    }
}