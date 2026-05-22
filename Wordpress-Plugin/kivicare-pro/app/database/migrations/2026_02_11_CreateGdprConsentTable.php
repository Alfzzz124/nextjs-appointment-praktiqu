<?php

namespace KiviCare\Migrations;

use App\database\classes\KCAbstractMigration;

defined('ABSPATH') or die('Something went wrong');

class CreateGdprConsentTable extends KCAbstractMigration
{
    /**
     * Run the migration
     */
    public function run()
    {
        global $wpdb;
        $table_name = $wpdb->prefix . 'kc_gdpr_consents';

        // Create table for new installs (consent_version_id stored as a string label, e.g. "2.0")
        $sql = "CREATE TABLE {$table_name} (
            id bigint NOT NULL AUTO_INCREMENT,
            user_id bigint UNSIGNED NOT NULL,
            consent_type varchar(100) NOT NULL,
            consent_version_id varchar(50) NOT NULL DEFAULT '',
            status varchar(50) DEFAULT 'granted',
            granted_at datetime DEFAULT NULL,
            withdrawn_at datetime DEFAULT NULL,
            ip_address varchar(45) DEFAULT NULL,
            user_agent text DEFAULT NULL,
            method varchar(100) DEFAULT NULL,
            proof_reference varchar(255) DEFAULT NULL,
            created_at datetime NOT NULL,
            PRIMARY KEY (id),
            KEY idx_user_consent_status (user_id, consent_type, status),
            KEY idx_consent_version_id (consent_version_id)
        ) " . $this->get_collation() . ";";

        require_once(ABSPATH . 'wp-admin/includes/upgrade.php');
        dbDelta($sql);

        // For existing installs where the column is still bigint, alter it to varchar(50)
        $col = $wpdb->get_row(
            "SELECT DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME   = '{$table_name}'
               AND COLUMN_NAME  = 'consent_version_id'"
        );
        if ($col && strtolower($col->DATA_TYPE) !== 'varchar') {
            // Drop old index before altering the column
            $index_exists = $wpdb->get_var(
                "SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
                 WHERE TABLE_SCHEMA = DATABASE()
                   AND TABLE_NAME   = '{$table_name}'
                   AND INDEX_NAME   = 'idx_consent_version_id'"
            );
            if ($index_exists) {
                $wpdb->query("ALTER TABLE {$table_name} DROP INDEX idx_consent_version_id");
            }
            $wpdb->query(
                "ALTER TABLE {$table_name}
                 MODIFY COLUMN consent_version_id varchar(50) NOT NULL DEFAULT ''"
            );
            $wpdb->query(
                "ALTER TABLE {$table_name}
                 ADD INDEX idx_consent_version_id (consent_version_id)"
            );
        }
    }

    /**
     * Rollback the migration
     */
    public function rollback()
    {
        global $wpdb;
        $table_name = esc_sql($wpdb->prefix . 'kc_gdpr_consents');
        // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
        $wpdb->query("DROP TABLE IF EXISTS {$table_name}");
    }
}
