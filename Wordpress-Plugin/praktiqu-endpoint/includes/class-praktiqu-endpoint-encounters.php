<?php
/**
 * Encounter writes — the clinical record of one session.
 *
 * An encounter is KiviCare's container for what happened during an appointment. Its
 * children (medical history entries, prescriptions) live in ClinicalRecords.
 *
 * Two hooks fire on the way through, matching EncounterController.php:913 and :1031:
 *   - kc_encounter_save   (['id' => n])
 *   - kc_encounter_update (['id' => n])
 *
 * A third, `kc_encounter_closed`, is the interesting one. KiviCare registers a listener
 * for it (KCEncounterNotificationListener.php:40) that mails the patient their notes and
 * prescription — but **no code anywhere in KiviCare or KiviCare Pro ever fires it.** The
 * listener has been waiting for an action nobody triggers. This class fires it on close,
 * with the payload that listener actually reads, which is what finally makes the
 * notification work.
 *
 * @package PraktiQU\Endpoint
 */

declare(strict_types=1);

namespace PraktiQU\Endpoint;

defined('ABSPATH') || exit;

final class Encounters
{
    /** KiviCare encounter status. Verified against EncounterController.php:897. */
    public const STATUS_CLOSED = 0;
    public const STATUS_OPEN   = 1;

    /** KiviCare's model class, present only while the plugin is active. */
    private const MODEL = '\App\models\KCPatientEncounter';

    private ClinicalRecords $records;

    public function __construct(ClinicalRecords $records)
    {
        $this->records = $records;
    }

    /**
     * Create an encounter.
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

        foreach (['clinic_id', 'doctor_id', 'patient_id'] as $required) {
            if (empty($params[$required])) {
                return new \WP_Error(
                    'praktiqu_missing_field',
                    sprintf('%s is required.', $required),
                    ['status' => 400]
                );
            }
        }

        $added_by = (int) ($params['added_by'] ?? 0);
        if ($added_by <= 0) {
            // No logged-in user on a service-token request, so the caller must say who
            // authored this. Falling back to get_current_user_id() would record 0 and
            // lose the clinician on every encounter we create.
            $added_by = (int) $params['doctor_id'];
        }

        $model = self::MODEL;
        $encounter = $model::create([
            'encounterDate' => sanitize_text_field((string) ($params['encounter_date'] ?? current_time('Y-m-d'))),
            'clinicId'      => (int) $params['clinic_id'],
            'doctorId'      => (int) $params['doctor_id'],
            'patientId'     => (int) $params['patient_id'],
            'appointmentId' => (int) ($params['appointment_id'] ?? 0),
            'description'   => sanitize_textarea_field((string) ($params['description'] ?? '')),
            'status'        => isset($params['status']) ? (int) $params['status'] : self::STATUS_OPEN,
            'addedBy'       => $added_by,
            'createdAt'     => current_time('mysql', true),
            'templateId'    => isset($params['template_id']) ? (int) $params['template_id'] : null,
        ]);

        if (!$encounter) {
            return new \WP_Error('praktiqu_encounter_failed', 'Failed to create encounter.', ['status' => 500]);
        }

        $encounter_id = (int) ($encounter->id ?? $encounter);

        do_action('kc_encounter_save', ['id' => $encounter_id]);

        return [
            'id'             => $encounter_id,
            'clinic_id'      => (int) $params['clinic_id'],
            'doctor_id'      => (int) $params['doctor_id'],
            'patient_id'     => (int) $params['patient_id'],
            'appointment_id' => (int) ($params['appointment_id'] ?? 0),
            'status'         => isset($params['status']) ? (int) $params['status'] : self::STATUS_OPEN,
        ];
    }

    /**
     * Edit an encounter's own fields. Children are replaced through ClinicalRecords.
     *
     * @param array<string,mixed> $params
     * @return array<string,mixed>|\WP_Error
     */
    public function update(int $encounter_id, array $params, \WP_REST_Request $request): array|\WP_Error
    {
        $guard = $this->require_kivicare();
        if (is_wp_error($guard)) {
            return $guard;
        }

        $existing = $this->find_row($encounter_id);
        if ($existing === null) {
            return new \WP_Error('praktiqu_encounter_not_found', 'Encounter not found.', ['status' => 404]);
        }

        $column_for = [
            'description'    => 'description',
            'encounter_date' => 'encounter_date',
        ];

        $update_data = [];
        foreach ($column_for as $param => $column) {
            if (isset($params[$param])) {
                $update_data[$column] = sanitize_textarea_field((string) $params[$param]);
            }
        }

        if ($update_data === []) {
            return new \WP_Error('praktiqu_nothing_to_update', 'No updatable fields supplied.', ['status' => 400]);
        }

        global $wpdb;
        $result = $wpdb->update($wpdb->prefix . 'kc_patient_encounters', $update_data, ['id' => $encounter_id]);
        if ($result === false) {
            return new \WP_Error('praktiqu_update_failed', 'Failed to update encounter.', ['status' => 500]);
        }

        do_action('kc_encounter_update', ['id' => $encounter_id]);

        return ['id' => $encounter_id, 'updated' => array_keys($update_data)];
    }

