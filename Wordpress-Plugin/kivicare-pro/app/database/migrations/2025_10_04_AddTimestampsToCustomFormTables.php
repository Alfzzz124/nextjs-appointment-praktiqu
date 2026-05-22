<?php

namespace KiviCare\Migrations;

use App\database\classes\KCAbstractMigration;

defined('ABSPATH') or die('Something went wrong');

/**
 * Migration to add missing timestamp columns to custom form tables
 * Updates from old structure to new structure with proper timestamps
 */
class AddTimestampsToCustomFormTables extends KCAbstractMigration {
    
    /**
     * Run the migration
     */
    public function run() {
        global $wpdb;
        
        // Add updated_at column to custom_forms table if it doesn't exist
        $this->addUpdatedAtToCustomForms();
        
        // Add created_at and updated_at columns to custom_form_data table if they don't exist
        $this->addTimestampsToCustomFormData();
        
        // Update existing records with current timestamp where NULL
        $this->updateExistingTimestamps();
    }
    
    /**
     * Add updated_at column to wp_kc_custom_forms table
     */
    private function addUpdatedAtToCustomForms() {
        global $wpdb;
        $table_name = $wpdb->prefix . 'kc_custom_forms';
        
        // Check if updated_at column exists
        $column_exists = $wpdb->get_results($wpdb->prepare("
            SELECT COLUMN_NAME 
            FROM INFORMATION_SCHEMA.COLUMNS 
            WHERE TABLE_SCHEMA = %s 
            AND TABLE_NAME = %s 
            AND COLUMN_NAME = 'updated_at'
        ", DB_NAME, $table_name));
        
        if (empty($column_exists)) {
            $wpdb->query("ALTER TABLE {$table_name} ADD COLUMN updated_at datetime DEFAULT NULL AFTER created_at");
        }
    }
    
    /**
     * Add timestamp columns to wp_kc_custom_form_data table
     */
    private function addTimestampsToCustomFormData() {
        global $wpdb;
        $table_name = $wpdb->prefix . 'kc_custom_form_data';
        
        // Check if created_at column exists
        $created_at_exists = $wpdb->get_results($wpdb->prepare("
            SELECT COLUMN_NAME 
            FROM INFORMATION_SCHEMA.COLUMNS 
            WHERE TABLE_SCHEMA = %s 
            AND TABLE_NAME = %s 
            AND COLUMN_NAME = 'created_at'
        ", DB_NAME, $table_name));
        
        if (empty($created_at_exists)) {
            $wpdb->query("ALTER TABLE {$table_name} ADD COLUMN created_at datetime DEFAULT NULL AFTER module_id");
        }
        
        // Check if updated_at column exists
        $updated_at_exists = $wpdb->get_results($wpdb->prepare("
            SELECT COLUMN_NAME 
            FROM INFORMATION_SCHEMA.COLUMNS 
            WHERE TABLE_SCHEMA = %s 
            AND TABLE_NAME = %s 
            AND COLUMN_NAME = 'updated_at'
        ", DB_NAME, $table_name));
        
        if (empty($updated_at_exists)) {
            $wpdb->query("ALTER TABLE {$table_name} ADD COLUMN updated_at datetime DEFAULT NULL AFTER created_at");
        }
    }
    
    /**
     * Update existing records with current timestamp where timestamps are NULL
     */
    private function updateExistingTimestamps() {
        global $wpdb;
        $current_time = current_time('mysql');
        
        // Update custom_forms table
        $forms_table = $wpdb->prefix . 'kc_custom_forms';
        
        // Set updated_at to created_at for existing records where updated_at is NULL
        $wpdb->query("
            UPDATE {$forms_table} 
            SET updated_at = created_at 
            WHERE updated_at IS NULL AND created_at IS NOT NULL
        ");
        
        // Set both timestamps to current time where they're NULL
        $wpdb->query($wpdb->prepare("
            UPDATE {$forms_table} 
            SET created_at = %s, updated_at = %s 
            WHERE created_at IS NULL
        ", $current_time, $current_time));
        
        // Update custom_form_data table
        $data_table = $wpdb->prefix . 'kc_custom_form_data';
        
        // Set timestamps for existing records
        $wpdb->query($wpdb->prepare("
            UPDATE {$data_table} 
            SET created_at = %s, updated_at = %s 
            WHERE created_at IS NULL
        ", $current_time, $current_time));
    }
    
    /**
     * Rollback the migration
     */
    public function rollback() {
        global $wpdb;
        
        // Remove added columns
        $forms_table = $wpdb->prefix . 'kc_custom_forms';
        $data_table = $wpdb->prefix . 'kc_custom_form_data';
        
        // Check and drop columns if they exist
        $wpdb->query("ALTER TABLE {$forms_table} DROP COLUMN IF EXISTS updated_at");
        $wpdb->query("ALTER TABLE {$data_table} DROP COLUMN IF EXISTS created_at");
        $wpdb->query("ALTER TABLE {$data_table} DROP COLUMN IF EXISTS updated_at");
    }
}