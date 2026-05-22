<?php

namespace KiviCare\Migrations;

use App\database\classes\KCAbstractMigration;
use App\baseClasses\KCErrorLogger;

defined('ABSPATH') or die('Something went wrong');

class AddExtraColumnAppointmentGoogleMeetMappingTable extends KCAbstractMigration
{
    public function run()
    {
        global $wpdb;
        $table_name = $wpdb->prefix . 'kc_appointment_google_meet_mappings';
        
        // Check if table exists first
        $table_exists = $wpdb->get_var("SHOW TABLES LIKE '{$table_name}'");
        
        if (!$table_exists) {
            KCErrorLogger::instance()->error("Table {$table_name} does not exist, skipping column addition");
            return;
        }
        
        $column = 'extra';
        $column_type = 'TEXT DEFAULT NULL';
        $row = $wpdb->get_results("SHOW COLUMNS FROM {$table_name} LIKE '{$column}'");

        if (empty($row)) {
            $wpdb->query("ALTER TABLE {$table_name} ADD COLUMN {$column} {$column_type}");
        }
    }

    public function rollback()
    {
        global $wpdb;
        $table_name = $wpdb->prefix . 'kc_appointment_google_meet_mappings';
        
        // Check if table exists first
        $table_exists = $wpdb->get_var("SHOW TABLES LIKE '{$table_name}'");
        if (!$table_exists) {
            return;
        }
        
        $column = 'extra';
        $row = $wpdb->get_results("SHOW COLUMNS FROM {$table_name} LIKE '{$column}'");
        if (!empty($row)) {
            $wpdb->query("ALTER TABLE {$table_name} DROP COLUMN {$column}");
        }
    }
}