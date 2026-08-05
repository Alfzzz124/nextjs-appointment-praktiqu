<?php
/**
 * Appointment writes — the hook-densest operation in KiviCare.
 *
 * `kc_after_create_appointment` alone has five listeners:
 *   - KCAppointmentNotificationListener::handleAppointmentBooked  (core + Pro)
 *   - KCPAppointmentControllerFilters::saveCustomFormData
 *   - KCPAppointmentControllerFilters::handleFollowupScheduling
 *   - KCPAppointmentControllerFilters::handleCustomFieldsCreate
 * and cancellation drives the cancellation email, telemed link teardown and
 * Pro's followup cancellation. A raw INSERT skips every one of them.
 *
 * This class delegates the row itself to KiviCare's own KCAppointment model rather
 * than writing SQL, because KCAppointment::save() derives the UTC columns
 * (appointment_start_utc / appointment_end_utc) from the local time + timezone. A
 * raw insert would leave them NULL and quietly break every UTC-based query.
 *
 * @package PraktiQU\Endpoint
 */

declare(strict_types=1);

namespace PraktiQU\Endpoint;

defined('ABSPATH') || exit;

final class Appointments
{
    /** Verified against KCAppointment.php:41-45. */
    private const STATUS_CANCELLED = 0;
    private const STATUS_PENDING   = 2;

    /** KiviCare's model class, present only while the plugin is active. */
    private const MODEL = '\App\models\KCAppointment';

    /**
     * Create an appointment.
     *
     * @param array<string,mixed> $params
     * @return array<string,mixed>|\WP_Error
     */
    public function create(array $params, \WP_REST_Request $request): array|\WP_Error
    {
        $guard = $this->require_kivicare();
        if (is_wp_error($guard)) {
            return $guard;
        }

        foreach (['clinic_id', 'doctor_id', 'patient_id', 'start_date', 'start_time'] as $required) {
            if (empty($params[$required])) {
                return new \WP_Error(
                    'praktiqu_missing_field',
                    sprintf('%s is required.', $required),
                    ['status' => 400]
                );
            }
        }

        $status = isset($params['status']) ? (int) $params['status'] : self::STATUS_PENDING;

        // KiviCare stores the booked service ids as a comma-separated string in
        // `visit_type` (AppointmentsController.php:3171). Keep that exact encoding —
        // its own readers split on commas.
        $service_ids = array_values(array_filter(array_map('absint', (array) ($params['service_ids'] ?? []))));

        $appointment_data = [
            'appointmentStartDate' => sanitize_text_field((string) $params['start_date']),
            'appointmentStartTime' => sanitize_text_field((string) $params['start_time']),
            'appointmentEndDate'   => sanitize_text_field((string) ($params['end_date'] ?? $params['start_date'])),
            'appointmentEndTime'   => sanitize_text_field((string) ($params['end_time'] ?? '')),
            'clinicId'             => (int) $params['clinic_id'],
            'doctorId'             => (int) $params['doctor_id'],
            'patientId'            => (int) $params['patient_id'],
            'description'          => sanitize_textarea_field((string) ($params['description'] ?? '')),
            'status'               => $status,
            'visitType'            => implode(',', $service_ids),
            'createdAt'            => current_time('mysql'),
            'appointmentReport'    => $params['appointment_report'] ?? null,
            'appointmentTimezone'  => sanitize_text_field((string) ($params['timezone'] ?? wp_timezone_string())),
        ];

        // Same extension point KiviCare offers, so site-specific customisations that
        // already hook this keep working for appointments we create.
        $appointment_data = apply_filters('kivicare_appointment_data', $appointment_data, $params);

        $model = self::MODEL;
        $appointment = $model::create($appointment_data);
        if (!$appointment) {
            return new \WP_Error('praktiqu_appointment_failed', 'Failed to create appointment.', ['status' => 500]);
        }

        $appointment_id = (int) ($appointment->id ?? $appointment);

        $this->write_service_mappings($appointment_id, $service_ids);

        // Only fires for a confirmed booking. A PENDING appointment is awaiting
        // payment, and KiviCare deliberately withholds the "booked" notification
        // until then (AppointmentsController.php:3349).
        if ($status !== self::STATUS_PENDING) {
            do_action('kc_after_create_appointment', $appointment_id, $appointment_data, $request);
        }

        return [
            'id'         => $appointment_id,
            'status'     => $status,
            'clinic_id'  => (int) $params['clinic_id'],
            'doctor_id'  => (int) $params['doctor_id'],
            'patient_id' => (int) $params['patient_id'],
            'start_date' => $appointment_data['appointmentStartDate'],
            'start_time' => $appointment_data['appointmentStartTime'],
            'timezone'   => $appointment_data['appointmentTimezone'],
            'service_ids' => $service_ids,
            'notified'   => $status !== self::STATUS_PENDING,
        ];
    }