    /**
     * Open or close an encounter.
     *
     * Closing is what drives the patient notification — see the class docblock on why
     * that hook has never fired before.
     *
     * @return array<string,mixed>|\WP_Error
     */
    public function set_status(int $encounter_id, int $status, \WP_REST_Request $request): array|\WP_Error
    {
        $guard = $this->require_kivicare();
        if (is_wp_error($guard)) {
            return $guard;
        }

        $encounter = $this->find_row($encounter_id);
        if ($encounter === null) {
            return new \WP_Error('praktiqu_encounter_not_found', 'Encounter not found.', ['status' => 404]);
        }

        global $wpdb;
        $updated = $wpdb->update(
            $wpdb->prefix . 'kc_patient_encounters',
            ['status' => $status],
            ['id' => $encounter_id],
            ['%d'],
            ['%d']
        );

        if ($updated === false) {
            return new \WP_Error('praktiqu_status_update_failed', 'Failed to update status.', ['status' => 500]);
        }

        $notified = false;
        if ($status === self::STATUS_CLOSED) {
            $notified = $this->fire_closed($encounter_id, $encounter);
        }

        return [
            'id'       => $encounter_id,
            'status'   => $status,
            'closed'   => $status === self::STATUS_CLOSED,
            'notified' => $notified,
        ];
    }

    /* -------------------------------------------------------------- */
    /* Internals                                                       */
    /* -------------------------------------------------------------- */

    /**
     * Fire `kc_encounter_closed` with the payload its listener actually reads:
     * appointment_id (required — it bails without one), prescription, notes,
     * clinic_name. Everything else it resolves from the appointment itself.
     *
     * Returns whether the hook was fired at all. An encounter with no appointment
     * cannot notify anyone, because the listener resolves the patient through it.
     */
    private function fire_closed(int $encounter_id, object $encounter): bool
    {
        $appointment_id = (int) ($encounter->appointment_id ?? 0);
        if ($appointment_id <= 0) {
            return false;
        }

        do_action('kc_encounter_closed', [
            'appointment_id' => $appointment_id,
            'encounter_id'   => $encounter_id,
            'notes'          => $this->records->notes_text($encounter_id),
            'prescription'   => $this->records->prescription_text($encounter_id),
            'clinic_name'    => $this->clinic_name((int) ($encounter->clinic_id ?? 0)),
        ]);

        return true;
    }

    private function clinic_name(int $clinic_id): string
    {
        if ($clinic_id <= 0) {
            return '';
        }
        global $wpdb;
        $name = $wpdb->get_var(
            $wpdb->prepare("SELECT name FROM {$wpdb->prefix}kc_clinics WHERE id = %d LIMIT 1", $clinic_id)
        );
        return is_string($name) ? $name : '';
    }

    /**
     * Read the raw row. KCPatientEncounter::find returns the model's own shape, which
     * varies by KiviCare version; the columns are what this class needs.
     */
    private function find_row(int $encounter_id): ?object
    {
        global $wpdb;
        $row = $wpdb->get_row(
            $wpdb->prepare(
                "SELECT id, clinic_id, doctor_id, patient_id, appointment_id, status
                   FROM {$wpdb->prefix}kc_patient_encounters WHERE id = %d LIMIT 1",
                $encounter_id
            )
        );
        return $row ?: null;
    }

    /**
     * Encounter writes are meaningless without KiviCare: its model owns the row shape
     * and its listeners send the notifications. Fail loudly rather than writing a
     * half-formed row.
     */
    private function require_kivicare(): true|\WP_Error
    {
        if (!class_exists(self::MODEL)) {
            return new \WP_Error(
                'praktiqu_kivicare_inactive',
                'KiviCare is not active; refusing to write encounters directly.',
                ['status' => 503]
            );
        }
        return true;
    }
}
