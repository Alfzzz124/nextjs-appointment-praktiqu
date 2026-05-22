<?php

namespace KCProApp\models;

use App\baseClasses\KCBaseModel;

defined('ABSPATH') or die('Something went wrong');

class KCGdprAuditLog extends KCBaseModel
{
    /**
     * Define table structure and properties for KCBaseModel
     */
    protected static function initSchema(): array
    {
        return [
            'table_name' => 'kc_gdpr_audit_log',
            'primary_key' => 'id',
            'columns' => [
                'id' => [
                    'column' => 'id',
                    'type' => 'bigint',
                    'nullable' => false,
                    'auto_increment' => true,
                ],
                'event_type' => [
                    'column' => 'event_type',
                    'type' => 'varchar',
                    'nullable' => false,
                    'sanitizers' => ['sanitize_text_field'],
                ],
                'actor_user_id' => [
                    'column' => 'actor_user_id',
                    'type' => 'bigint',
                    'nullable' => false,
                    'unsigned' => true,
                ],
                'actor_role' => [
                    'column' => 'actor_role',
                    'type' => 'varchar',
                    'nullable' => false,
                    'sanitizers' => ['sanitize_text_field'],
                ],
                'subject_user_id' => [
                    'column' => 'subject_user_id',
                    'type' => 'bigint',
                    'nullable' => true,
                    'unsigned' => true,
                ],
                'resource_type' => [
                    'column' => 'resource_type',
                    'type' => 'varchar',
                    'nullable' => true,
                    'sanitizers' => ['sanitize_text_field'],
                ],
                'resource_id' => [
                    'column' => 'resource_id',
                    'type' => 'bigint',
                    'nullable' => true,
                    'unsigned' => true,
                ],
                'action' => [
                    'column' => 'action',
                    'type' => 'varchar',
                    'nullable' => false,
                    'sanitizers' => ['sanitize_text_field'],
                ],
                'details' => [
                    'column' => 'details',
                    'type' => 'longtext', // json
                    'nullable' => true,
                ],
                'ip_address' => [
                    'column' => 'ip_address',
                    'type' => 'varchar',
                    'nullable' => true,
                    'sanitizers' => ['sanitize_text_field'],
                ],
                'user_agent' => [
                    'column' => 'user_agent',
                    'type' => 'longtext',
                    'nullable' => true,
                ],
                'request_uri' => [
                    'column' => 'request_uri',
                    'type' => 'varchar',
                    'nullable' => true,
                    'sanitizers' => ['sanitize_text_field'],
                ],
                'checksum' => [
                    'column' => 'checksum',
                    'type' => 'varchar',
                    'nullable' => false,
                    'sanitizers' => ['sanitize_text_field'],
                ],
                'created_at' => [
                    'column' => 'created_at',
                    'type' => 'datetime',
                    'nullable' => false,
                ],
            ],
            'timestamps' => false,
            'soft_deletes' => false,
        ];
    }

    // Illuminate ORM pattern definitions
    protected $table = 'kc_gdpr_audit_log';

    protected $fillable = [
        'event_type',
        'actor_user_id',
        'actor_role',
        'subject_user_id',
        'resource_type',
        'resource_id',
        'action',
        'details',
        'ip_address',
        'user_agent',
        'request_uri',
        'checksum',
        'created_at',
    ];

    public $timestamps = false;

    /**
     * Defense in depth: Application Guard
     * Override delete to prevent deletion of the audit log.
     */
    public function delete(): bool
    {
        throw new \Exception('Audit log is immutable');
    }

    /**
     * Defense in depth: Application Guard
     * Override update to prevent modification of the audit log.
     * @param array $data The data to update
     * @return int|\WP_Error Returns the primary key on success, WP_Error or false on failure
     */
    public function update(array $data): int|\WP_Error
    {
        throw new \Exception('Audit log is immutable');
    }
}
