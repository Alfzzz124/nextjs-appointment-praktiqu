<?php

namespace KiviCare\Migrations;

use App\database\classes\KCAbstractMigration;
use App\emails\KCEmailTemplateManager;

defined('ABSPATH') or die('Something went wrong');

/**
 * Consolidated migration for KiviCare Google Meet Addon
 * Adds proper indexing and optimization to existing tables
 */
class OptimizeKiviCareGoogleMeetTables extends KCAbstractMigration
{
    /**
     * Run the migration - Add indexes and optimize existing tables
     */
    public function run()
    {
        $this->addAppointmentGoogleMeetMappingIndexes();
        $this->addExtraColumnIfNotExists();
    }

    /**
     * Rollback the migration - Remove indexes
     */
    public function rollback()
    {
        $this->removeAppointmentGoogleMeetMappingIndexes();
        $this->removeExtraColumn();
    }

    /**
     * Add indexes to appointment Google Meet mappings table
     */
    private function addAppointmentGoogleMeetMappingIndexes()
    {
        global $wpdb;
        $table_name = $wpdb->prefix . 'kc_appointment_google_meet_mappings';

        // Check if table exists
        $table_exists = $wpdb->get_var("SHOW TABLES LIKE '{$table_name}'");
        if (!$table_exists) {
            return;
        }

        // Add indexes for better performance
        $indexes = [
            'idx_appointment_id'    => 'appointment_id',
            'idx_event_id'          => 'event_id',
            'idx_created_at'        => 'created_at',
            'idx_appointment_event' => 'appointment_id, event_id'
        ];

        foreach ($indexes as $index_name => $columns) {
            // Check if index exists
            $index_exists = $wpdb->get_var("
                SELECT COUNT(*) 
                FROM INFORMATION_SCHEMA.STATISTICS 
                WHERE TABLE_SCHEMA = DATABASE() 
                AND TABLE_NAME = '{$table_name}' 
                AND INDEX_NAME = '{$index_name}'
            ");

            if (!$index_exists) {
                $wpdb->query("ALTER TABLE {$table_name} ADD INDEX {$index_name} ({$columns})");
            }
        }
    }

    /**
     * Add extra column if it doesn't exist
     */
    private function addExtraColumnIfNotExists()
    {
        global $wpdb;
        $table_name = $wpdb->prefix . 'kc_appointment_google_meet_mappings';

        // Check if table exists
        $table_exists = $wpdb->get_var("SHOW TABLES LIKE '{$table_name}'");
        if (!$table_exists) {
            return;
        }

        // Check if extra column exists
        $column_exists = $wpdb->get_var("
            SELECT COUNT(*) 
            FROM INFORMATION_SCHEMA.COLUMNS 
            WHERE TABLE_SCHEMA = DATABASE() 
            AND TABLE_NAME = '{$table_name}' 
            AND COLUMN_NAME = 'extra'
        ");

        if (!$column_exists) {
            $wpdb->query("ALTER TABLE {$table_name} ADD COLUMN extra TEXT DEFAULT NULL");
        }
    }
    /**
     * Remove indexes from appointment Google Meet mappings table
     */
    private function removeAppointmentGoogleMeetMappingIndexes()
    {
        global $wpdb;
        $table_name = $wpdb->prefix . 'kc_appointment_google_meet_mappings';

        // Check if table exists
        $table_exists = $wpdb->get_var("SHOW TABLES LIKE '{$table_name}'");
        if (!$table_exists) {
            return;
        }

        $indexes = [
            'idx_appointment_id',
            'idx_event_id',
            'idx_created_at',
            'idx_appointment_event'
        ];

        foreach ($indexes as $index_name) {
            // Check if index exists before dropping
            $index_exists = $wpdb->get_var("
                SELECT COUNT(*) 
                FROM INFORMATION_SCHEMA.STATISTICS 
                WHERE TABLE_SCHEMA = DATABASE() 
                AND TABLE_NAME = '{$table_name}' 
                AND INDEX_NAME = '{$index_name}'
            ");

            if ($index_exists) {
                $wpdb->query("ALTER TABLE {$table_name} DROP INDEX {$index_name}");
            }
        }
    }

    /**
     * Remove extra column
     */
    private function removeExtraColumn()
    {
        global $wpdb;
        $table_name = $wpdb->prefix . 'kc_appointment_google_meet_mappings';

        // Check if table exists
        $table_exists = $wpdb->get_var("SHOW TABLES LIKE '{$table_name}'");
        if (!$table_exists) {
            return;
        }

        // Check if extra column exists
        $column_exists = $wpdb->get_var("
            SELECT COUNT(*) 
            FROM INFORMATION_SCHEMA.COLUMNS 
            WHERE TABLE_SCHEMA = DATABASE() 
            AND TABLE_NAME = '{$table_name}' 
            AND COLUMN_NAME = 'extra'
        ");

        if ($column_exists) {
            $wpdb->query("ALTER TABLE {$table_name} DROP COLUMN extra");
        }
    }
}
