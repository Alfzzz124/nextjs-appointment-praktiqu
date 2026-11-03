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
    private const STATUS_BOOKED    = 1;
    private const STATUS_PENDING   = 2;

    /** KiviCare's model class, present only while the plugin is active. */
    private const MODEL = '\App\models\KCAppointment';

    /**
     * How each way Schedule_Write refuses becomes an answer. Every one of them wrote nothing.
     * Statuses are the contract the Next.js app maps from (see rescheduleAppointment).
     */
    private const SCHEDULE_ERRORS = [
        'schedule_conflict' => ['praktiqu_schedule_conflict', 'That slot is already booked.', 409],
        'schedule_stale' => ['praktiqu_schedule_stale', 'The appointment changed since it was read.', 409],
        'schedule_terminal' => ['praktiqu_schedule_terminal', 'Only a booked or pending appointment can be moved.', 409],
        'schedule_unchanged' => ['praktiqu_schedule_unchanged', 'The appointment is already at that time.', 400],
        'schedule_invalid' => ['praktiqu_schedule_invalid', 'That date or time is not valid.', 400],
        'schedule_unavailable' => ['praktiqu_schedule_unavailable', 'That time has passed or crosses midnight.', 422],
        // The lock is held by another booking or a reschedule.
        'schedule_busy' => ['praktiqu_schedule_busy', 'The schedule is busy, try again.', 503],
        'schedule_db_error' => ['praktiqu_schedule_db_error', 'Could not check the slot.', 500],
        'schedule_requires_innodb' => ['praktiqu_schedule_db_error', 'Could not check the slot.', 500],
        'schedule_transaction_failed' => ['praktiqu_schedule_db_error', 'Could not check the slot.', 500],
        'schedule_outbox_failed' => ['praktiqu_schedule_db_error', 'Could not check the slot.', 500],
    ];

    /**
     * @param object|null $sync the external steps of a move: calendar(), reminders() and
     *                          meeting_url(), as Schedule_Sync has them. Tests pass a double.
     */
    public function __construct(private ?object $sync = null)
    {
    }

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

        // The slot is checked here, under the professional's schedule lock, and not only in
        // the backend: that check runs a request earlier, so two bookings for one slot
        // could both pass it. Schedule_Write::move() takes the same lock, so a booking and
        // a reschedule cannot land on one slot either. Checked on the filtered data,
        // because that is what gets written.
        $holds_slot = in_array((int) $appointment_data['status'], Schedule_Write::ACTIVE_STATUSES, true);
        if ($holds_slot && $appointment_data['appointmentEndTime'] === '') {
            return new \WP_Error('praktiqu_missing_field', 'end_time is required.', ['status' => 400]);
        }

        $model = self::MODEL;
        global $wpdb;
        $schedule = new Schedule_Write($wpdb);
        try {
            $appointment = !$holds_slot
                ? $model::create($appointment_data)
                : $schedule->locked((int) $appointment_data['doctorId'], static function () use ($schedule, $model, $appointment_data) {
                    $schedule->assertFree(
                        (int) $appointment_data['doctorId'],
                        (string) $appointment_data['appointmentStartDate'],
                        (string) $appointment_data['appointmentStartTime'],
                        (string) $appointment_data['appointmentEndTime']
                    );

                    return $model::create($appointment_data);
                });
        } catch (\RuntimeException $e) {
            return $this->schedule_error($e);
        }
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
     * A move from PENDING to BOOKED that carries `payment` is a public booking being paid,
     * and fires `kc_appointment_payment_completed` — the hook KiviCare's own
     * KCAppointmentPaymentService::confirmPayment fires. Besides `kc_after_create_appointment`,
     * which create() skips for PENDING, it is the only hook the booking emails to patient,
     * doctor and clinic listen on; `kc_appointment_status_update` reaches nothing but the
     * check-in/check-out mail. Without `payment` (a staff approval) the move fires no
     * payment hook, because KiviCare's listener would also mail "payment processed".
     *
     * confirmPayment itself is not called. Its "already confirmed" guard is a read, so two
     * confirmations racing past it would both send the emails; it writes a
     * wp_kc_payments_appointment_mappings row nothing on our side keeps up to date; and its
     * telemed and Google Calendar steps are ones create() does not take for staff
     * bookings either.
     *
     * `expect_status` (1.8.4) makes the write a compare-and-set: the row moves only if it
     * still has that status. PraktiQU's psychologist approval sends it, so an approval
     * whose call lands after a cancellation answers 409 `praktiqu_status_conflict` instead
     * of rewriting CANCELLED as BOOKED. A row already at the requested status is the
     * repeat of a call whose answer was lost: 200 with `claimed: false`, and no hook fires
     * again. Without `expect_status` nothing changes.
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

        $payment = $status === self::STATUS_BOOKED ? $this->payment_data($request) : null;

        $expect = $request->get_param('expect_status');
        if ($expect !== null) {
            $expect = (int) $expect;
            $claimed = $wpdb->query($wpdb->prepare(
                "UPDATE {$table} SET status = %d WHERE id = %d AND status = %d",
                $status,
                $appointment_id,
                $expect
            ));
            if ($claimed === false) {
                return new \WP_Error('praktiqu_status_update_failed', 'Failed to update status.', ['status' => 500]);
            }
            if ((int) $claimed !== 1) {
                $current = $wpdb->get_var($wpdb->prepare(
                    "SELECT status FROM {$table} WHERE id = %d",
                    $appointment_id
                ));
                if ($current === null) {
                    return new \WP_Error('praktiqu_appointment_not_found', 'Appointment not found.', ['status' => 404]);
                }
                $current = (int) $current;
                if ($current !== $status) {
                    return new \WP_Error(
                        'praktiqu_status_conflict',
                        sprintf('Appointment status is %d, not %d.', $current, $expect),
                        ['status' => 409, 'current_status' => $current]
                    );
                }
                return [
                    'id'                => $appointment_id,
                    'status'            => $status,
                    'cancelled'         => $status === self::STATUS_CANCELLED,
                    'payment_confirmed' => false,
                    'claimed'           => false,
                ];
            }
            $paid_now = $payment !== null && $expect === self::STATUS_PENDING;
            return $this->after_status_write($appointment_id, $status, $appointment, $payment, $paid_now) + ['claimed' => true];
        }

        // Claimed with a conditional UPDATE, not by reading $appointment->status: the
        // payment webhook and the client's status poll can confirm the same order at
        // once, and only the request whose UPDATE moves the row off PENDING may mail.
        $paid_now = false;
        if ($payment !== null) {
            $claimed = $wpdb->query($wpdb->prepare(
                "UPDATE {$table} SET status = %d WHERE id = %d AND status = %d",
                self::STATUS_BOOKED,
                $appointment_id,
                self::STATUS_PENDING
            ));
            if ($claimed === false) {
                return new \WP_Error('praktiqu_status_update_failed', 'Failed to update status.', ['status' => 500]);
            }
            $paid_now = (int) $claimed === 1;
        }

        if (!$paid_now) {
            $updated = $wpdb->update($table, ['status' => $status], ['id' => $appointment_id], ['%d'], ['%d']);

            if ($updated === false) {
                return new \WP_Error('praktiqu_status_update_failed', 'Failed to update status.', ['status' => 500]);
            }
        }

        return $this->after_status_write($appointment_id, $status, $appointment, $payment, $paid_now);
    }

    /**
     * The hooks a committed status write fires, and the answer. $paid_now: this request's
     * own UPDATE moved the row PENDING → BOOKED with a payment.
     *
     * @param array<string,string>|null $payment
     * @return array<string,mixed>
     */
    private function after_status_write(int $appointment_id, int $status, object $appointment, ?array $payment, bool $paid_now): array
    {
        // Order matters: KiviCare fires the cancellation hook BEFORE the generic
        // status hook (AppointmentsController.php:3887-3891), and the cancellation
        // listener tears down telemed links the status listener may still read.
        if ($status === self::STATUS_CANCELLED) {
            do_action('kc_appointment_cancelled', $appointment_id);
        }
        do_action('kc_appointment_status_update', $appointment_id, $status, $appointment);

        if ($paid_now) {
            // The status is committed and the claim cannot match again, so a listener
            // that throws must not turn this into a 500: Next.js would stop before
            // scheduling the session reminders, and no retry could ever send the mail.
            try {
                do_action('kc_appointment_payment_completed', $appointment_id, $payment);
            } catch (\Throwable $e) {
                error_log(sprintf(
                    '[praktiqu-endpoint] kc_appointment_payment_completed failed for appointment %d: %s',
                    $appointment_id,
                    $e->getMessage()
                ));
            }
        }

        return [
            'id'                => $appointment_id,
            'status'            => $status,
            'cancelled'         => $status === self::STATUS_CANCELLED,
            'payment_confirmed' => $paid_now,
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

    /**
     * Move an appointment to a new slot: Schedule_Write::move() under the professional's
     * lock, then its outbox row at once (Meet/Zoom, Google Calendar, KiviCare reminders).
     *
     * Whether the slot is a bookable one — working hours, closures, the service's length —
     * is the Next.js app's to check, as for create(). What only this side can guarantee,
     * under the lock, is that the slot is free and the row is still the one the caller saw
     * (`expected`). The session keeps its length.
     *
     * A failed external step does not fail the move: the schedule has changed, the answer
     * says so in `sync`, and the outbox sweep retries the row.
     *
     * @param array<string,mixed> $params start_date, start_time, actor, request_id, and
     *        expected{doctor_id, clinic_id, status, start_date, start_time, end_date, end_time}
     * @return array<string,mixed>|\WP_Error
     */
    public function reschedule(int $appointment_id, array $params): array|\WP_Error
    {
        $guard = $this->require_kivicare();
        if (is_wp_error($guard)) {
            return $guard;
        }
        foreach (['start_date', 'start_time'] as $required) {
            if (empty($params[$required])) {
                return new \WP_Error('praktiqu_missing_field', sprintf('%s is required.', $required), ['status' => 400]);
            }
        }

        global $wpdb;
        $exists = $wpdb->get_var($wpdb->prepare("SELECT id FROM {$wpdb->prefix}kc_appointments WHERE id = %d", $appointment_id));
        if ((string) $wpdb->last_error !== '') {
            return new \WP_Error('praktiqu_schedule_db_error', 'Could not check the slot.', ['status' => 500]);
        }
        if (!$exists) {
            return new \WP_Error('praktiqu_appointment_not_found', 'Appointment not found.', ['status' => 404]);
        }

        // The caller's view of the row, in the row's own column names and time format, so
        // "09:00" from the app compares equal to the stored "09:00:00".
        $expected = (array) ($params['expected'] ?? []);
        $seen = [
            'doctor_id' => $expected['doctor_id'] ?? null,
            'clinic_id' => $expected['clinic_id'] ?? null,
            'status' => $expected['status'] ?? null,
            'appointment_start_date' => $expected['start_date'] ?? null,
            'appointment_start_time' => self::with_seconds((string) ($expected['start_time'] ?? '')),
            'appointment_end_date' => $expected['end_date'] ?? null,
            'appointment_end_time' => self::with_seconds((string) ($expected['end_time'] ?? '')),
        ];

        try {
            $moved = (new Schedule_Write($wpdb))->move(
                $appointment_id,
                $seen,
                sanitize_text_field((string) $params['start_date']),
                self::with_seconds(sanitize_text_field((string) $params['start_time'])),
                sanitize_text_field((string) ($params['actor'] ?? 'unknown')),
                sanitize_text_field((string) ($params['request_id'] ?? '')),
                static fn (): bool => true
            );
        } catch (\RuntimeException $e) {
            return $this->schedule_error($e);
        }

        $this->sync ??= new Schedule_Sync();
        $sync = ['outbox_id' => (int) $moved['outbox_id'], 'ok' => false];
        try {
            $processed = (new Schedule_Outbox_Processor(
                $wpdb,
                \Closure::fromCallable([$this->sync, 'calendar']),
                \Closure::fromCallable([$this->sync, 'reminders'])
            ))->process((int) $moved['outbox_id']);
            $sync['ok'] = $processed['ok'];
            if (!$processed['ok']) {
                $sync['error'] = (string) ($processed['error'] ?? 'unknown');
            }
            // A Meet update can issue a new link; the app mails whichever is current.
            $sync['meeting_url'] = $this->sync->meeting_url($appointment_id);
        } catch (\Throwable $e) {
            $sync['error'] = $e->getMessage();
        }

        return [
            'id' => $appointment_id,
            'start_date' => $moved['appointment_start_date'],
            'start_time' => $moved['appointment_start_time'],
            'end_date' => $moved['appointment_end_date'],
            'end_time' => $moved['appointment_end_time'],
            'previous' => [
                'start_date' => $seen['appointment_start_date'],
                'start_time' => $seen['appointment_start_time'],
                'end_time' => $seen['appointment_end_time'],
            ],
            'sync' => $sync,
        ];
    }

    /* -------------------------------------------------------------- */
    /* Internals                                                       */
    /* -------------------------------------------------------------- */

    private function schedule_error(\RuntimeException $e): \WP_Error
    {
        $known = self::SCHEDULE_ERRORS[$e->getMessage()] ?? null;
        if ($known === null) {
            throw $e;
        }

        return new \WP_Error($known[0], $known[1], ['status' => $known[2]]);
    }

    /** "09:00" → "09:00:00"; anything else is left for Schedule_Write to judge. */
    private static function with_seconds(string $time): string
    {
        return preg_match('/^\d{2}:\d{2}$/', $time) ? $time . ':00' : $time;
    }

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

    /**
     * The payment a status request says it confirms, in the shape KiviCare's gateways
     * hand to `kc_appointment_payment_completed` (transaction_id, payment_id), or null
     * when the request carries none.
     *
     * @return array<string,string>|null
     */
    private function payment_data(\WP_REST_Request $request): ?array
    {
        $payment = $request->get_param('payment');
        if (!is_array($payment)) {
            return null;
        }

        return [
            'gateway'        => sanitize_text_field((string) ($payment['gateway'] ?? '')),
            'transaction_id' => sanitize_text_field((string) ($payment['transaction_id'] ?? '')),
            'payment_id'     => (string) absint($payment['wc_order_id'] ?? 0),
            'payment_status' => 'completed',
        ];
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
