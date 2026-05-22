<?php

namespace KiviCare\Migrations;

use App\database\classes\KCAbstractMigration;

defined('ABSPATH') or die('Something went wrong');

class CreateGdprAuditLogTable extends KCAbstractMigration
{
    /**
     * Run the migration
     */
    public function run()
    {
        global $wpdb;
        $table_name = $wpdb->prefix . 'kc_gdpr_audit_log';
        
        $sql = "CREATE TABLE {$table_name} (
            id bigint UNSIGNED NOT NULL AUTO_INCREMENT,
            event_type varchar(100) NOT NULL,
            actor_user_id bigint UNSIGNED NOT NULL,
            actor_role varchar(100) NOT NULL,
            subject_user_id bigint UNSIGNED DEFAULT NULL,
            resource_type varchar(100) DEFAULT NULL,
            resource_id bigint UNSIGNED DEFAULT NULL,
            action varchar(50) NOT NULL,
            details json DEFAULT NULL,
            ip_address varchar(45) DEFAULT NULL,
            user_agent text DEFAULT NULL,
            request_uri varchar(500) DEFAULT NULL,
            checksum varchar(64) NOT NULL,
            created_at datetime(6) NOT NULL,
            PRIMARY KEY (id),
            KEY idx_actor (actor_user_id),
            KEY idx_subject (subject_user_id),
            KEY idx_resource (resource_type, resource_id),
            KEY idx_event_type (event_type),
            KEY idx_created (created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;";

        require_once(ABSPATH . 'wp-admin/includes/upgrade.php');
        dbDelta($sql);
    }

    /**
     * Rollback the migration
     */
    public function rollback()
    {
        global $wpdb;
        $table_name = esc_sql($wpdb->prefix . 'kc_gdpr_audit_log');
        // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
        $wpdb->query("DROP TABLE IF EXISTS {$table_name}");
    }
}
