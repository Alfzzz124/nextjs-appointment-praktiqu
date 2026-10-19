<?php
/**
 * Patient writes — the reason this plugin owns the write path at all.
 *
 * PraktiQU reads patients directly from wp_users + wp_usermeta (fast, and consistent
 * with the billing services), but it must NOT write them directly. A patient created
 * with raw SQL skips every listener KiviCare registers on `kc_patient_save`:
 *
 *   - KCPatientNotificationListener::handlePatientRegistered  — the welcome email
 *   - KCPatientControllerFilters::handlePatientSave           — KiviCare's own bookkeeping
 *   - KCPPatientControllerFilters::saveCustomFormData (Pro)   — custom field values
 *
 * So this class delegates to KiviCare's own KCPatient model when the plugin is
 * active, and fires the same hooks with the same payload shape KiviCare uses
 * (PatientController.php:1308-1337).
 *
 * @package PraktiQU\Endpoint
 */

declare(strict_types=1);

namespace PraktiQU\Endpoint;

defined('ABSPATH') || exit;

final class Patients
{
    /** KiviCare's patient role slug — KIVI_CARE_PREFIX . 'patient'. */
    private const ROLE = 'kiviCare_patient';

    /**
     * Site roles an existing account may hold and still be made a patient by
     * create() with `adopt_existing` — see adopt(). Ordinary sign-ups only.
     */
    private const ADOPTABLE_ROLES = ['customer', 'subscriber'];

    /**
     * Fields KiviCare packs into the `basic_data` usermeta JSON blob.
     * Order and keys mirror KCPatient::save (KCPatient.php:128-137) so a record we
     * write is indistinguishable from one KiviCare wrote.
     */
    private const BASIC_DATA_KEYS = [
        'mobile_number',
        'gender',
        'dob',
        'address',
        'city',
        'country',
        'postal_code',
        'blood_group',
    ];

