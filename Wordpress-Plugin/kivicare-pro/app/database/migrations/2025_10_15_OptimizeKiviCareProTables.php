<?php

namespace KiviCare\Migrations;

use App\database\classes\KCAbstractMigration;

defined('ABSPATH') or die('Something went wrong');

/**
 * Optimization migration for KiviCare Pro Plugin tables
 * Adds proper indexing and optimization to existing pro tables
 */
class OptimizeKiviCareProTables extends KCAbstractMigration 
{
    /**
     * Run the migration - Add indexes and optimize existing tables
     */
    public function run() 
    {
        $this->optimizeCustomFormsTable();
        $this->optimizeCustomFormDataTable();
        $this->addTimestampsIfMissing();
        $this->addForeignKeyConstraints();
    }

    /**
     * Rollback the migration - Remove indexes
     */
    public function rollback() 
    {
        $this->removeCustomFormsOptimizations();
        $this->removeCustomFormDataOptimizations();
        $this->removeForeignKeyConstraints();
    }

    /**
     * Optimize custom forms table
     */
    private function optimizeCustomFormsTable() 
    {
        global $wpdb;
        $table_name = $wpdb->prefix . 'kc_custom_forms';
        
        if (!$this->tableExists($table_name)) return;

        $indexes = [
            'idx_module_type' => 'module_type',
            'idx_status' => 'status',
            'idx_added_by' => 'added_by',
            'idx_created_at' => 'created_at',
            'idx_updated_at' => 'updated_at',
            'idx_module_status' => 'module_type, status',
            'idx_added_by_status' => 'added_by, status',
            'idx_module_added_by' => 'module_type, added_by',
            'idx_status_created' => 'status, created_at'
        ];

        $this->addIndexesToTable($table_name, $indexes);

        // Add full-text search index for form names if supported
        $this->addFullTextIndexIfSupported($table_name, 'name');
    }

    /**
     * Optimize custom form data table
     */
    private function optimizeCustomFormDataTable() 
    {
        global $wpdb;
        $table_name = $wpdb->prefix . 'kc_custom_form_data';
        
        if (!$this->tableExists($table_name)) return;

        $indexes = [
            'idx_form_id' => 'form_id',
            'idx_module_id' => 'module_id',
            'idx_created_at' => 'created_at',
            'idx_updated_at' => 'updated_at',
            'idx_form_module' => 'form_id, module_id',
            'idx_form_created' => 'form_id, created_at',
            'idx_module_created' => 'module_id, created_at',
            'idx_form_updated' => 'form_id, updated_at'
        ];

        $this->addIndexesToTable($table_name, $indexes);
    }

    /**
     * Add timestamps if missing (for older installations)
     */
    private function addTimestampsIfMissing() 
    {
        global $wpdb;
        
        // Custom forms table
        $custom_forms_table = $wpdb->prefix . 'kc_custom_forms';
        if ($this->tableExists($custom_forms_table)) {
            $columns = $wpdb->get_col("DESCRIBE {$custom_forms_table}", 0);
            
            if (!in_array('created_at', $columns)) {
                $wpdb->query("ALTER TABLE {$custom_forms_table} ADD COLUMN created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP");
            }
            
            if (!in_array('updated_at', $columns)) {
                $wpdb->query("ALTER TABLE {$custom_forms_table} ADD COLUMN updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP");
            }
            
            if (!in_array('added_by', $columns)) {
                $wpdb->query("ALTER TABLE {$custom_forms_table} ADD COLUMN added_by bigint UNSIGNED NOT NULL DEFAULT 0");
            }
        }
        
        // Custom form data table
        $custom_form_data_table = $wpdb->prefix . 'kc_custom_form_data';
        if ($this->tableExists($custom_form_data_table)) {
            $columns = $wpdb->get_col("DESCRIBE {$custom_form_data_table}", 0);
            
            if (!in_array('created_at', $columns)) {
                $wpdb->query("ALTER TABLE {$custom_form_data_table} ADD COLUMN created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP");
            }
            
            if (!in_array('updated_at', $columns)) {
                $wpdb->query("ALTER TABLE {$custom_form_data_table} ADD COLUMN updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP");
            }
        }

        // Update existing records with current timestamp where NULL
        $wpdb->query("UPDATE {$custom_forms_table} SET created_at = NOW() WHERE created_at IS NULL OR created_at = '0000-00-00 00:00:00'");
        $wpdb->query("UPDATE {$custom_forms_table} SET updated_at = NOW() WHERE updated_at IS NULL OR updated_at = '0000-00-00 00:00:00'");
        $wpdb->query("UPDATE {$custom_form_data_table} SET created_at = NOW() WHERE created_at IS NULL OR created_at = '0000-00-00 00:00:00'");
        $wpdb->query("UPDATE {$custom_form_data_table} SET updated_at = NOW() WHERE updated_at IS NULL OR updated_at = '0000-00-00 00:00:00'");
    }

