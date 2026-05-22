<?php

namespace KCProApp\models;

use App\baseClasses\KCBaseModel;
use App\models\KCPatient;
use App\models\KCDoctor;

defined('ABSPATH') or die('Something went wrong');

/**
 * Class KCPPatientReview
 * 
 * @property int $id
 * @property int $review
 * @property string|null $reviewDescription
 * @property int $patientId
 * @property int $doctorId
 * @property string $createdAt
 * @property string $updatedAt
 */
class KCPPatientReview extends KCBaseModel
{
    /**
     * Define table structure and properties
     */
    protected static function initSchema():array {

    return  [
        'table_name' => 'kc_patient_review',
        'primary_key' => 'id',
        'columns' => [
            'id' => [
                'column' => 'id',
                'type' => 'bigint',
                'nullable' => false,
                'auto_increment' => true,
            ],
            'review' => [
                'column' => 'review',
                'type' => 'bigint',
                'nullable' => false,
                'sanitizers' => ['intval'],
                'validators' => [
                    fn($value) => $value >= 1 && $value <= 5 ? true : 'Review rating must be between 1 and 5'
                ],
            ],
            'reviewDescription' => [
                'column' => 'review_description',
                'type' => 'longtext',
                'nullable' => true,
                'sanitizers' => ['sanitize_text_field'],
            ],
            'patientId' => [
                'column' => 'patient_id',
                'type' => 'bigint',
                'nullable' => false,
                'sanitizers' => ['intval'],
                'validators' => [
                    fn($value) => $value > 0 ? true : 'Invalid patient ID'
                ],
            ],
            'doctorId' => [
                'column' => 'doctor_id',
                'type' => 'bigint',
                'nullable' => false,
                'sanitizers' => ['intval'],
                'validators' => [
                    fn($value) => $value > 0 ? true : 'Invalid doctor ID'
                ],
            ],
            'createdAt' => [
                'column' => 'created_at',
                'type' => 'datetime',
                'nullable' => false,
            ],
            'updatedAt' => [
                'column' => 'updated_at',
                'type' => 'datetime',
                'nullable' => false,
            ],
        ],
        'timestamps' => false, // The table has default values for timestamps
        'soft_deletes' => false,
    ];
    }

    /**
     * Get the patient who submitted this review
     */
    public function getPatient()
    {
        return KCPatient::find($this->patientId);
    }

    /**
     * Get the doctor who was reviewed
     */
    public function getDoctor()
    {
        return KCDoctor::find($this->doctorId);
    }
}