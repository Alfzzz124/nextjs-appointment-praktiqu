<?php

namespace KiviCare\Migrations;

use App\database\classes\KCAbstractMigration;

defined('ABSPATH') or die('Something went wrong');

/**
 * Create followups table for the Follow-Up Management Module
 */
class CreateFollowupsTable extends KCAbstractMigration {
    
    /**
     * Run the migration
     */
    public function run() {
        global $wpdb;
        $table_name = $wpdb->prefix . 'kc_followups';
        
        $sql = "CREATE TABLE {$table_name} (
            id bigint UNSIGNED NOT NULL AUTO_INCREMENT,
            clinic_id bigint UNSIGNED NOT NULL,
            doctor_id bigint UNSIGNED NOT NULL,
            patient_id bigint UNSIGNED NOT NULL,
            encounter_id bigint UNSIGNED NULL,
            chain_id bigint UNSIGNED NOT NULL,
            parent_followup_id bigint UNSIGNED NULL,
            reason text NOT NULL,
            priority enum('routine', 'important', 'urgent') DEFAULT 'routine',
            status enum('pending', 'scheduled', 'completed', 'missed', 'cancelled') DEFAULT 'pending',
            created_at_utc datetime NOT NULL,
            suggested_date_utc datetime NOT NULL,
            suggested_deadline_utc datetime NOT NULL,
            scheduled_appointment_id bigint UNSIGNED NULL,
            completed_at_utc datetime NULL,
            cancelled_at_utc datetime NULL,
            metadata json NULL,
            created_by bigint UNSIGNED NULL,
            updated_at_utc datetime NULL,
            updated_by bigint UNSIGNED NULL,
            PRIMARY KEY (id),
            KEY idx_clinic_patient_status (clinic_id, patient_id, status),
            KEY idx_doctor_status_date (doctor_id, status, suggested_date_utc),
            KEY idx_encounter (encounter_id),
            KEY idx_appointment (scheduled_appointment_id),
            KEY idx_missed_check (status, suggested_deadline_utc),
            KEY idx_priority_status (clinic_id, priority, status),
            KEY idx_chain (chain_id)
        ) " . $this->get_collation() . ";";
        
        require_once(ABSPATH . 'wp-admin/includes/upgrade.php');
        dbDelta($sql);
    }
    
    /**
     * Rollback the migration
     */
    public function rollback() {
        global $wpdb;
        $table_name = $wpdb->prefix . 'kc_followups';
        $wpdb->query("DROP TABLE IF EXISTS {$table_name}");
    }
}