    /**
     * Add foreign key constraints for data integrity
     */
    private function addForeignKeyConstraints() 
    {
        global $wpdb;
        
        $custom_form_data_table = $wpdb->prefix . 'kc_custom_form_data';
        $custom_forms_table = $wpdb->prefix . 'kc_custom_forms';
        
        if (!$this->tableExists($custom_form_data_table) || !$this->tableExists($custom_forms_table)) {
            return;
        }

        // Check if foreign key constraint exists
        $fk_exists = $wpdb->get_var("
            SELECT COUNT(*) 
            FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE 
            WHERE TABLE_SCHEMA = DATABASE() 
            AND TABLE_NAME = '{$custom_form_data_table}' 
            AND CONSTRAINT_NAME = 'fk_custom_form_data_form_id'
        ");

        if (!$fk_exists) {
            // Add foreign key constraint for form_id
            $wpdb->query("
                ALTER TABLE {$custom_form_data_table} 
                ADD CONSTRAINT fk_custom_form_data_form_id 
                FOREIGN KEY (form_id) REFERENCES {$custom_forms_table}(id) 
                ON DELETE CASCADE ON UPDATE CASCADE
            ");
        }
    }

    /**
     * Add full-text search index if supported
     */
    private function addFullTextIndexIfSupported($table_name, $column) 
    {
        global $wpdb;
        
        // Check if engine supports full-text search
        $engine = $wpdb->get_var("
            SELECT ENGINE 
            FROM INFORMATION_SCHEMA.TABLES 
            WHERE TABLE_SCHEMA = DATABASE() 
            AND TABLE_NAME = '{$table_name}'
        ");

        if (in_array(strtoupper($engine), ['MYISAM', 'INNODB'])) {
            // Check if full-text index exists
            $ft_exists = $wpdb->get_var("
                SELECT COUNT(*) 
                FROM INFORMATION_SCHEMA.STATISTICS 
                WHERE TABLE_SCHEMA = DATABASE() 
                AND TABLE_NAME = '{$table_name}' 
                AND INDEX_TYPE = 'FULLTEXT'
                AND COLUMN_NAME = '{$column}'
            ");

            if (!$ft_exists) {
                $wpdb->query("ALTER TABLE {$table_name} ADD FULLTEXT ft_idx_{$column} ({$column})");
            }
        }
    }

    /**
     * Helper method to check if table exists
     */
    private function tableExists($table_name) 
    {
        global $wpdb;
        return $wpdb->get_var("SHOW TABLES LIKE '{$table_name}'") === $table_name;
    }

    /**
     * Helper method to add indexes to a table
     */
    private function addIndexesToTable($table_name, $indexes) 
    {
        global $wpdb;
        
        foreach ($indexes as $index_name => $columns) {
            // Check if index exists
            $index_exists = $wpdb->get_var("
                SELECT COUNT(*) 
                FROM INFORMATION_SCHEMA.STATISTICS 
                WHERE TABLE_SCHEMA = DATABASE() 
                AND TABLE_NAME = '{$table_name}' 
                AND INDEX_NAME = '{$index_name}'
            ");

            if (!$index_exists) {
                $wpdb->query("ALTER TABLE {$table_name} ADD INDEX {$index_name} ({$columns})");
            }
        }
    }

    /**
     * Remove custom forms optimizations
     */
    private function removeCustomFormsOptimizations() 
    {
        global $wpdb;
        $table_name = $wpdb->prefix . 'kc_custom_forms';
        
        if (!$this->tableExists($table_name)) return;

        $indexes = [
            'idx_module_type',
            'idx_status',
            'idx_added_by',
            'idx_created_at',
            'idx_updated_at',
            'idx_module_status',
            'idx_added_by_status',
            'idx_module_added_by',
            'idx_status_created',
            'ft_idx_name'
        ];

        $this->removeIndexesFromTable($table_name, $indexes);
    }

    /**
     * Remove custom form data optimizations
     */
    private function removeCustomFormDataOptimizations() 
    {
        global $wpdb;
        $table_name = $wpdb->prefix . 'kc_custom_form_data';
        
        if (!$this->tableExists($table_name)) return;

        $indexes = [
            'idx_form_id',
            'idx_module_id',
            'idx_created_at',
            'idx_updated_at',
            'idx_form_module',
            'idx_form_created',
            'idx_module_created',
            'idx_form_updated'
        ];

        $this->removeIndexesFromTable($table_name, $indexes);
    }

    /**
     * Remove foreign key constraints
     */
    private function removeForeignKeyConstraints() 
    {
        global $wpdb;
        $table_name = $wpdb->prefix . 'kc_custom_form_data';
        
        if (!$this->tableExists($table_name)) return;

        // Check if foreign key constraint exists
        $fk_exists = $wpdb->get_var("
            SELECT COUNT(*) 
            FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE 
            WHERE TABLE_SCHEMA = DATABASE() 
            AND TABLE_NAME = '{$table_name}' 
            AND CONSTRAINT_NAME = 'fk_custom_form_data_form_id'
        ");

        if ($fk_exists) {
            $wpdb->query("ALTER TABLE {$table_name} DROP FOREIGN KEY fk_custom_form_data_form_id");
        }
    }

    /**
     * Helper method to remove indexes from a table
     */
    private function removeIndexesFromTable($table_name, $indexes) 
    {
        global $wpdb;
        
        foreach ($indexes as $index_name) {
            // Check if index exists before dropping
            $index_exists = $wpdb->get_var("
                SELECT COUNT(*) 
                FROM INFORMATION_SCHEMA.STATISTICS 
                WHERE TABLE_SCHEMA = DATABASE() 
                AND TABLE_NAME = '{$table_name}' 
                AND INDEX_NAME = '{$index_name}'
            ");

            if ($index_exists) {
                $wpdb->query("ALTER TABLE {$table_name} DROP INDEX {$index_name}");
            }
        }
    }
}