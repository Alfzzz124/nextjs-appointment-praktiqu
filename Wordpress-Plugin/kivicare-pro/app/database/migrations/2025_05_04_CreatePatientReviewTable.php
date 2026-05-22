<?php

namespace KiviCare\Migrations;

use App\database\classes\KCAbstractMigration;

defined('ABSPATH') or die('Something went wrong');
class CreatePatientReviewTable extends KCAbstractMigration {
    public function run() {
        global $wpdb;
        $table_name = $wpdb->prefix . 'kc_patient_review';
        $sql = "CREATE TABLE {$table_name} (
            id bigint NOT NULL AUTO_INCREMENT,
            review bigint UNSIGNED NOT NULL,
            review_description longtext,
            patient_id bigint UNSIGNED NOT NULL,
            doctor_id bigint UNSIGNED NOT NULL,
            created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (id)
        ) " . $this->get_collation() . ";";
        require_once(ABSPATH . 'wp-admin/includes/upgrade.php');
        dbDelta($sql);
    }
    public function rollback() {
        global $wpdb;
        $table_name = $wpdb->prefix . 'kc_patient_review';
        $wpdb->query("DROP TABLE IF EXISTS {$table_name}");
    }
}