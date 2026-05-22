<?php

namespace KCGMApp\controllers\filters;

use App\baseClasses\KCQueryBuilder;
use App\models\KCAppointment;
use KCGMApp\models\KCGMAppointmentGoogleMeetMapping; 

defined('ABSPATH') || exit;

class KCGMAppointmentControllerFilters
{
    private static $instance = null;

    public function __construct()
    {
        add_action('kc_appointments_list_query', [$this, 'filter_appointments_list_query'], 10, 1);
        add_filter('kc_appointment_list_item', [$this, 'filter_appointments_list_item'], 10, 2);
        add_filter('kc_appointment_data', [$this, 'filter_appointment_data'], 10, 2);
        add_filter('kc_appointment_details_data', [$this, 'filter_appointment_data'], 10, 2);
        add_filter('kc_is_video_consultation', [$this, 'check_video_consultation'], 10, 2);
    }

    public static function get_instance(): ?KCGMAppointmentControllerFilters
    {
        if (!isset(self::$instance)) {
            self::$instance = new self();
        }
        return self::$instance;
    }

    public function filter_appointments_list_query(KCQueryBuilder $query)
    {
        $query
            ->leftJoin('kc_appointment_google_meet_mappings', 'a.id', '=', 'kctagmm.appointment_id', 'kctagmm')
            ->select(['kctagmm.url as meeting_url']);
    }

    public function filter_appointments_list_item(array $appointmentData, KCAppointment $appointment): array
    {
        if($appointment->meeting_url){
            $appointmentData['start_url'] = $appointment->meeting_url ?? null;
            $appointmentData['zoom_data'] = [
                'startUrl' => $appointment->meeting_url ?? null
            ];
        }
        return $appointmentData;
    }

    public function filter_appointment_data(array $appointmentData, $appointment): array
    {
        if (empty($appointmentData['start_url']) && class_exists(KCGMAppointmentGoogleMeetMapping::class)) {
            $appointmentId = is_object($appointment) ? $appointment->id : $appointment;
            $meeting_mapping = KCGMAppointmentGoogleMeetMapping::query()
                ->where('appointmentId', absint($appointmentId))
                ->first();

            if ($meeting_mapping && !empty($meeting_mapping->url)) {
                $appointmentData['start_url'] = $meeting_mapping->url;
                $appointmentData['zoom_data'] = [
                    'startUrl' => $meeting_mapping->url
                ];
            }
        }
        return $appointmentData;
    }

    /**
     * Check if appointment has video consultation (Google Meet)
     *
     * @param bool $default
     * @param int $appointmentId
     * @return bool
     */
    public function check_video_consultation($default, $appointmentId)
    {
        // If already determined to be a video consultation by another filter, return early
        if ($default) {
            return true;
        }

        // Check if Google Meet mapping exists with a valid URL for this appointment
        $meeting_mapping = KCGMAppointmentGoogleMeetMapping::query()
            ->where('appointmentId', absint($appointmentId))
            ->whereNotNull('url')
            ->where('url', '!=', '')
            ->first();

        return ($meeting_mapping !== null && !empty($meeting_mapping->url)) ? true : $default;
    }
}