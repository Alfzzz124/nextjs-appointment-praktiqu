<?php

namespace KiviCare\Migrations;

use App\database\classes\KCAbstractMigration;

defined('ABSPATH') or die('Something went wrong');

class CreateChainAuditLogsTable extends KCAbstractMigration
{
    /**
     * Run the migration
     */
    public function run() {
        global $wpdb;
        $table_name = $wpdb->prefix . 'kc_chain_audit_logs';

        if ($wpdb->get_var("SHOW TABLES LIKE '$table_name'") != $table_name) {
            $charset_collate = $wpdb->get_charset_collate();

            $sql = "CREATE TABLE $table_name (
                id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
                chain_id bigint(20) unsigned NOT NULL,
                followup_id bigint(20) unsigned NULL,
                user_id bigint(20) unsigned NOT NULL,
                role_snap varchar(50) NOT NULL,
                action_type varchar(100) NOT NULL,
                old_payload longtext NULL,
                new_payload longtext NULL,
                override_reason longtext NULL,
                created_at_utc datetime NOT NULL,
                PRIMARY KEY  (id),
                KEY idx_chain (chain_id),
                KEY idx_followup (followup_id),
                KEY idx_user (user_id)
            ) $charset_collate;";

            require_once(ABSPATH . 'wp-admin/includes/upgrade.php');
            dbDelta($sql);
        }
    }

    public function undo() {
        global $wpdb;
        $table_name = $wpdb->prefix . 'kc_chain_audit_logs';
        $wpdb->query("DROP TABLE IF EXISTS $table_name");
    }
}
