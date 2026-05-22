<?php

namespace KiviCare\Migrations;

use App\database\classes\KCAbstractMigration;

defined('ABSPATH') or die('Something went wrong');
class CreateAppointmentZoomMappingsTable extends KCAbstractMigration {
    public function run() {
        global $wpdb;
        $table_name = $wpdb->prefix . 'kc_appointment_zoom_mappings';
        $sql = "CREATE TABLE {$table_name} (
            id bigint NOT NULL AUTO_INCREMENT,
            appointment_id bigint UNSIGNED NOT NULL,
            zoom_id varchar(191) NOT NULL,
            zoom_uuid varchar(191) NOT NULL,
            start_url longtext,
            join_url longtext,
            password varchar(191) NOT NULL,
            created_at datetime NOT NULL,
            PRIMARY KEY (id)
        ) " . $this->get_collation() . ";";
        require_once(ABSPATH . 'wp-admin/includes/upgrade.php');
        dbDelta($sql);
    }
    public function rollback() {
        global $wpdb;
        $table_name = $wpdb->prefix . 'kc_appointment_zoom_mappings';
        $wpdb->query("DROP TABLE IF EXISTS {$table_name}");
    }
}