    /**
     * Create a patient.
     *
     * @param array<string,mixed> $params
     * @return array<string,mixed>|\WP_Error
     */
    public function create(array $params, \WP_REST_Request $request): array|\WP_Error
    {
        $email = sanitize_email((string) ($params['email'] ?? ''));
        if ($email === '' || !is_email($email)) {
            return new \WP_Error('praktiqu_invalid_email', 'A valid email is required.', ['status' => 400]);
        }
        $owner = email_exists($email);
        if ($owner) {
            if (!empty($params['adopt_existing'])) {
                return $this->adopt((int) $owner, $params, $request);
            }
            return new \WP_Error('praktiqu_email_taken', 'That email is already registered.', ['status' => 409]);
        }

        $first_name = sanitize_text_field((string) ($params['first_name'] ?? ''));
        $last_name  = sanitize_text_field((string) ($params['last_name'] ?? ''));
        if ($first_name === '') {
            return new \WP_Error('praktiqu_missing_first_name', 'first_name is required.', ['status' => 400]);
        }

        // A username collision is likelier than an email one, since we derive it.
        $username = $this->unique_username($email);
        $password = (string) ($params['password'] ?? wp_generate_password(12, true));

        $user_id = wp_insert_user([
            'user_login'   => $username,
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

        // wp_insert_user's `role` already applies it, but KiviCare reads the
        // capability directly — set it explicitly so the row is never ambiguous.
        $user = new \WP_User($user_id);
        $user->set_role(self::ROLE);

        update_user_meta($user_id, 'patient_added_by', get_current_user_id());
        $this->write_profile_meta($user_id, $params);

        if (!empty($params['clinic_id'])) {
            $this->map_to_clinic($user_id, (int) $params['clinic_id']);
        }

        $patient_data = $this->build_payload($user_id, $params, $password);

        // Same hooks, same payload shape, same order as PatientController.php:1334-1337.
        do_action('kc_patient_save', $patient_data, $request);
        do_action('kivicare_patient_registered', $patient_data);

        return $patient_data;
    }

    /**
     * Update a patient.
     *
     * @param array<string,mixed> $params
     * @return array<string,mixed>|\WP_Error
     */
    public function update(int $user_id, array $params, \WP_REST_Request $request): array|\WP_Error
    {
        $user = get_user_by('id', $user_id);
        if (!$user instanceof \WP_User) {
            return new \WP_Error('praktiqu_patient_not_found', 'Patient not found.', ['status' => 404]);
        }
        if (!in_array(self::ROLE, (array) $user->roles, true)) {
            // Refuse to edit a doctor or admin through the patient endpoint.
            return new \WP_Error('praktiqu_not_a_patient', 'That user is not a patient.', ['status' => 404]);
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

        if (!empty($params['clinic_id'])) {
            $this->map_to_clinic($user_id, (int) $params['clinic_id']);
        }

        $patient_data = $this->build_payload($user_id, $params, null);

        do_action('kc_patient_update', $patient_data, $request);

        return $patient_data;
    }

    /**
     * Turn an existing ordinary account into a patient, for create() with `adopt_existing`.
     *
     * Seen in production (2026-10-19): clients who signed up through WooCommerce hold
     * only the `customer` role. The booking path looks patients up by role, finds none,
     * tries a create, and gets 409 — so neither the client nor clinic staff could ever
     * book that address. The account is theirs, so the patient role is ADDED to it (the
     * WooCommerce role stays; their orders and login keep working).
     *
     * Only accounts whose every role is in ADOPTABLE_ROLES qualify. A psikolog, a clinic
     * admin, a site editor — or an account with no role, which is what a disabled one
     * can look like — still answers 409: attaching a booking there would hand clinical
     * records to a staff login.
     *
     * Profile fields only fill gaps: the account owner's own name is not overwritten
     * by whatever a booking form typed. No welcome email: they already have a login.
     *
     * @param array<string,mixed> $params
     * @return array<string,mixed>|\WP_Error
     */
    private function adopt(int $user_id, array $params, \WP_REST_Request $request): array|\WP_Error
    {
        $user = get_user_by('id', $user_id);
        if (!$user instanceof \WP_User) {
            return new \WP_Error('praktiqu_email_taken', 'That email is already registered.', ['status' => 409]);
        }

        $roles = array_values((array) $user->roles);
        $already_patient = in_array(self::ROLE, $roles, true);
        $ordinary = $roles !== [] && array_diff($roles, self::ADOPTABLE_ROLES) === [];
        if (!$already_patient && !$ordinary) {
            return new \WP_Error('praktiqu_email_taken', 'That email is already registered.', ['status' => 409]);
        }

        if (!$already_patient) {
            $user->add_role(self::ROLE);
        }

        $names = ['ID' => $user_id];
        foreach (['first_name', 'last_name'] as $key) {
            $given = sanitize_text_field((string) ($params[$key] ?? ''));
            if ($given !== '' && trim((string) $user->$key) === '') {
                $names[$key] = $given;
            }
        }
        if (count($names) > 1) {
            $result = wp_update_user($names);
            if (is_wp_error($result)) {
                return $result;
            }
        }

        $raw = get_user_meta($user_id, 'basic_data', true);
        $basic = is_string($raw) && $raw !== '' ? (json_decode($raw, true) ?: []) : [];
        if (trim((string) ($basic['mobile_number'] ?? '')) === '' && !empty($params['contact_number'])) {
            $this->write_profile_meta($user_id, ['contact_number' => $params['contact_number']], true);
        }

        if (!empty($params['clinic_id'])) {
            $this->map_to_clinic($user_id, (int) $params['clinic_id']);
        }

        $patient_data = $this->build_payload($user_id, $params, null);

        // kc_patient_update, not kc_patient_save: the save listeners send the welcome
        // email with a temporary password, and this account already has a password.
        do_action('kc_patient_update', $patient_data, $request);

        return $patient_data + ['adopted' => !$already_patient];
    }

    /* -------------------------------------------------------------- */
    /* Internals                                                       */
    /* -------------------------------------------------------------- */

    /**
     * Merge profile fields into the `basic_data` JSON blob.
     *
     * On update we merge rather than replace, so a partial request cannot silently
     * blank out fields the caller didn't mention.
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
            // `contact_number` is the request-facing name; KiviCare stores it as
            // `mobile_number` inside basic_data.
            $source = $key === 'mobile_number' ? 'contact_number' : $key;
            if (array_key_exists($source, $params)) {
                $basic[$key] = sanitize_text_field((string) $params[$source]);
            } elseif (!$merge) {
                $basic[$key] = '';
            }
        }

        update_user_meta($user_id, 'basic_data', wp_json_encode($basic, JSON_UNESCAPED_UNICODE));

        // Client lifecycle status lives here, NOT in wp_users.user_status: KiviCare's
        // use of that column is self-contradictory (KCPatient defaults it to 1 while
        // KCWPUser::updateStatus maps 'active' to 0) and it cannot hold ARCHIVED.
        // Decision A, 2026-07-26.
        if (!empty($params['client_status'])) {
            $status = strtoupper(sanitize_text_field((string) $params['client_status']));
            if (in_array($status, ['ACTIVE', 'INACTIVE', 'ARCHIVED'], true)) {
                update_user_meta($user_id, 'praktiqu_client_status', $status);
            }
        }

        // PraktiQU-only fields. KiviCare's basic_data has no slot for these, and we
        // keep them under our own prefix so we never reinterpret one of its keys.
        foreach (['emergency_contact' => 'praktiqu_emergency_contact', 'notes' => 'praktiqu_notes'] as $param => $meta) {
            if (array_key_exists($param, $params)) {
                update_user_meta($user_id, $meta, sanitize_textarea_field((string) $params[$param]));
            }
        }

        foreach (['patient_unique_id', 'timezone'] as $key) {
            if (!empty($params[$key])) {
                update_user_meta($user_id, $key, sanitize_text_field((string) $params[$key]));
            }
        }

        if (!empty($params['profile_image'])) {
            update_user_meta($user_id, 'patient_profile_image', (int) $params['profile_image']);
        }
    }

    /**
     * Link the patient to a clinic. Idempotent — re-sending the same clinic must not
     * create a duplicate row, since the table has no unique constraint.
     */
    private function map_to_clinic(int $user_id, int $clinic_id): void
    {
        global $wpdb;
        $table = $wpdb->prefix . 'kc_patient_clinic_mappings';

        $exists = $wpdb->get_var(
            $wpdb->prepare(
                "SELECT id FROM {$table} WHERE patient_id = %d AND clinic_id = %d LIMIT 1",
                $user_id,
                $clinic_id
            )
        );
        if ($exists) {
            return;
        }

        $wpdb->insert($table, [
            'patient_id' => $user_id,
            'clinic_id'  => $clinic_id,
            'created_at' => current_time('mysql'),
        ], ['%d', '%d', '%s']);
    }

    /**
     * wp_insert_user rejects a duplicate user_login, and we derive the login from the
     * email local-part, so two patients at different domains can collide.
     */
    private function unique_username(string $email): string
    {
        $base = sanitize_user((string) strstr($email, '@', true), true);
        if ($base === '') {
            $base = 'patient';
        }

        $candidate = $base;
        $suffix = 1;
        while (username_exists($candidate)) {
            $candidate = $base . $suffix;
            $suffix++;
        }
        return $candidate;
    }

    /**
     * Payload shape mirrors PatientController.php:1308-1331 so existing hook
     * listeners receive what they already expect.
     *
     * @param array<string,mixed> $params
     * @return array<string,mixed>
     */
    private function build_payload(int $user_id, array $params, ?string $temp_password): array
    {
        $user  = new \WP_User($user_id);
        $raw   = get_user_meta($user_id, 'basic_data', true);
        $basic = is_string($raw) && $raw !== '' ? (json_decode($raw, true) ?: []) : [];
        $image = (int) get_user_meta($user_id, 'patient_profile_image', true);

        return [
            'id'                => $user_id,
            'first_name'        => $user->first_name,
            'last_name'         => $user->last_name,
            'email'             => $user->user_email,
            'username'          => $user->user_login,
            'contact_number'    => $basic['mobile_number'] ?? '',
            'dob'               => $basic['dob'] ?? '',
            'gender'            => $basic['gender'] ?? '',
            'blood_group'       => $basic['blood_group'] ?? '',
            'address'           => $basic['address'] ?? '',
            'city'              => $basic['city'] ?? '',
            'country'           => $basic['country'] ?? '',
            'postal_code'       => $basic['postal_code'] ?? '',
            'status'            => 1,
            'patient_image_url' => $image ? wp_get_attachment_url($image) : '',
            'patient_image_id'  => $image ?: null,
            'clinics'           => isset($params['clinic_id']) ? (int) $params['clinic_id'] : null,
            'created_at'        => current_time('mysql'),
            // Listeners use this for the welcome email; null on update, where no
            // password was generated.
            'temp_password'     => $temp_password,
            'patient_unique_id' => get_user_meta($user_id, 'patient_unique_id', true) ?: null,
            'timezone'          => get_user_meta($user_id, 'timezone', true) ?: null,
        ];
    }
}
