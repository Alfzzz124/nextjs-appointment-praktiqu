<?php

namespace KCProApp\models;

use App\baseClasses\KCBaseModel;

defined('ABSPATH') or die('Something went wrong');

/**
 * Class KCPatientEncountersTemplateMapping
 * 
 * @property int $id
 * @property string $encounters_template_name
 * @property int $status
 * @property string|null $created_at
 * @property int $added_by
 */
class KCPatientEncountersTemplateMapping extends KCBaseModel
{
    /**
     * Define table structure and properties
     */
    protected static function initSchema():array {

    return  [
        'table_name' => 'kc_patient_encounters_template_mapping',
        'primary_key' => 'id',
        'columns' => [
            'id' => [
                'column' => 'id',
                'type' => 'bigint',
                'nullable' => false,
                'auto_increment' => true,
            ],
            'encountersTemplateName' => [
                'column' => 'encounters_template_name',
                'type' => 'varchar',
                'nullable' => false,
                'sanitizers' => ['sanitize_text_field'],
                'validators' => [
                    fn($value) => !empty($value) ? true : 'Template name is required'
                ],
            ],
            'status' => [
                'column' => 'status',
                'type' => 'tinyint',
                'nullable' => false,
                'default' => 1,
                'sanitizers' => ['intval'],
                'validators' => [
                    fn($value) => in_array($value, [0, 1]) ? true : 'Status must be 0 or 1'
                ],
            ],
            'createdAt' => [
                'column' => 'created_at',
                'type' => 'datetime',
                'nullable' => true,
            ],
            'addedBy' => [
                'column' => 'added_by',
                'type' => 'int',
                'nullable' => false,
                'sanitizers' => ['intval'],
                'validators' => [
                    fn($value) => $value > 0 ? true : 'Invalid added by ID'
                ],
            ],
        ],
        'timestamps' => false, // We'll handle created_at manually
        'soft_deletes' => false,
    ];
    }
    /**
     * Get the user who added this template mapping
     */
    public function getAddedBy()
    {
        return KCUser::find($this->addedBy);
    }

    /**
     * Get all template details associated with this mapping
     */
    public function getTemplateDetails()
    {
        return KCPatientEncountersTemplate::query()
            ->where('encountersTemplateId', $this->id)
            ->get();
    }
}