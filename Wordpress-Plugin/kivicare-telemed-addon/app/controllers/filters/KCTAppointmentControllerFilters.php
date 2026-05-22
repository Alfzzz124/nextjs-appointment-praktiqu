<?php
namespace KCTApp\controllers\filters;

use App\baseClasses\KCQueryBuilder;
use App\models\KCAppointment;
use KCTApp\models\KCTAppointmentZoomMapping;


if (!defined('ABSPATH')) {
    exit; // Exit if accessed directly
}
class KCTAppointmentControllerFilters
{
    /**
     * Override the parent method to add custom functionality
     */
    private static ?KCTAppointmentControllerFilters $instance = null;
    public function __construct()
    {
        add_action('kc_appointments_list_query', [$this, 'filter_appointments_list_query']);
        add_filter('kc_appointment_list_item', [$this, 'add_zoom_data_to_upcoming_appointment'], 10, 2);
        add_filter('kc_appointment_data', [$this, 'add_zoom_data_to_upcoming_appointment'], 10, 2);
        add_filter('kc_appointment_details_data', [$this, 'add_zoom_data_to_upcoming_appointment'], 10, 2);
        add_filter('kc_get_upcoming_appointment_data', [$this, 'add_zoom_data_to_upcoming_appointment'], 10, 2);
        add_filter('kc_is_video_consultation', [$this, 'check_video_consultation'], 10, 2);
    }

    public static function get_instance(): KCTAppointmentControllerFilters|null
    {
        if (!isset(self::$instance)) {
            self::$instance = new self();
        }
        return self::$instance;
    }

    public function filter_appointments_list_query(KCQueryBuilder $query)
    {
        $query
        ->leftJoin(KCTAppointmentZoomMapping::class, 'a.id', '=', 'kctazm.appointment_id','kctazm')
        ->select(['kctazm.start_url','kctazm.extra']);

    }

    /**
     * Add zoom data to upcoming appointment
     *
     * @param array $appointmentData
     * @param object $appointment
     * @return array
     */
    public function add_zoom_data_to_upcoming_appointment($appointmentData, $appointment)
    {
        $appointmentId = is_object($appointment) ? $appointment->id : $appointment;

        if (empty($appointmentData['zoom_data']) && class_exists(KCTAppointmentZoomMapping::class)) {
            $zoom_mapping = KCTAppointmentZoomMapping::query()
                ->where('appointmentId', absint($appointmentId))
                ->first();

            if ($zoom_mapping) {
                $appointmentData['zoom_data'] = $zoom_mapping->toArray();
            }
        }
        return $appointmentData;
    }

    /**
     * Check if appointment has video consultation (Zoom)
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

        // Check if Zoom mapping exists for this appointment
        $zoom_mapping = KCTAppointmentZoomMapping::query()
            ->where('appointmentId', absint($appointmentId))
            ->first();

        return $zoom_mapping !== null ? true : $default;
    }
}