<?php

namespace KCProApp\models;

use App\baseClasses\KCBaseModel;

defined('ABSPATH') or die('Something went wrong');

class KCGdprConsentVersion extends KCBaseModel
{
    /**
     * Define table structure and properties for KCBaseModel
     */
    protected static function initSchema(): array
    {
        return [
            'table_name' => 'kc_gdpr_consent_versions',
            'primary_key' => 'id',
            'columns' => [
                'id' => [
                    'column' => 'id',
                    'type' => 'bigint',
                    'nullable' => false,
                    'auto_increment' => true,
                ],
                'consent_type' => [
                    'column' => 'consent_type',
                    'type' => 'varchar',
                    'nullable' => false,
                    'sanitizers' => ['sanitize_text_field'],
                ],
                'version_number' => [
                    'column' => 'version_number',
                    'type' => 'int',
                    'nullable' => false,
                    'unsigned' => true,
                ],
                'title' => [
                    'column' => 'title',
                    'type' => 'varchar',
                    'nullable' => false,
                    'sanitizers' => ['sanitize_text_field'],
                ],
                'body_text' => [
                    'column' => 'body_text',
                    'type' => 'longtext',
                    'nullable' => false,
                ],
                'legal_basis' => [
                    'column' => 'legal_basis',
                    'type' => 'varchar',
                    'nullable' => false,
                    'sanitizers' => ['sanitize_text_field'],
                ],
                'is_active' => [
                    'column' => 'is_active',
                    'type' => 'bool',
                    'nullable' => false,
                    'default' => 1,
                ],
                'created_by' => [
                    'column' => 'created_by',
                    'type' => 'bigint',
                    'nullable' => false,
                    'unsigned' => true,
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
    protected $table = 'kc_gdpr_consent_versions';

    protected $fillable = [
        'consent_type',
        'version_number',
        'title',
        'body_text',
        'legal_basis',
        'is_active',
        'created_by',
        'created_at',
    ];

    public $timestamps = false;

    /**
     * Relationship: version hasMany KCGdprConsent
     */
    public function consents()
    {
        return $this->hasMany(KCGdprConsent::class, 'consent_version_id');
    }
}
