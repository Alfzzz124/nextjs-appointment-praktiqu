<?php

namespace KCProApp\models;

use App\baseClasses\KCBaseModel;

defined('ABSPATH') or die('Something went wrong');

/**
 * Class KCProFollowupActivityLog
 *
 * @property int $id
 * @property int $followup_id
 * @property int $user_id
 * @property string $action
 * @property string|null $old_status
 * @property string|null $new_status
 * @property string|null $note
 * @property string $created_at_utc
 */
class KCProFollowupActivityLog extends KCBaseModel
{
    /**
     * Define table structure and properties
     */
    protected static function initSchema(): array
    {
        return [
            'table_name' => 'kc_followup_activity_log',
            'primary_key' => 'id',
            'columns' => [
                'id' => [
                    'column' => 'id',
                    'type' => 'bigint',
                    'nullable' => false,
                    'auto_increment' => true,
                ],
                'followup_id' => [
                    'column' => 'followup_id',
                    'type' => 'bigint',
                    'nullable' => false,
                    'sanitizers' => ['intval'],
                ],
                'user_id' => [
                    'column' => 'user_id',
                    'type' => 'bigint',
                    'nullable' => false,
                    'sanitizers' => ['intval'],
                ],
                'action' => [
                    'column' => 'action',
                    'type' => 'varchar',
                    'length' => 50,
                    'nullable' => false,
                    'sanitizers' => ['sanitize_text_field'],
                ],
                'old_status' => [
                    'column' => 'old_status',
                    'type' => 'varchar',
                    'length' => 20,
                    'nullable' => true,
                    'sanitizers' => ['sanitize_text_field'],
                ],
                'new_status' => [
                    'column' => 'new_status',
                    'type' => 'varchar',
                    'length' => 20,
                    'nullable' => true,
                    'sanitizers' => ['sanitize_text_field'],
                ],
                'note' => [
                    'column' => 'note',
                    'type' => 'text',
                    'nullable' => true,
                    'sanitizers' => ['sanitize_textarea_field'],
                ],
                'created_at_utc' => [
                    'column' => 'created_at_utc',
                    'type' => 'datetime',
                    'nullable' => false,
                ],
            ],
            'timestamps' => false,
            'soft_deletes' => false,
        ];
    }
}
