<?php

namespace KCProApp\models;

use App\baseClasses\KCBaseModel;

defined('ABSPATH') or die('Something went wrong');

class KCGdprConsent extends KCBaseModel
{
    /**
     * Define table structure and properties for KCBaseModel
     */
    protected static function initSchema(): array
    {
        return [
            'table_name' => 'kc_gdpr_consents',
            'primary_key' => 'id',
            'columns' => [
                'id' => [
                    'column' => 'id',
                    'type' => 'bigint',
                    'nullable' => false,
                    'auto_increment' => true,
                ],
                'user_id' => [
                    'column' => 'user_id',
                    'type' => 'bigint',
                    'nullable' => false,
                    'unsigned' => true,
                ],
                'consent_type' => [
                    'column' => 'consent_type',
                    'type' => 'varchar',
                    'nullable' => false,
                    'sanitizers' => ['sanitize_text_field'],
                ],
                'consent_version_id' => [
                    'column' => 'consent_version_id',
                    'type' => 'varchar',
                    'nullable' => false,
                    'sanitizers' => ['sanitize_text_field'],
                ],
                'status' => [
                    'column' => 'status',
                    'type' => 'varchar',
                    'nullable' => false,
                    'default' => 'granted',
                    'sanitizers' => ['sanitize_text_field'],
                ],
                'granted_at' => [
                    'column'   => 'granted_at',
                    'type'     => 'datetime',
                    'nullable' => true,
                ],
                'withdrawn_at' => [
                    'column' => 'withdrawn_at',
                    'type' => 'datetime',
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
                'method' => [
                    'column' => 'method',
                    'type' => 'varchar',
                    'nullable' => false,
                    'sanitizers' => ['sanitize_text_field'],
                ],
                'proof_reference' => [
                    'column' => 'proof_reference',
                    'type' => 'varchar',
                    'nullable' => true,
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
    protected $table = 'kc_gdpr_consents';

    protected $fillable = [
        'user_id',
        'consent_type',
        'consent_version_id',
        'status',
        'granted_at',
        'withdrawn_at',
        'ip_address',
        'user_agent',
        'method',
        'proof_reference',
        'created_at',
    ];

    public $timestamps = false;

    /**
     * Relationship: consent belongsTo KCGdprConsentVersion
     */
    public function version()
    {
        return $this->belongsTo(KCGdprConsentVersion::class, 'consent_version_id');
    }
}