    /**
     * Change an appointment's status. Cancellation is this with status = 0.
     *
     * @return array<string,mixed>|\WP_Error
     */
    public function set_status(int $appointment_id, int $status, \WP_REST_Request $request): array|\WP_Error
    {
        $guard = $this->require_kivicare();
        if (is_wp_error($guard)) {
            return $guard;
        }

        $model = self::MODEL;
        $appointment = $model::find($appointment_id);
        if (!$appointment) {
            return new \WP_Error('praktiqu_appointment_not_found', 'Appointment not found.', ['status' => 404]);
        }

        global $wpdb;
        $table = $wpdb->prefix . 'kc_appointments';
        $updated = $wpdb->update($table, ['status' => $status], ['id' => $appointment_id], ['%d'], ['%d']);

        if ($updated === false) {
            return new \WP_Error('praktiqu_status_update_failed', 'Failed to update status.', ['status' => 500]);
        }

        // Order matters: KiviCare fires the cancellation hook BEFORE the generic
        // status hook (AppointmentsController.php:3887-3891), and the cancellation
        // listener tears down telemed links the status listener may still read.
        if ($status === self::STATUS_CANCELLED) {
            do_action('kc_appointment_cancelled', $appointment_id);
        }
        do_action('kc_appointment_status_update', $appointment_id, $status, $appointment);

        return [
            'id'        => $appointment_id,
            'status'    => $status,
            'cancelled' => $status === self::STATUS_CANCELLED,
        ];
    }

    /**
     * Reschedule / edit an appointment.
     *
     * @param array<string,mixed> $params
     * @return array<string,mixed>|\WP_Error
     */
    public function update(int $appointment_id, array $params, \WP_REST_Request $request): array|\WP_Error
    {
        $guard = $this->require_kivicare();
        if (is_wp_error($guard)) {
            return $guard;
        }

        $model = self::MODEL;
        $appointment = $model::find($appointment_id);
        if (!$appointment) {
            return new \WP_Error('praktiqu_appointment_not_found', 'Appointment not found.', ['status' => 404]);
        }

        $column_for = [
            'start_date'  => 'appointment_start_date',
            'start_time'  => 'appointment_start_time',
            'end_date'    => 'appointment_end_date',
            'end_time'    => 'appointment_end_time',
            'description' => 'description',
            'timezone'    => 'appointment_timezone',
        ];

        $update_data = [];
        foreach ($column_for as $param => $column) {
            if (isset($params[$param])) {
                $update_data[$column] = sanitize_text_field((string) $params[$param]);
            }
        }

        if ($update_data === []) {
            return new \WP_Error('praktiqu_nothing_to_update', 'No updatable fields supplied.', ['status' => 400]);
        }

        global $wpdb;
        $table = $wpdb->prefix . 'kc_appointments';

        // Re-derive the UTC columns whenever local time or timezone moves, otherwise
        // they silently keep pointing at the old instant.
        if (isset($update_data['appointment_start_date']) || isset($update_data['appointment_start_time'])
            || isset($update_data['appointment_timezone'])) {
            $tz    = $update_data['appointment_timezone'] ?? $appointment->appointmentTimezone ?? 'UTC';
            $date  = $update_data['appointment_start_date'] ?? $appointment->appointmentStartDate;
            $time  = $update_data['appointment_start_time'] ?? $appointment->appointmentStartTime;
            $utc   = $this->to_utc((string) $date, (string) $time, (string) $tz);
            if ($utc !== null) {
                $update_data['appointment_start_utc'] = $utc;
            }
        }

        $result = $wpdb->update($table, $update_data, ['id' => $appointment_id]);
        if ($result === false) {
            return new \WP_Error('praktiqu_update_failed', 'Failed to update appointment.', ['status' => 500]);
        }

        do_action('kc_appointment_updated', $appointment_id, $update_data, $appointment, $request);

        return ['id' => $appointment_id, 'updated' => array_keys($update_data)];
    }

    /* -------------------------------------------------------------- */
    /* Internals                                                       */
    /* -------------------------------------------------------------- */

    /**
     * Appointment writes are meaningless without KiviCare: its model derives the UTC
     * columns and its listeners send the notifications. Fail loudly rather than
     * writing a half-formed row.
     */
    private function require_kivicare(): true|\WP_Error
    {
        if (!class_exists(self::MODEL)) {
            return new \WP_Error(
                'praktiqu_kivicare_inactive',
                'KiviCare is not active; refusing to write appointments directly.',
                ['status' => 503]
            );
        }
        return true;
    }

    private function to_utc(string $date, string $time, string $timezone): ?string
    {
        try {
            $dt = new \DateTime($date . ' ' . $time, new \DateTimeZone($timezone));
            $dt->setTimezone(new \DateTimeZone('UTC'));
            return $dt->format('Y-m-d H:i:s');
        } catch (\Exception $e) {
            // An unknown timezone must not abort the reschedule; the local columns
            // remain authoritative and KiviCare's backfill can repair the UTC ones.
            return null;
        }
    }

    /**
     * Mirror the booked services into wp_kc_appointment_service_mapping.
     * Replaces the existing set so a reschedule cannot leave orphans behind.
     *
     * @param int[] $service_ids
     */
    private function write_service_mappings(int $appointment_id, array $service_ids): void
    {
        global $wpdb;
        $table = $wpdb->prefix . 'kc_appointment_service_mapping';

        $wpdb->delete($table, ['appointment_id' => $appointment_id], ['%d']);

        foreach ($service_ids as $service_id) {
            $wpdb->insert($table, [
                'appointment_id' => $appointment_id,
                'service_id'     => $service_id,
                'status'         => 1,
                'created_at'     => current_time('mysql'),
            ], ['%d', '%d', '%d', '%s']);
        }
    }
}
