<?php

namespace KiviCare\Migrations;

use App\database\classes\KCAbstractMigration;

defined('ABSPATH') or die('Something went wrong');

/**
 * Create followup chains table
 */
class CreateFollowupChainsTable extends KCAbstractMigration {
    
    /**
     * Run the migration
     */
    public function run() {
        global $wpdb;
        $table_name = $wpdb->prefix . 'kc_followup_chains';
        
        $sql = "CREATE TABLE {$table_name} (
            id bigint UNSIGNED NOT NULL AUTO_INCREMENT,
            clinic_id bigint UNSIGNED NOT NULL,
            patient_id bigint UNSIGNED NOT NULL,
            doctor_id bigint UNSIGNED NOT NULL,
            diagnosis_id bigint UNSIGNED NULL,
            name varchar(255) NULL,
            status enum('active', 'closed', 'on_hold') DEFAULT 'active',
            created_at_utc datetime NOT NULL,
            closed_at_utc datetime NULL,
            closed_by bigint UNSIGNED NULL,
            PRIMARY KEY (id),
            KEY idx_clinic_patient_status (clinic_id, patient_id, status),
            KEY idx_doctor_status (doctor_id, status)
        ) " . $this->get_collation() . ";";
        
        require_once(ABSPATH . 'wp-admin/includes/upgrade.php');
        dbDelta($sql);
    }
    
    /**
     * Rollback the migration
     */
    public function rollback() {
        global $wpdb;
        $table_name = $wpdb->prefix . 'kc_followup_chains';
        $wpdb->query("DROP TABLE IF EXISTS {$table_name}");
    }
}
