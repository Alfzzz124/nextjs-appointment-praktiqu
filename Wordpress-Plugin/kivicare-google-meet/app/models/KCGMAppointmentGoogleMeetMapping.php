<?php

namespace KCGMApp\models;

use App\baseClasses\KCBaseModel;
use App\models\KCAppointment;

defined('ABSPATH') or die('Something went wrong');

/**
 * Class KCGMAppointmentGoogleMeetMapping
 * 
 * @property int $id
 * @property string $event_id
 * @property int $appointment_id
 * @property string $url
 * @property string|null $password
 * @property string|null $event_url
 */
class KCGMAppointmentGoogleMeetMapping extends KCBaseModel
{
    /**
     * Define table structure and properties
     */
    protected static function initSchema(): array
    {
        return [
            'table_name'  => 'kc_appointment_google_meet_mappings',
            'primary_key' => 'id',
            'columns' => [
                'id' => [
                    'column'         => 'id',
                    'type'           => 'int',
                    'nullable'       => false,
                    'auto_increment' => true,
                ],
                'eventId' => [
                    'column'     => 'event_id',
                    'type'       => 'varchar',
                    'nullable'   => false,
                    'sanitizers' => ['sanitize_text_field'],
                    'validators' => [
                        function($value) { return !empty($value) ? true : 'Event ID is required'; }
                    ],
                ],
                'appointmentId'  => [
                    'column'     => 'appointment_id',
                    'type'       => 'int',
                    'nullable'   => false,
                    'sanitizers' => ['intval'],
                    'validators' => [
                        function($value) { return $value > 0 ? true : 'Invalid appointment ID'; }
                    ],
                ],
                'url' => [
                    'column'     => 'url',
                    'type'       => 'varchar',
                    'nullable'   => false,
                    'sanitizers' => ['sanitize_url'],
                    'validators' => [
                        function($value) { return filter_var($value, FILTER_VALIDATE_URL) ? true : 'Invalid URL format'; }
                    ],
                ],
                'password' => [
                    'column'     => 'password',
                    'type'       => 'varchar',
                    'nullable'   => true,
                    'sanitizers' => ['sanitize_text_field'],
                ],
                'eventUrl' => [
                    'column'     => 'event_url',
                    'type'       => 'varchar',
                    'nullable'   => true,
                    'sanitizers' => ['sanitize_url'],
                    'validators' => [
                        function($value) { return $value === null || filter_var($value, FILTER_VALIDATE_URL) ? true : 'Invalid event URL format'; }
                    ],
                ],
            ],
            'timestamps'   => false,
            'soft_deletes' => false,
        ];
    }

    /**
     * Get the appointment that owns this Google Meet meeting.
     */
    public function getAppointment()
    {
        return KCAppointment::find($this->appointmentId);
    }
}