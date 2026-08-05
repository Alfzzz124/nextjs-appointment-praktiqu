<?php
/**
 * Doctor (professional) writes.
 *
 * A doctor is a `wp_users` row with the `kiviCare_doctor` capability — there is no
 * `professionals` table. Writing one directly would skip every listener KiviCare
 * registers on `kc_doctor_save`:
 *
 *   - KCDoctorNotificationListener::handleDoctorRegistered  — the welcome email
 *   - KCDoctorControllerFilters::handleDoctorSave           — KiviCare's bookkeeping
 *   - KCPDoctorControllerFilters::saveCustomFormData (Pro)  — custom field values
 *
 * Payload shape mirrors DoctorController.php:1378-1413 so those listeners receive what
 * they already expect.
 *
 * @package PraktiQU\Endpoint
 */

declare(strict_types=1);

namespace PraktiQU\Endpoint;

defined('ABSPATH') || exit;

final class Doctors
{
    private const ROLE = 'kiviCare_doctor';

    /**
     * Keys KiviCare packs into the `basic_data` usermeta blob for a doctor.
     * Mirrors KCDoctor.php:139-151 — note this differs from a patient's set.
     */
    private const BASIC_DATA_KEYS = [
        'mobile_number',
        'gender',
        'dob',
        'address',
        'city',
        'country',
        'postal_code',
        'qualifications',
        'no_of_experience',
        'specialties',
    ];

    /** PraktiQU-only attributes; KiviCare has no field for these. */
    private const PRAKTIQU_META = [
        'professional_type'    => 'praktiqu_professional_type',
        'registration_number'  => 'praktiqu_registration_number',
        'professional_status'  => 'praktiqu_professional_status',
    ];

    private const PROFESSIONAL_TYPES = ['PSIKOLOG_KLINIS', 'PSIKOLOG_ANAK', 'PSIKIATER', 'KONSELOR'];
    private const PROFESSIONAL_STATUSES = ['PENDING_ACTIVATION', 'ACTIVE', 'INACTIVE'];

    /**
     * @param array<string,mixed> $params
     * @return array<string,mixed>|\WP_Error
     */
    public function create(array $params, \WP_REST_Request $request): array|\WP_Error
    {
        $email = sanitize_email((string) ($params['email'] ?? ''));
        if ($email === '' || !is_email($email)) {
            return new \WP_Error('praktiqu_invalid_email', 'A valid email is required.', ['status' => 400]);
        }
        if (email_exists($email)) {
            return new \WP_Error('praktiqu_email_taken', 'That email is already registered.', ['status' => 409]);
        }

        $first_name = sanitize_text_field((string) ($params['first_name'] ?? ''));
        if ($first_name === '') {
            return new \WP_Error('praktiqu_missing_first_name', 'first_name is required.', ['status' => 400]);
        }

        $registration = sanitize_text_field((string) ($params['registration_number'] ?? ''));
        if ($registration === '') {
            return new \WP_Error('praktiqu_missing_registration', 'registration_number is required.', ['status' => 400]);
        }
        // Re-checked here as well as in the caller. wp_usermeta has no unique index on
        // (meta_key, meta_value), so uniqueness is check-then-write either way; doing it
        // at the last possible moment keeps the race window as small as it can be.
        if ($this->registration_number_taken($registration, 0)) {
            return new \WP_Error(
                'praktiqu_registration_taken',
                'That registration number is already in use.',
                ['status' => 409]
            );
        }

        $type = strtoupper(sanitize_text_field((string) ($params['professional_type'] ?? '')));
        if (!in_array($type, self::PROFESSIONAL_TYPES, true)) {
            return new \WP_Error(
                'praktiqu_invalid_type',
                'professional_type must be one of: ' . implode(', ', self::PROFESSIONAL_TYPES),
                ['status' => 400]
            );
        }

        $last_name = sanitize_text_field((string) ($params['last_name'] ?? ''));
        $password  = (string) ($params['password'] ?? wp_generate_password(12, true));

        $user_id = wp_insert_user([
            'user_login'   => $this->unique_username($email),
            'user_email'   => $email,
            'user_pass'    => $password,
            'first_name'   => $first_name,
            'last_name'    => $last_name,
            'display_name' => trim($first_name . ' ' . $last_name),
            'role'         => self::ROLE,
        ]);

        if (is_wp_error($user_id)) {
            return $user_id;
        }

        $user_id = (int) $user_id;
        (new \WP_User($user_id))->set_role(self::ROLE);

        $this->write_profile_meta($user_id, $params);
        $this->write_praktiqu_meta($user_id, $params, [
            'professional_type'   => $type,
            // A new professional is pending until explicitly activated.
            'professional_status' => 'PENDING_ACTIVATION',
            'registration_number' => $registration,
        ]);

        if (!empty($params['clinic_id'])) {
            $this->map_to_clinic($user_id, (int) $params['clinic_id']);
        }

        $doctor_data = $this->build_payload($user_id, $params, $password);

        do_action('kc_doctor_save', $doctor_data, $request);
        do_action('kc_doctor_register', $doctor_data);

        return $doctor_data;
    }

