<?php

namespace KCProApp\models;

use App\baseClasses\KCBaseModel;

defined('ABSPATH') or die('Something went wrong');

class KCClinicalAIDraft extends KCBaseModel
{
    protected static function initSchema(): array
    {
        return [
            'table_name' => 'clinical_ai_drafts',
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
                'encounterId' => [
                    'column' => 'encounter_id',
                    'type' => 'bigint',
                    'nullable' => true,
                ],
                'audioPath' => [
                    'column' => 'audio_path',
                    'type' => 'text',
                    'nullable' => true,
                ],
                'rawTranscript' => [
                    'column' => 'raw_transcript',
                    'type' => 'text',
                    'nullable' => true,
                ],
                'labeledTranscript' => [
                    'column' => 'labeled_transcript',
                    'type' => 'text',
                    'nullable' => true,
                ],
                'llmInput' => [
                    'column' => 'llm_input',
                    'type' => 'text',
                    'nullable' => true,
                ],
                'llmOutput' => [
                    'column' => 'llm_output',
                    'type' => 'text',
                    'nullable' => true,
                ],
                'needsReview' => [
                    'column' => 'needs_review',
                    'type' => 'integer',
                    'default' => 0,
                ],
                'status' => [
                    'column' => 'status',
                    'type' => 'string',
                    'nullable' => false,
                ],
                'progress' => [
                    'column' => 'progress',
                    'type' => 'integer',
                    'default' => 0,
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
