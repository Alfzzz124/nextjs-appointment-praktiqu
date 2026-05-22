<?php

namespace KCProApp\models;

use App\baseClasses\KCBaseModel;

defined('ABSPATH') or die('Something went wrong');

/**
 * Class KCProFollowupChain
 *
 * @property int $id
 * @property int $clinic_id
 * @property int $patient_id
 * @property int $doctor_id
 * @property string|null $name
 * @property int|null $diagnosis_id
 * @property string $status
 * @property string $created_at_utc
 * @property string|null $closed_at_utc
 * @property int|null $closed_by
 */
class KCProFollowupChain extends KCBaseModel
{
    /**
     * Define table structure and properties
     */
    protected static function initSchema(): array
    {
        return [
            'table_name' => 'kc_followup_chains',
            'primary_key' => 'id',
            'columns' => [
                'id' => [
                    'column' => 'id',
                    'type' => 'bigint',
                    'nullable' => false,
                    'auto_increment' => true,
                    'sanitizers' => ['intval'],
                ],
                'clinic_id' => [
                    'column' => 'clinic_id',
                    'type' => 'bigint',
                    'nullable' => false,
                    'sanitizers' => ['intval'],
                ],
                'patient_id' => [
                    'column' => 'patient_id',
                    'type' => 'bigint',
                    'nullable' => false,
                    'sanitizers' => ['intval'],
                ],
                'doctor_id' => [
                    'column' => 'doctor_id',
                    'type' => 'bigint',
                    'nullable' => false,
                    'sanitizers' => ['intval'],
                ],
                'diagnosis_id' => [
                    'column' => 'diagnosis_id',
                    'type' => 'bigint',
                    'nullable' => true,
                    'sanitizers' => ['intval'],
                ],
                'name' => [
                    'column' => 'name',
                    'type' => 'varchar',
                    'length' => 255,
                    'nullable' => true,
                    'sanitizers' => ['sanitize_text_field'],
                ],
                'status' => [
                    'column' => 'status',
                    'type' => 'enum',
                    'nullable' => true,
                    'default' => 'active',
                    'allowed_values' => ['active', 'closed', 'on_hold'],
                ],
                'created_at_utc' => [
                    'column' => 'created_at_utc',
                    'type' => 'datetime',
                    'nullable' => false,
                ],
                'closed_at_utc' => [
                    'column' => 'closed_at_utc',
                    'type' => 'datetime',
                    'nullable' => true,
                ],
                'closed_by' => [
                    'column' => 'closed_by',
                    'type' => 'bigint',
                    'nullable' => true,
                    'sanitizers' => ['intval'],
                ],
            ],
            'timestamps' => false,
            'soft_deletes' => false,
        ];
    }
}
