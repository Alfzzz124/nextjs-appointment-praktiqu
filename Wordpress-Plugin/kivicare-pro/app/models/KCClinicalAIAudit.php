<?php

namespace KCProApp\models;

use App\baseClasses\KCBaseModel;

defined('ABSPATH') or die('Something went wrong');

class KCClinicalAIAudit extends KCBaseModel
{
    protected static function initSchema(): array
    {
        return [
            'table_name' => 'clinical_ai_audit',
            'primary_key' => 'id',
            'columns' => [
                'id' => [
                    'column' => 'id',
                    'type' => 'bigint',
                    'nullable' => false,
                    'auto_increment' => true,
                ],
                'sessionId' => [
                    'column' => 'session_id',
                    'type' => 'string',
                    'nullable' => false,
                ],
                'doctorId' => [
                    'column' => 'doctor_id',
                    'type' => 'bigint',
                    'nullable' => false,
                ],
                'patientId' => [
                    'column' => 'patient_id',
                    'type' => 'bigint',
                    'nullable' => false,
                ],
                'clinicId' => [
                    'column' => 'clinic_id',
                    'type' => 'bigint',
                    'nullable' => false,
                ],
                'llmOutputJson' => [
                    'column' => 'llm_output_json',
                    'type' => 'text',
                    'nullable' => true,
                ],
                'doctorEditedJson' => [
                    'column' => 'doctor_edited_json',
                    'type' => 'text',
                    'nullable' => true,
                ],
                'finalSavedJson' => [
                    'column' => 'final_saved_json',
                    'type' => 'text',
                    'nullable' => true,
                ],
                'aiGenerated' => [
                    'column' => 'ai_generated',
                    'type' => 'integer',
                    'default' => 1,
                ],
                'confirmedAt' => [
                    'column' => 'confirmed_at',
                    'type' => 'datetime',
                    'nullable' => true,
                ],
            ],
            'timestamps' => false,
            'soft_deletes' => false,
        ];
    }
}
