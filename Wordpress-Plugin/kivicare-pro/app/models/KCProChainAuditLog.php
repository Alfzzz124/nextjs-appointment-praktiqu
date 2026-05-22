<?php

namespace KCProApp\models;

use App\baseClasses\KCBaseModel;

defined('ABSPATH') or die('Something went wrong');

class KCProChainAuditLog extends KCBaseModel
{
    /**
     * Define table structure and properties
     */
    protected static function initSchema(): array
    {
        return [
            'table_name' => 'kc_chain_audit_logs',
            'primary_key' => 'id',
            'columns' => [
                'id' => [
                    'column' => 'id',
                    'type' => 'bigint',
                    'nullable' => false,
                    'auto_increment' => true,
                ],
                'chain_id' => [
                    'column' => 'chain_id',
                    'type' => 'bigint',
                    'nullable' => false,
                    'sanitizers' => ['intval'],
                ],
                'followup_id' => [
                    'column' => 'followup_id',
                    'type' => 'bigint',
                    'nullable' => true,
                    'sanitizers' => ['intval'],
                ],
                'user_id' => [
                    'column' => 'user_id',
                    'type' => 'bigint',
                    'nullable' => false,
                    'sanitizers' => ['intval'],
                ],
                'role_snap' => [
                    'column' => 'role_snap',
                    'type' => 'varchar',
                    'nullable' => false,
                    'sanitizers' => ['sanitize_text_field'],
                ],
                'action_type' => [
                    'column' => 'action_type',
                    'type' => 'varchar',
                    'nullable' => false,
                    'sanitizers' => ['sanitize_text_field'],
                ],
                'old_payload' => [
                    'column' => 'old_payload',
                    'type' => 'json',
                    'nullable' => true,
                ],
                'new_payload' => [
                    'column' => 'new_payload',
                    'type' => 'json',
                    'nullable' => true,
                ],
                'override_reason' => [
                    'column' => 'override_reason',
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
