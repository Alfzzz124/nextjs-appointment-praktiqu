<?php

namespace KiviCare\Migrations;

use App\database\classes\KCAbstractMigration;

defined('ABSPATH') or die('Something went wrong');

/**
 * Create followup reminders table for the Follow-Up Management Module queue
 */
class CreateFollowupRemindersTable extends KCAbstractMigration {
    
    /**
     * Run the migration
     */
    public function run() {
        global $wpdb;
        $table_name = $wpdb->prefix . 'kc_followup_reminders';
        
        $sql = "CREATE TABLE {$table_name} (
            id bigint UNSIGNED NOT NULL AUTO_INCREMENT,
            followup_id bigint UNSIGNED NOT NULL,
            reminder_type varchar(50) NOT NULL,
            offset_days int NOT NULL DEFAULT 0,
            channel enum('sms', 'email', 'push') NOT NULL DEFAULT 'email',
            action_id bigint UNSIGNED NULL,
            processed_at datetime NULL,
            PRIMARY KEY (id),
            UNIQUE KEY followup_reminder (followup_id, reminder_type)
        ) " . $this->get_collation() . ";";
        
        require_once(ABSPATH . 'wp-admin/includes/upgrade.php');
        dbDelta($sql);
    }
    
    /**
     * Rollback the migration
     */
    public function rollback() {
        global $wpdb;
        $table_name = $wpdb->prefix . 'kc_followup_reminders';
        $wpdb->query("DROP TABLE IF EXISTS {$table_name}");
    }
}
