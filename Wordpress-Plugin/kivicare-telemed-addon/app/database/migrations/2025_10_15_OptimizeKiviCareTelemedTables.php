<?php

namespace KiviCare\Migrations;

use App\database\classes\KCAbstractMigration;
use App\emails\KCEmailTemplateManager;

defined('ABSPATH') or die('Something went wrong');

/**
 * Consolidated migration for KiviCare Telemed Addon
 * Adds proper indexing and optimization to existing tables
 */
class OptimizeKiviCareTelemedTables extends KCAbstractMigration 
{
    /**
     * Run the migration - Add indexes and optimize existing tables
     */
    public function run() 
    {
        $this->addAppointmentZoomMappingIndexes();
        $this->addExtraColumnIfNotExists();
    }

    /**
     * Rollback the migration - Remove indexes
     */
    public function rollback() 
    {
        $this->removeAppointmentZoomMappingIndexes();
        $this->removeExtraColumn();
        $this->removeMeetingFailEmailTemplates();
    }

    /**
     * Add indexes to appointment zoom mappings table
     */
    private function addAppointmentZoomMappingIndexes() 
    {
        global $wpdb;
        $table_name = $wpdb->prefix . 'kc_appointment_zoom_mappings';
        
        // Check if table exists
        $table_exists = $wpdb->get_var("SHOW TABLES LIKE '{$table_name}'");
        if (!$table_exists) {
            return;
        }

        // Add indexes for better performance
        $indexes = [
            'idx_appointment_id' => 'appointment_id',
            'idx_zoom_id' => 'zoom_id',
            'idx_zoom_uuid' => 'zoom_uuid',
            'idx_created_at' => 'created_at',
            'idx_appointment_zoom' => 'appointment_id, zoom_id'
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
        $table_name = $wpdb->prefix . 'kc_appointment_zoom_mappings';
        
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
     * Remove indexes from appointment zoom mappings table
     */
    private function removeAppointmentZoomMappingIndexes() 
    {
        global $wpdb;
        $table_name = $wpdb->prefix . 'kc_appointment_zoom_mappings';
        
        // Check if table exists
        $table_exists = $wpdb->get_var("SHOW TABLES LIKE '{$table_name}'");
        if (!$table_exists) {
            return;
        }

        $indexes = [
            'idx_appointment_id',
            'idx_zoom_id',
            'idx_zoom_uuid',
            'idx_created_at',
            'idx_appointment_zoom'
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
        $table_name = $wpdb->prefix . 'kc_appointment_zoom_mappings';
        
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

    /**
     * Remove meeting fail email templates
     */
    private function removeMeetingFailEmailTemplates() 
    {
        $template_slugs = [
            KIVICARE_TELEMED_PREFIX . 'doctor_meeting_fail_notify',
            KIVICARE_TELEMED_PREFIX . 'admin_meeting_fail_notify'
        ];

        foreach ($template_slugs as $slug) {
            $args = [
                'name' => $slug,
                'post_type' => 'email_template',
                'post_status' => 'any',
                'numberposts' => 1
            ];
            $posts = get_posts($args);
            foreach ($posts as $post) {
                wp_delete_post($post->ID, true);
            }
        }
    }
}