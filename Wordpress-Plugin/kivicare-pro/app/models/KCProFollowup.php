<?php

namespace KCProApp\models;

use App\baseClasses\KCBaseModel;

defined('ABSPATH') or die('Something went wrong');

/**
 * Class KCProFollowup
 *
 * @property int $id
 * @property int $clinic_id
 * @property int $doctor_id
 * @property int $patient_id
 * @property int|null $encounter_id
 * @property int $chain_id
 * @property int|null $parent_followup_id
 * @property string $reason
 * @property string $priority
 * @property string $status
 * @property string $created_at_utc
 * @property string $suggested_date_utc
 * @property string $suggested_deadline_utc
 * @property int|null $scheduled_appointment_id
 * @property string|null $completed_at_utc
 * @property string|null $cancelled_at_utc
 * @property string|null $metadata
 * @property int|null $created_by
 * @property string|null $updated_at_utc
 * @property int|null $updated_by
 */
class KCProFollowup extends KCBaseModel
{
    /**
     * Define table structure and properties
     */
    protected static function initSchema(): array
    {
        return [
            'table_name' => 'kc_followups',
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
                'doctor_id' => [
                    'column' => 'doctor_id',
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
                'encounter_id' => [
                    'column' => 'encounter_id',
                    'type' => 'bigint',
                    'nullable' => true,
                    'sanitizers' => ['intval'],
                ],
                'chain_id' => [
                    'column' => 'chain_id',
                    'type' => 'bigint',
                    'nullable' => false,
                    'sanitizers' => ['intval'],
                ],
                'parent_followup_id' => [
                    'column' => 'parent_followup_id',
                    'type' => 'bigint',
                    'nullable' => true,
                    'sanitizers' => ['intval'],
                ],
                'reason' => [
                    'column' => 'reason',
                    'type' => 'text',
                    'nullable' => false,
                    'sanitizers' => ['sanitize_textarea_field'],
                ],
                'priority' => [
                    'column' => 'priority',
                    'type' => 'enum',
                    'nullable' => true,
                    'default' => 'routine',
                    'allowed_values' => ['routine', 'important', 'urgent'],
                ],
                'status' => [
                    'column' => 'status',
                    'type' => 'enum',
                    'nullable' => true,
                    'default' => 'pending',
                    'allowed_values' => ['pending', 'scheduled', 'completed', 'missed', 'cancelled'],
                ],
                'created_at_utc' => [
                    'column' => 'created_at_utc',
                    'type' => 'datetime',
                    'nullable' => false,
                ],
                'suggested_date_utc' => [
                    'column' => 'suggested_date_utc',
                    'type' => 'datetime',
                    'nullable' => false,
                ],
                'suggested_deadline_utc' => [
                    'column' => 'suggested_deadline_utc',
                    'type' => 'datetime',
                    'nullable' => false,
                ],
                'scheduled_appointment_id' => [
                    'column' => 'scheduled_appointment_id',
                    'type' => 'bigint',
                    'nullable' => true,
                    'sanitizers' => ['intval'],
                ],
                'completed_at_utc' => [
                    'column' => 'completed_at_utc',
                    'type' => 'datetime',
                    'nullable' => true,
                ],
                'cancelled_at_utc' => [
                    'column' => 'cancelled_at_utc',
                    'type' => 'datetime',
                    'nullable' => true,
                ],
                'metadata' => [
                    'column' => 'metadata',
                    'type' => 'json',
                    'nullable' => true,
                ],
                'created_by' => [
                    'column' => 'created_by',
                    'type' => 'bigint',
                    'nullable' => true,
                    'sanitizers' => ['intval'],
                ],
                'updated_at_utc' => [
                    'column' => 'updated_at_utc',
                    'type' => 'datetime',
                    'nullable' => true,
                ],
                'updated_by' => [
                    'column' => 'updated_by',
                    'type' => 'bigint',
                    'nullable' => true,
                    'sanitizers' => ['intval'],
                ],
            ],
            'timestamps' => false, // We manage custom UTC timestamps
            'soft_deletes' => false,
        ];
    }

    public function getMetadata(): array
    {
        return json_decode($this->metadata, true) ?? [];
    }

    public function setMetadata(array $data): void
    {
        $this->metadata = wp_json_encode($data);
    }
}
