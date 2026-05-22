<?php

namespace KiviCare\Migrations;

use App\database\classes\KCAbstractMigration;

defined('ABSPATH') or die('Something went wrong');

class CreateGdprConsentVersionsTable extends KCAbstractMigration
{
    /**
     * Run the migration
     */
    public function run()
    {
        global $wpdb;
        $table_name = $wpdb->prefix . 'kc_gdpr_consent_versions';
        
        $sql = "CREATE TABLE {$table_name} (
            id bigint NOT NULL AUTO_INCREMENT,
            consent_type varchar(100) NOT NULL,
            version_number int UNSIGNED NOT NULL,
            title varchar(255) NOT NULL,
            body_text longtext NOT NULL,
            legal_basis varchar(100) NOT NULL,
            is_active tinyint(1) DEFAULT '1',
            created_by bigint UNSIGNED NOT NULL,
            created_at datetime NOT NULL,
            PRIMARY KEY (id),
            UNIQUE KEY uk_consent_type_version (consent_type, version_number)
        ) " . $this->get_collation() . ";";

        require_once(ABSPATH . 'wp-admin/includes/upgrade.php');
        dbDelta($sql);
    }

    /**
     * Rollback the migration
     */
    public function rollback()
    {
        global $wpdb;
        $table_name = esc_sql($wpdb->prefix . 'kc_gdpr_consent_versions');
        // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
        $wpdb->query("DROP TABLE IF EXISTS {$table_name}");
    }
}
