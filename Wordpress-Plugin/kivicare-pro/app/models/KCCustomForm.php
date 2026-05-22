<?php

namespace KCProApp\models;

use App\baseClasses\KCBaseModel;

defined('ABSPATH') or die('Something went wrong');

/**
 * Class KCCustomForm
 *
 * @property int $id
 * @property string|null $name
 * @property string|null $module_type
 * @property string|null $fields
 * @property string|null $conditions
 * @property int|null $status
 * @property int $added_by
 * @property string|null $created_at
 * @property string|null $updated_at
 */
class KCCustomForm extends KCBaseModel
{
    /**
     * Define table structure and properties
     */
    protected static function initSchema(): array
    {
        return [
            'table_name' => 'kc_custom_forms',
            'primary_key' => 'id',
            'columns' => [
                'id' => [
                    'column' => 'id',
                    'type' => 'bigint',
                    'nullable' => false,
                    'auto_increment' => true,
                ],
                'name' => [
                    'column' => 'name',
                    'type' => 'longtext',
                    'nullable' => true,
                ],
                'module_type' => [
                    'column' => 'module_type',
                    'type' => 'varchar',
                    'nullable' => true,
                    'length' => 191,
                    'sanitizers' => ['sanitize_text_field'],
                ],
                'fields' => [
                    'column' => 'fields',
                    'type' => 'longtext',
                    'nullable' => true,
                ],
                'conditions' => [
                    'column' => 'conditions',
                    'type' => 'longtext',
                    'nullable' => true,
                ],
                'status' => [
                    'column' => 'status',
                    'type' => 'tinyint',
                    'nullable' => true,
                    'unsigned' => true,
                    'default' => 0,
                    'sanitizers' => ['intval'],
                ],
                'added_by' => [
                    'column' => 'added_by',
                    'type' => 'bigint',
                    'nullable' => false,
                    'sanitizers' => ['intval'],
                    'validators' => [
                        fn($value) => $value > 0 ? true : 'Invalid added by ID'
                    ],
                ],
                'created_at' => [
                    'column' => 'created_at',
                    'type' => 'datetime',
                    'nullable' => true,
                ],
                'updated_at' => [
                    'column' => 'updated_at',
                    'type' => 'datetime',
                    'nullable' => true,
                ],
            ],
            'timestamps' => true, // Enable automatic timestamp handling
            'soft_deletes' => false,
        ];
    }

    /**
     * Get the user who added this form
     */
    public function getAddedBy()
    {
        // Return user ID for now, or implement proper user lookup
        return $this->added_by;
    }

    /**
     * Get form name as array
     */
    public function getName(): array
    {
        return json_decode($this->name, true) ?? [];
    }

    /**
     * Set form name from array
     */
    public function setName(array $data): void
    {
        $this->name = wp_json_encode($data);
    }

    /**
     * Get form fields as array
     */
    public function getFields(): array
    {
        return json_decode($this->fields, true) ?? [];
    }

    /**
     * Set form fields from array
     */
    public function setFields(array $data): void
    {
        $this->fields = wp_json_encode($data);
    }

    /**
     * Get form conditions as array
     */
    public function getConditions(): array
    {
        return json_decode($this->conditions, true) ?? [];
    }

    /**
     * Set form conditions from array
     */
    public function setConditions(array $data): void
    {
        $this->conditions = wp_json_encode($data);
    }
}