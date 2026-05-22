<?php

namespace KCProApp\models;

use App\baseClasses\KCBaseModel;

defined('ABSPATH') or die('Something went wrong');

class KCClinicalAINote extends KCBaseModel
{
    protected static function initSchema(): array
    {
        return [
            'table_name' => 'clinical_ai_notes',
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
                'encounterId' => [
                    'column' => 'encounter_id',
                    'type' => 'bigint',
                    'nullable' => true,
                ],
                'patientId' => [
                    'column' => 'patient_id',
                    'type' => 'bigint',
                    'nullable' => false,
                ],
                'doctorId' => [
                    'column' => 'doctor_id',
                    'type' => 'bigint',
                    'nullable' => false,
                ],
                'clinicId' => [
                    'column' => 'clinic_id',
                    'type' => 'bigint',
                    'nullable' => false,
                ],
                'clinicalJson' => [
                    'column' => 'clinical_json',
                    'type' => 'text',
                    'nullable' => false,
                ],
                'clinicalAiGenerated' => [
                    'column' => 'clinical_ai_generated',
                    'type' => 'integer',
                    'default' => 1,
                ],
                'clinicalAiSessionId' => [
                    'column' => 'clinical_ai_session_id',
                    'type' => 'string',
                    'nullable' => false,
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
}
