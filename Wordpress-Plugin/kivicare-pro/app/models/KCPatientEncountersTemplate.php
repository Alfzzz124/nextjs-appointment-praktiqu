<?php

namespace KCProApp\models;

use App\baseClasses\KCBaseModel;

defined('ABSPATH') or die('Something went wrong');

/**
 * Class KCPatientEncountersTemplate
 * 
 * @property int $id
 * @property int $encounters_template_id
 * @property string $clinical_detail_type
 * @property string $clinical_detail_val
 * @property int $added_by
 * @property string|null $created_at
 */
class KCPatientEncountersTemplate extends KCBaseModel
{
    /**
     * Define table structure and properties
     */
    protected static function initSchema():array 
    { 
        return [
        'table_name' => 'kc_patient_encounters_template',
        'primary_key' => 'id',
        'columns' => [
            'id' => [
                'column' => 'id',
                'type' => 'bigint',
                'nullable' => false,
                'auto_increment' => true,
            ],
            'encountersTemplateId' => [
                'column' => 'encounters_template_id',
                'type' => 'bigint',
                'nullable' => false,
                'sanitizers' => ['intval'],
                'validators' => [
                    fn($value) => $value > 0 ? true : 'Invalid template ID'
                ],
            ],
            'clinicalDetailType' => [
                'column' => 'clinical_detail_type',
                'type' => 'varchar',
                'nullable' => false,
                'sanitizers' => ['sanitize_text_field'],
                'validators' => [
                    fn($value) => !empty($value) ? true : 'Clinical detail type is required'
                ],
            ],
            'clinicalDetailVal' => [
                'column' => 'clinical_detail_val',
                'type' => 'varchar',
                'nullable' => false,
                'sanitizers' => ['sanitize_text_field'],
                'validators' => [
                    fn($value) => !empty($value) ? true : 'Clinical detail value is required'
                ],
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
            'createdAt' => [
                'column' => 'created_at',
                'type' => 'datetime',
                'nullable' => true,
            ],
        ],
        'timestamps' => false, // We'll handle created_at manually
        'soft_deletes' => false,
    ];
}

    /**
     * Get the user who added this template
     */
    public function getAddedBy()
    {
        return KCUser::find($this->addedBy);
    }
}