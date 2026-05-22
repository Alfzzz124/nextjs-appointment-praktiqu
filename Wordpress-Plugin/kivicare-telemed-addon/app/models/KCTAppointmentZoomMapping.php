<?php

namespace KCTApp\models;

use App\baseClasses\KCBaseModel;

defined('ABSPATH') or die('Something went wrong');

class KCTAppointmentZoomMapping extends KCBaseModel
{
    /**
     * Define table structure and properties
     */
    protected static function initSchema(): array
    {
        return [
            'table_name' => 'kc_appointment_zoom_mappings',
            'primary_key' => 'id',
            'columns' => [
                'id' => [
                    'column' => 'id',
                    'type' => 'bigint',
                    'nullable' => false,
                    'auto_increment' => true,
                ],
                'appointmentId' => [
                    'column' => 'appointment_id',
                    'type' => 'bigint',
                    'nullable' => false,
                    'sanitizers' => ['intval'],
                    'validators' => [
                        fn($value) => $value > 0 ? true : 'Invalid appointment ID'
                    ],
                ],
                'zoomId' => [
                    'column' => 'zoom_id',
                    'type' => 'varchar',
                    'nullable' => true,
                    'sanitizers' => ['sanitize_text_field'],
                    'validators' => [
                        fn($value) => !empty($value) ? true : 'Zoom ID is required'
                    ],
                ],
                'zoomUUID' => [
                    'column' => 'zoom_uuid',
                    'type' => 'varchar',
                    'nullable' => true,
                    'sanitizers' => ['sanitize_text_field'],
                    'validators' => [
                        fn($value) => !empty($value) ? true : 'Zoom UUID is required'
                    ],
                ],
                'startUrl' => [
                    'column' => 'start_url',
                    'type' => 'longtext',
                    'nullable' => true,
                    'sanitizers' => [function ($value) {
                        return !empty($value) ? sanitize_url($value) : '';
                    }],
                ],
                'joinUrl' => [
                    'column' => 'join_url',
                    'type' => 'longtext',
                    'nullable' => true,
                    'sanitizers' => [function ($value) {
                        return !empty($value) ? sanitize_url($value) : '';
                    }],
                ],
                'password' => [
                    'column' => 'password',
                    'type' => 'varchar',
                    'nullable' => true,
                    'sanitizers' => ['sanitize_text_field'],
                ],
                'createdAt' => [
                    'column' => 'created_at',
                    'type' => 'datetime',
                    'nullable' => false,
                ],
                'extra' => [
                    'column' => 'extra',
                    'type' => 'text',
                    'nullable' => true,
                    'sanitizers' => ['sanitize_textarea_field'],
                ],
            ],
            'timestamps' => false, // We'll handle created_at manually
            'soft_deletes' => false,
        ];
    }

}