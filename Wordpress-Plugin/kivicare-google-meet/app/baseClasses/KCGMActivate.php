<?php
namespace KCGMApp\baseClasses;

use App\baseClasses\KCMigration;
use App\baseClasses\KCErrorLogger;

defined('ABSPATH') or die('Something went wrong');

final class KCGMActivate
{
    public static function activate()
    {
        if (class_exists('\\App\\baseClasses\\KCMigration')) {
            self::runMigrations();
        } else {
            KCErrorLogger::instance()->error('KiviCare base plugin is required for Google Meet add-on to work correctly');
        }
    }

    private static function runMigrations()
    {
        add_filter('kc_wp_migrations_paths', function ($migration_paths) {
            $migration_paths[] = array(
                'key'  => 'kivicare_google_meet',
                'name' => 'KiviCare Google Meet',
                'path' => KIVICARE_GOOGLE_MEET_DIR . '/app/database/migrations'
            );
            return $migration_paths;
        });

        KCMigration::migrate();

        remove_filter('kc_wp_migrations_paths', '__return_true');
    }
}