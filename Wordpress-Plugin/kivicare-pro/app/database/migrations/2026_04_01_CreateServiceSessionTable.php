<?php

namespace KCProApp\database\migrations;

use KCProApp\database\classes\KCAbstractMigration;

defined('ABSPATH') or die('Something went wrong');

/**
 * Create service sessions table with complete structure
 * This migration ensures the table exists with all required columns
 */
class CreateServiceSessionTable extends KCAbstractMigration
{
    /**
     * Run the migration
     */
    public function run()
    {
        global $wpdb;

        $charset_collate = $this->get_collation();

        $table = $wpdb->prefix . 'kc_service_sessions';

        $sql = "CREATE TABLE {$table} (
            id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
            mapping_id bigint(20) unsigned NOT NULL,
            day varchar(20) DEFAULT NULL,
            start_time time DEFAULT NULL,
            end_time time DEFAULT NULL,
            parent_id bigint(20) unsigned DEFAULT NULL,
            PRIMARY KEY (id),
            KEY mapping_id (mapping_id),
            KEY parent_id (parent_id)
        ) {$charset_collate};";

        require_once ABSPATH . 'wp-admin/includes/upgrade.php';
        dbDelta($sql);
    }

    /**
     * Rollback the migration
     */
    public function rollback()
    {
        global $wpdb;

        $table_name = $wpdb->prefix . 'kc_service_sessions';
        $wpdb->query("DROP TABLE IF EXISTS {$table_name}");
    }
}
