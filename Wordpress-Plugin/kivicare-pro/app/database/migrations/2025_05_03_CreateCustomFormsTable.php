<?php

namespace KiviCare\Migrations;

use App\database\classes\KCAbstractMigration;

defined('ABSPATH') or die('Something went wrong');

/**
 * Create custom forms table with complete structure
 * This migration ensures the table exists with all required columns
 */
class CreateCustomFormsTable extends KCAbstractMigration {
    
    /**
     * Run the migration
     */
    public function run() {
        global $wpdb;
        $table_name = $wpdb->prefix . 'kc_custom_forms';
        
        $sql = "CREATE TABLE {$table_name} (
            id bigint NOT NULL AUTO_INCREMENT,
            name longtext COLLATE utf8mb4_unicode_520_ci,
            module_type varchar(191) COLLATE utf8mb4_unicode_520_ci DEFAULT NULL,
            fields longtext COLLATE utf8mb4_unicode_520_ci,
            conditions longtext COLLATE utf8mb4_unicode_520_ci,
            status tinyint UNSIGNED DEFAULT '0',
            added_by bigint NOT NULL,
            created_at datetime DEFAULT NULL,
            updated_at datetime DEFAULT NULL,
            PRIMARY KEY (id),
            KEY idx_module_type (module_type),
            KEY idx_status (status),
            KEY idx_added_by (added_by)
        ) " . $this->get_collation() . ";";
        
        require_once(ABSPATH . 'wp-admin/includes/upgrade.php');
        dbDelta($sql);
    }
    
    /**
     * Rollback the migration
     */
    public function rollback() {
        global $wpdb;
        $table_name = $wpdb->prefix . 'kc_custom_forms';
        $wpdb->query("DROP TABLE IF EXISTS {$table_name}");
    }
}