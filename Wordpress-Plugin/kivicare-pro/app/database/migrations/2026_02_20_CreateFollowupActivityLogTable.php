<?php

namespace KiviCare\Migrations;

use App\database\classes\KCAbstractMigration;

defined('ABSPATH') or die('Something went wrong');

/**
 * Create followup activity log table for the Follow-Up Management Module
 */
class CreateFollowupActivityLogTable extends KCAbstractMigration {
    
    /**
     * Run the migration
     */
    public function run() {
        global $wpdb;
        $table_name = $wpdb->prefix . 'kc_followup_activity_log';
        
        $sql = "CREATE TABLE {$table_name} (
            id bigint UNSIGNED NOT NULL AUTO_INCREMENT,
            followup_id bigint UNSIGNED NOT NULL,
            user_id bigint UNSIGNED NOT NULL,
            action varchar(50) NOT NULL,
            old_status varchar(20) NULL,
            new_status varchar(20) NULL,
            note text NULL,
            created_at_utc datetime NOT NULL,
            PRIMARY KEY (id),
            KEY idx_followup_id_created (followup_id, created_at_utc)
        ) " . $this->get_collation() . ";";
        
        require_once(ABSPATH . 'wp-admin/includes/upgrade.php');
        dbDelta($sql);
    }
    
    /**
     * Rollback the migration
     */
    public function rollback() {
        global $wpdb;
        $table_name = $wpdb->prefix . 'kc_followup_activity_log';
        $wpdb->query("DROP TABLE IF EXISTS {$table_name}");
    }
}
