<?php
/**
 * Receptionist writes.
 *
 * Fixes a confirmed defect in src/services/billing/receptionist.service.ts, which
 * provisions a receptionist with raw SQL and so produces an unusable account:
 *
 *   1. It never fires `kc_receptionist_save`, so
 *      KCReceptionistNotificationListener::handleReceptionistRegistered never runs
 *      and no welcome email is sent.
 *   2. It writes `user_pass = '!disabled-<username>'` — a placeholder that is not a
 *      valid WordPress hash — so `wp_check_password` in Service::authenticate always
 *      returns false. The receptionist can never log in, and no flow sets a real one.
 *
 * Creating through WordPress proper fixes both: wp_insert_user hashes a real password
 * and the hook fires the welcome email carrying it.
 *
 * @package PraktiQU\Endpoint
 */

declare(strict_types=1);

namespace PraktiQU\Endpoint;

defined('ABSPATH') || exit;

final class Receptionists
{
    private const ROLE = 'kiviCare_receptionist';

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

        $clinic_id = (int) ($params['clinic_id'] ?? 0);
        if ($clinic_id <= 0) {
            return new \WP_Error('praktiqu_missing_clinic', 'clinic_id is required.', ['status' => 400]);
        }

        $name  = sanitize_text_field((string) ($params['name'] ?? ''));
        $first = $name === '' ? '' : explode(' ', $name)[0];
        $last  = trim(substr($name, strlen($first))) ?: '-';

        // A real, hashed password — the welcome email delivers it. The old raw-SQL
        // path stored an unusable placeholder, locking the account permanently.
        $password = (string) ($params['password'] ?? wp_generate_password(12, true));

        $user_id = wp_insert_user([
            'user_login'   => $this->unique_username($email),
            'user_email'   => $email,
            'user_pass'    => $password,
            'first_name'   => $first,
            'last_name'    => $last,
            'display_name' => $name !== '' ? $name : $email,
            'role'         => self::ROLE,
        ]);

        if (is_wp_error($user_id)) {
            return $user_id;
        }

        $user_id = (int) $user_id;
        (new \WP_User($user_id))->set_role(self::ROLE);

        $this->map_to_clinic($user_id, $clinic_id);

        $data = [
            'id'            => $user_id,
            'first_name'    => $first,
            'last_name'     => $last,
            'email'         => $email,
            'clinic_id'     => $clinic_id,
            'temp_password' => $password,
            'created_at'    => current_time('mysql'),
        ];

        do_action('kc_receptionist_save', $data, $request);

        return $data;
    }

    /** Idempotent: the mapping table has no unique constraint. */
    private function map_to_clinic(int $user_id, int $clinic_id): void
    {
        global $wpdb;
        $table = $wpdb->prefix . 'kc_receptionist_clinic_mappings';

        $exists = $wpdb->get_var($wpdb->prepare(
            "SELECT id FROM {$table} WHERE receptionist_id = %d AND clinic_id = %d LIMIT 1",
            $user_id,
            $clinic_id
        ));
        if ($exists) {
            return;
        }

        $wpdb->insert($table, [
            'receptionist_id' => $user_id,
            'clinic_id'       => $clinic_id,
            'created_at'      => current_time('mysql'),
        ], ['%d', '%d', '%s']);
    }

    private function unique_username(string $email): string
    {
        $base = sanitize_user((string) strstr($email, '@', true), true) ?: 'receptionist';
        $candidate = $base;
        $suffix = 1;
        while (username_exists($candidate)) {
            $candidate = $base . $suffix;
            $suffix++;
        }
        return $candidate;
    }
}
