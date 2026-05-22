<?php

namespace KiviCare\Migrations;

use App\database\classes\KCAbstractMigration;
use App\baseClasses\KCErrorLogger;

defined('ABSPATH') or die('Something went wrong');

/**
 * Migration to transform old custom form data structure to new format
 * Converts old field and condition structures to match the new API expectations
 */
class TransformCustomFormDataStructure extends KCAbstractMigration {
    
    /**
     * Run the migration
     */
    public function run() {
        global $wpdb;
        
        // Transform custom_forms table data
        $this->transformCustomFormsData();
        
        // Transform conditions structure
        $this->transformConditionsStructure();
        
        // Log transformation
        KCErrorLogger::instance()->error('Custom form data transformation completed');
    }
    
    /**
     * Transform fields structure in custom_forms table
     */
    private function transformCustomFormsData() {
        global $wpdb;
        $table_name = $wpdb->prefix . 'kc_custom_forms';
        
        // Get all forms that need transformation
        $forms = $wpdb->get_results("SELECT id, fields FROM {$table_name} WHERE fields IS NOT NULL");
        
        foreach ($forms as $form) {
            if (empty($form->fields)) continue;
            
            $fields = json_decode($form->fields, true);
            if (!$fields) continue;
            
            $transformed_fields = $this->transformFieldsArray($fields);
            
            // Update the form with transformed fields
            $wpdb->update(
                $table_name,
                ['fields' => wp_json_encode($transformed_fields)],
                ['id' => $form->id],
                ['%s'],
                ['%d']
            );
        }
    }
    
    /**
     * Transform fields array to new structure
     */
    private function transformFieldsArray($fields) {
        $transformed = [];
        
        foreach ($fields as $field) {
            // Skip if not an array/object
            if (!is_array($field)) continue;
            
            // Convert old structure to new structure
            $new_field = [
                'id' => $field['name'] ?? 'field_' . uniqid(),
                'type' => $this->mapFieldType($field),
                'label' => $field['label'] ?? '',
                'placeholder' => $field['placeholder'] ?? '',
                'required' => !empty($field['is_required']),
                'className' => $field['class'] ?? '',
                'columnClass' => 'col-md-6 col-12', // Default column class
            ];
            
            // Handle options for select, radio, checkbox fields
            if (!empty($field['options']) && is_array($field['options'])) {
                $new_field['options'] = $this->transformFieldOptions($field['options']);
            }
            
            // Handle file upload types
            if (!empty($field['file_upload_type']) && is_array($field['file_upload_type'])) {
                $new_field['acceptedFiles'] = $this->transformFileUploadTypes($field['file_upload_type']);
            }
            
            // Handle heading tag
            if (!empty($field['tag'])) {
                $new_field['tag'] = $field['tag'];
            }
            
            $transformed[] = $new_field;
        }
        
        return $transformed;
    }
    
    /**
     * Map old field types to new field types
     */
    private function mapFieldType($field) {
        if (!isset($field['type'])) return 'text';
        
        // Handle both string and object type formats
        $type = is_array($field['type']) ? ($field['type']['id'] ?? 'text') : $field['type'];
        
        // Map old types to new types
        $type_mapping = [
            'file_upload' => 'file',
            'multi_select' => 'select', // Convert multi-select to regular select for now
            'hr' => 'divider',
            'heading' => 'heading',
        ];
        
        return $type_mapping[$type] ?? $type;
    }
    
    /**
     * Transform field options from old to new structure
     */
    private function transformFieldOptions($options) {
        $transformed_options = [];
        
        foreach ($options as $option) {
            if (is_array($option)) {
                // Old structure: {id: "value", text: "label"}
                $transformed_options[] = $option['text'] ?? $option['id'] ?? '';
            } else {
                // Already in new structure
                $transformed_options[] = $option;
            }
        }
        
        return $transformed_options;
    }
    
    /**
     * Transform file upload types to accepted files format
     */
    private function transformFileUploadTypes($types) {
        $accepted_files = [];
        
        foreach ($types as $type) {
            if (is_array($type) && isset($type['id'])) {
                $accepted_files[] = $type['id'];
            }
        }
        
        return implode(',', $accepted_files);
    }
    
    /**
     * Transform conditions structure
     */
    private function transformConditionsStructure() {
        global $wpdb;
        $table_name = $wpdb->prefix . 'kc_custom_forms';
        
        // Get all forms with conditions
        $forms = $wpdb->get_results("SELECT id, conditions FROM {$table_name} WHERE conditions IS NOT NULL");
        
        foreach ($forms as $form) {
            if (empty($form->conditions)) continue;
            
            $conditions = json_decode($form->conditions, true);
            if (!$conditions) continue;
            
            $transformed_conditions = $this->transformConditionsArray($conditions);
            
            // Update the form with transformed conditions
            $wpdb->update(
                $table_name,
                ['conditions' => wp_json_encode($transformed_conditions)],
                ['id' => $form->id],
                ['%s'],
                ['%d']
            );
        }
    }
    
    /**
     * Transform conditions array to new structure
     */
    private function transformConditionsArray($conditions) {
        $transformed = [];
        
        // Transform clinic_ids to clinics
        if (!empty($conditions['clinic_ids'])) {
            $transformed['clinics'] = [];
            foreach ($conditions['clinic_ids'] as $clinic) {
                if (is_array($clinic) && isset($clinic['id'])) {
                    $transformed['clinics'][] = (int) $clinic['id'];
                }
            }
        }
        
        // Transform role_id to roles
        if (!empty($conditions['role_id'])) {
            $transformed['roles'] = [];
            foreach ($conditions['role_id'] as $role) {
                if (is_array($role) && isset($role['id'])) {
                    $transformed['roles'][] = $role['id'];
                }
            }
        }
        
        // Keep existing show_mode and appointment_status as they seem correct
        if (!empty($conditions['show_mode'])) {
            $transformed['show_mode'] = $conditions['show_mode'];
        }
        
        if (!empty($conditions['appointment_status'])) {
            $transformed['appointment_status'] = $conditions['appointment_status'];
        }
        
        return $transformed;
    }
    
    /**
     * Rollback the migration (restore original data from backup if needed)
     */
    public function rollback() {
        // This is a data transformation migration
        // Rollback would require restoring from backup
        // For now, just log the rollback attempt
        KCErrorLogger::instance()->error('Custom form data transformation rollback attempted - manual data restoration may be required');
    }
}