    /**
     * @param array<string,mixed> $params
     * @return array<string,mixed>|\WP_Error
     */
    public function update(int $user_id, array $params, \WP_REST_Request $request): array|\WP_Error
    {
        $user = get_user_by('id', $user_id);
        if (!$user instanceof \WP_User) {
            return new \WP_Error('praktiqu_doctor_not_found', 'Doctor not found.', ['status' => 404]);
        }
        if (!in_array(self::ROLE, (array) $user->roles, true)) {
            // Refuse to edit a patient or admin through the doctor endpoint.
            return new \WP_Error('praktiqu_not_a_doctor', 'That user is not a doctor.', ['status' => 404]);
        }

        $update = ['ID' => $user_id];

        if (isset($params['email'])) {
            $email = sanitize_email((string) $params['email']);
            if ($email === '' || !is_email($email)) {
                return new \WP_Error('praktiqu_invalid_email', 'A valid email is required.', ['status' => 400]);
            }
            $owner = email_exists($email);
            if ($owner && (int) $owner !== $user_id) {
                return new \WP_Error('praktiqu_email_taken', 'That email belongs to another user.', ['status' => 409]);
            }
            $update['user_email'] = $email;
        }

        if (isset($params['registration_number'])) {
            $registration = sanitize_text_field((string) $params['registration_number']);
            if ($registration === '') {
                return new \WP_Error('praktiqu_missing_registration', 'registration_number cannot be empty.', ['status' => 400]);
            }
            if ($this->registration_number_taken($registration, $user_id)) {
                return new \WP_Error(
                    'praktiqu_registration_taken',
                    'That registration number is already in use.',
                    ['status' => 409]
                );
            }
        }

        if (isset($params['professional_type'])) {
            $type = strtoupper(sanitize_text_field((string) $params['professional_type']));
            if (!in_array($type, self::PROFESSIONAL_TYPES, true)) {
                return new \WP_Error('praktiqu_invalid_type', 'Unknown professional_type.', ['status' => 400]);
            }
            $params['professional_type'] = $type;
        }

        if (isset($params['professional_status'])) {
            $status = strtoupper(sanitize_text_field((string) $params['professional_status']));
            if (!in_array($status, self::PROFESSIONAL_STATUSES, true)) {
                return new \WP_Error('praktiqu_invalid_status', 'Unknown professional_status.', ['status' => 400]);
            }
            $params['professional_status'] = $status;
        }

        foreach (['first_name', 'last_name'] as $key) {
            if (isset($params[$key])) {
                $update[$key] = sanitize_text_field((string) $params[$key]);
            }
        }
        if (isset($update['first_name']) || isset($update['last_name'])) {
            $first = $update['first_name'] ?? $user->first_name;
            $last  = $update['last_name'] ?? $user->last_name;
            $update['display_name'] = trim($first . ' ' . $last);
        }

        if (count($update) > 1) {
            $result = wp_update_user($update);
            if (is_wp_error($result)) {
                return $result;
            }
        }

        $this->write_profile_meta($user_id, $params, true);
        $this->write_praktiqu_meta($user_id, $params);

        if (!empty($params['clinic_id'])) {
            $this->map_to_clinic($user_id, (int) $params['clinic_id']);
        }

        $doctor_data = $this->build_payload($user_id, $params, null);

        // KiviCare passes only the id here (DoctorController.php:1716); matched so
        // listeners written against it keep working.
        do_action('kc_doctor_update', ['id' => $user_id], $request);

        return $doctor_data;
    }

    /* -------------------------------------------------------------- */
    /* Internals                                                       */
    /* -------------------------------------------------------------- */

    /**
     * Is this registration number held by someone other than `$exclude_user_id`?
     *
     * A direct wp_usermeta query rather than get_users(meta_query) — the latter is
     * filtered by role and would miss a collision against a non-doctor row.
     */
    private function registration_number_taken(string $registration, int $exclude_user_id): bool
    {
        global $wpdb;

        $owner = $wpdb->get_var($wpdb->prepare(
            "SELECT user_id FROM {$wpdb->usermeta}
              WHERE meta_key = %s AND meta_value = %s AND user_id <> %d
              LIMIT 1",
            self::PRAKTIQU_META['registration_number'],
            $registration,
            $exclude_user_id
        ));

        return $owner !== null;
    }

