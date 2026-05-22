<?php

namespace KCTApp\baseClasses;

use App\baseClasses\KCMigration;
use App\baseClasses\KCErrorLogger;

defined('ABSPATH') or die('Something went wrong');

final class KCTActivate
{
    public static function activate()
    {
        // First ensure the base plugin's migration system is available
        if (class_exists('\\App\\baseClasses\\KCMigration')) {
            // Run pro-specific migrations
            self::runMigrations();
        } else {
            // Log error or notify that base plugin is required
            KCErrorLogger::instance()->error('KiviCare base plugin is required for Pro version to work correctly');
        }
    }

    private static function runMigrations()
    {
        // Define a separate migration path for Pro plugin
        add_filter('kc_wp_migrations_paths', function ($migration_paths) {
            $migration_paths[] = array(
                'key' => 'kivicare_telemed',
                'name' => 'KiviCare Telemed',
                'path' => KIVICARE_TELEMED_DIR . '/app/database/migrations'
            );
            return $migration_paths;
        });

        // Use the main plugin's migration class
        KCMigration::migrate();

        // Remove our filter to avoid affecting other migrations
        remove_filter('kc_wp_migrations_path', '__return_true');
    }
}