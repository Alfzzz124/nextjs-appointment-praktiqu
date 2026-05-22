<?php

namespace KCProApp\models;

use App\baseClasses\KCBaseModel;

defined('ABSPATH') or die('Something went wrong');

/**
 * Class KCProFollowupReminder
 *
 * @property int $id
 * @property int $followup_id
 * @property string $reminder_type
 * @property int $offset_days
 * @property string $channel
 * @property int|null $action_id
 * @property string|null $processed_at
 */
class KCProFollowupReminder extends KCBaseModel
{
    /**
     * Define table structure and properties
     */
    protected static function initSchema(): array
    {
        return [
            'table_name' => 'kc_followup_reminders',
            'primary_key' => 'id',
            'columns' => [
                'id' => [
                    'column' => 'id',
                    'type' => 'bigint',
                    'nullable' => false,
                    'auto_increment' => true,
                    'sanitizers' => ['intval'],
                ],
                'followup_id' => [
                    'column' => 'followup_id',
                    'type' => 'bigint',
                    'nullable' => false,
                    'sanitizers' => ['intval'],
                ],
                'reminder_type' => [
                    'column' => 'reminder_type',
                    'type' => 'varchar',
                    'nullable' => false,
                    'sanitizers' => ['sanitize_text_field'],
                ],
                'offset_days' => [
                    'column' => 'offset_days',
                    'type' => 'int',
                    'nullable' => false,
                    'default' => 0,
                    'sanitizers' => ['intval'],
                ],
                'channel' => [
                    'column' => 'channel',
                    'type' => 'enum',
                    'nullable' => false,
                    'default' => 'email',
                    'allowed_values' => ['sms', 'email', 'push'],
                ],
                'action_id' => [
                    'column' => 'action_id',
                    'type' => 'bigint',
                    'nullable' => true,
                    'sanitizers' => ['intval'],
                ],
                'processed_at' => [
                    'column' => 'processed_at',
                    'type' => 'datetime',
                    'nullable' => true,
                ],
            ],
            'timestamps' => false,
            'soft_deletes' => false,
        ];
    }
}
