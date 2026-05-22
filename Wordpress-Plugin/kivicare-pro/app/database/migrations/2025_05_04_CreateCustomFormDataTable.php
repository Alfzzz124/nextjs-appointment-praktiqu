<?php

namespace KiviCare\Migrations;

use App\database\classes\KCAbstractMigration;

defined('ABSPATH') or die('Something went wrong');
class CreateCustomFormDataTable extends KCAbstractMigration {
    public function run() {
        global $wpdb;
        $table_name = $wpdb->prefix . 'kc_custom_form_data';
        $sql = "CREATE TABLE {$table_name} (
            id bigint NOT NULL AUTO_INCREMENT,
            form_id bigint DEFAULT NULL,
            form_data longtext,
            module_id bigint DEFAULT NULL,
            created_at datetime DEFAULT NULL,
            updated_at datetime DEFAULT NULL,
            PRIMARY KEY (id),
            KEY idx_form_module (form_id, module_id)
        ) " . $this->get_collation() . ";";
        require_once(ABSPATH . 'wp-admin/includes/upgrade.php');
        dbDelta($sql);
    }
    public function rollback() {
        global $wpdb;
        $table_name = $wpdb->prefix . 'kc_custom_form_data';
        $wpdb->query("DROP TABLE IF EXISTS {$table_name}");
    }
}