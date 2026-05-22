<?php

namespace KCProApp\models;

use App\baseClasses\KCBaseModel;
use App\models\KCUser;
use KCProApp\models\KCPatientEncountersTemplateMapping;

defined('ABSPATH') or die('Something went wrong');

/**
 * Class KCPrescriptionEncounterTemplate
 * 
 * @property int $id
 * @property int $encounters_template_id
 * @property string $name
 * @property string|null $frequency
 * @property string|null $duration
 * @property string $instruction
 * @property int $added_by
 * @property string|null $created_at
 * @property string|null $updated_at
 */
class KCPrescriptionEncounterTemplate extends KCBaseModel
{
    /**
     * Define table structure and properties
     */
    protected static function initSchema(): array
    {
        return [
            'table_name' => 'kc_prescription_enconter_template',
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
                        fn($value) => $value > 0 ? true : 'Invalid encounters template ID'
                    ],
                ],
                'name' => [
                    'column' => 'name',
                    'type' => 'text',
                    'nullable' => true,
                    'sanitizers' => ['sanitize_text_field'],
                ],
                'frequency' => [
                    'column' => 'frequency',
                    'type' => 'varchar',
                    'nullable' => true,
                    'sanitizers' => ['sanitize_text_field'],
                ],
                'duration' => [
                    'column' => 'duration',
                    'type' => 'varchar',
                    'nullable' => true,
                    'sanitizers' => ['sanitize_text_field'],
                ],
                'instruction' => [
                    'column' => 'instruction',
                    'type' => 'text',
                    'nullable' => true,
                    'sanitizers' => ['sanitize_text_field'],
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
                'updatedAt' => [
                    'column' => 'updated_at',
                    'type' => 'datetime',
                    'nullable' => true,
                ],
            ],
            'timestamps' => true,
            'soft_deletes' => false,
        ];
    }

    /**
     * Get the user who added this prescription template
     */
    public function getAddedBy()
    {
        return KCUser::find($this->addedBy);
    }

    /**
     * Get the encounter template this prescription belongs to
     */
    public function getEncounterTemplate()
    {
        return KCPatientEncountersTemplateMapping::find($this->encountersTemplateId);
    }
}