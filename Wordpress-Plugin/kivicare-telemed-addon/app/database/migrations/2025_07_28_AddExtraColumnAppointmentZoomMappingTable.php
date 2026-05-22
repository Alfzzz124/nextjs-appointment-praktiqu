<?php

namespace KiviCare\Migrations;

use App\database\classes\KCAbstractMigration;

defined('ABSPATH') or die('Something went wrong');
class AddExtraColumnAppointmentZoomMappingTable extends KCAbstractMigration {
    public function run() {
        global $wpdb;
        $table_name = $wpdb->prefix . 'kc_appointment_zoom_mappings';
        // Example: Add a new column 'extra' to the table
        $column = 'extra';
        $column_type = 'TEXT DEFAULT NULL';
        $row = $wpdb->get_results("SHOW COLUMNS FROM {$table_name} LIKE '{$column}'");
        if (empty($row)) {
            $wpdb->query("ALTER TABLE {$table_name} ADD COLUMN {$column} {$column_type}");
        }
    }
    public function rollback() {
        global $wpdb;
        $table_name = $wpdb->prefix . 'kc_appointment_zoom_mappings';
        $column = 'extra';
        $row = $wpdb->get_results("SHOW COLUMNS FROM {$table_name} LIKE '{$column}'");
        if (!empty($row)) {
            $wpdb->query("ALTER TABLE {$table_name} DROP COLUMN {$column}");
        }
    }
}