    /**
     * Merge profile fields into `basic_data`.
     *
     * On update we merge, so a partial request cannot blank fields the caller never
     * mentioned. `qualifications` and `specialties` are arrays; KiviCare writes `''`
     * when unset, and that is preserved rather than normalised to `[]` so a record we
     * write stays indistinguishable from one KiviCare wrote.
     *
     * @param array<string,mixed> $params
     */
    private function write_profile_meta(int $user_id, array $params, bool $merge = false): void
    {
        $existing = [];
        if ($merge) {
            $raw = get_user_meta($user_id, 'basic_data', true);
            if (is_string($raw) && $raw !== '') {
                $decoded = json_decode($raw, true);
                if (is_array($decoded)) {
                    $existing = $decoded;
                }
            }
        }

        $basic = $existing;
        foreach (self::BASIC_DATA_KEYS as $key) {
            // `contact_number` is the request-facing name for `mobile_number`;
            // `experience` for `no_of_experience`.
            $source = match ($key) {
                'mobile_number'    => 'contact_number',
                'no_of_experience' => 'experience',
                default            => $key,
            };

            if (!array_key_exists($source, $params)) {
                if (!$merge) {
                    $basic[$key] = in_array($key, ['qualifications', 'specialties'], true) ? [] : '';
                }
                continue;
            }

            $value = $params[$source];
            $basic[$key] = in_array($key, ['qualifications', 'specialties'], true)
                ? array_values(array_map('sanitize_text_field', (array) $value))
                : sanitize_text_field((string) $value);
        }

        update_user_meta($user_id, 'basic_data', wp_json_encode($basic, JSON_UNESCAPED_UNICODE));

        if (array_key_exists('description', $params)) {
            update_user_meta($user_id, 'doctor_description', sanitize_textarea_field((string) $params['description']));
        }
        if (!empty($params['timezone'])) {
            update_user_meta($user_id, 'timezone', sanitize_text_field((string) $params['timezone']));
        }
        if (!empty($params['profile_image'])) {
            update_user_meta($user_id, 'doctor_profile_image', (int) $params['profile_image']);
        }
    }

    /**
     * @param array<string,mixed> $params
     * @param array<string,string> $forced values that override the request
     */
    private function write_praktiqu_meta(int $user_id, array $params, array $forced = []): void
    {
        foreach (self::PRAKTIQU_META as $param => $meta_key) {
            if (array_key_exists($param, $forced)) {
                update_user_meta($user_id, $meta_key, $forced[$param]);
                continue;
            }
            if (array_key_exists($param, $params) && $params[$param] !== null) {
                update_user_meta($user_id, $meta_key, sanitize_text_field((string) $params[$param]));
            }
        }
    }

    /** Idempotent: the mapping table has no unique constraint. */
    private function map_to_clinic(int $user_id, int $clinic_id): void
    {
        global $wpdb;
        $table = $wpdb->prefix . 'kc_doctor_clinic_mappings';

        $exists = $wpdb->get_var($wpdb->prepare(
            "SELECT id FROM {$table} WHERE doctor_id = %d AND clinic_id = %d LIMIT 1",
            $user_id,
            $clinic_id
        ));
        if ($exists) {
            return;
        }

        $wpdb->insert($table, [
            'doctor_id'  => $user_id,
            'clinic_id'  => $clinic_id,
            'created_at' => current_time('mysql'),
        ], ['%d', '%d', '%s']);
    }

    private function unique_username(string $email): string
    {
        $base = sanitize_user((string) strstr($email, '@', true), true) ?: 'doctor';
        $candidate = $base;
        $suffix = 1;
        while (username_exists($candidate)) {
            $candidate = $base . $suffix;
            $suffix++;
        }
        return $candidate;
    }

    /**
     * Mirrors DoctorController.php:1378-1404 so existing hook listeners get the shape
     * they expect.
     *
     * @param array<string,mixed> $params
     * @return array<string,mixed>
     */
    private function build_payload(int $user_id, array $params, ?string $temp_password): array
    {
        $user  = new \WP_User($user_id);
        $raw   = get_user_meta($user_id, 'basic_data', true);
        $basic = is_string($raw) && $raw !== '' ? (json_decode($raw, true) ?: []) : [];
        $image = (int) get_user_meta($user_id, 'doctor_profile_image', true);

        return [
            'user_id'             => $user_id,
            'first_name'          => $user->first_name,
            'last_name'           => $user->last_name,
            'email'               => $user->user_email,
            'username'            => $user->user_login,
            'temp_password'       => $temp_password,
            'contact_number'      => $basic['mobile_number'] ?? '',
            'dob'                 => $basic['dob'] ?? '',
            'gender'              => $basic['gender'] ?? '',
            'experience'          => $basic['no_of_experience'] ?? '',
            'description'         => get_user_meta($user_id, 'doctor_description', true) ?: '',
            'address'             => $basic['address'] ?? '',
            'city'                => $basic['city'] ?? '',
            'country'             => $basic['country'] ?? '',
            'postal_code'         => $basic['postal_code'] ?? '',
            'qualifications'      => $basic['qualifications'] ?? [],
            'specialties'         => $basic['specialties'] ?? [],
            'doctor_image_url'    => $image ? wp_get_attachment_url($image) : '',
            'clinics'             => isset($params['clinic_id']) ? (int) $params['clinic_id'] : null,
            'created_at'          => current_time('mysql'),
            'timezone'            => get_user_meta($user_id, 'timezone', true) ?: null,
            // PraktiQU-only, echoed back so the caller need not re-read.
            'professional_type'   => get_user_meta($user_id, self::PRAKTIQU_META['professional_type'], true) ?: null,
            'registration_number' => get_user_meta($user_id, self::PRAKTIQU_META['registration_number'], true) ?: null,
            'professional_status' => get_user_meta($user_id, self::PRAKTIQU_META['professional_status'], true) ?: null,
        ];
    }
}
