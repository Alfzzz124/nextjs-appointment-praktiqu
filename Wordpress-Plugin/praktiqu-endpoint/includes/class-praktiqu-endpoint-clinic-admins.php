<?php
/**
 * Clinic admin accounts for clinics created by the Next.js app.
 *
 * The app writes the wp_kc_clinics row itself; the account is made here because an account
 * must come from wp_insert_user — a raw INSERT into wp_users stores an unusable password hash
 * (see class-praktiqu-endpoint-receptionists.php for that incident).
 *
 * Mirrors KiviCare Pro's own flow (KCProClinicController::createClinic): create the user with
 * the kiviCare_clinic_admin role, point the clinic's clinic_admin_id at it, send the
 * clinic_admin_registration email, fire kivicare_clinic_admin_registered. It deliberately does
 * NOT fire kcpro_clinic_save: that listener mails the site admin a "new user" notice.
 *
 * Only a clinic WITHOUT an admin (clinic_admin_id = 0) is accepted, so this endpoint cannot be
 * used to take over somebody else's clinic.
 *
 * @package PraktiQU\Endpoint
 */

declare(strict_types=1);

namespace PraktiQU\Endpoint;

defined('ABSPATH') || exit;

final class ClinicAdmins
{
    private const ROLE = 'kiviCare_clinic_admin';

    /**
     * @param array<string,mixed> $params
     * @return array<string,mixed>|\WP_Error
     */
    public function create(array $params, \WP_REST_Request $request): array|\WP_Error
    {
        global $wpdb;

        $email = sanitize_email((string) ($params['email'] ?? ''));
        if ($email === '' || !is_email($email)) {
            return new \WP_Error('praktiqu_invalid_email', 'A valid email is required.', ['status' => 400]);
        }

        $name = trim(sanitize_text_field((string) ($params['name'] ?? '')));
        if ($name === '') {
            return new \WP_Error('praktiqu_invalid_name', 'name is required.', ['status' => 400]);
        }

        $clinic_id = (int) ($params['clinic_id'] ?? 0);
        if ($clinic_id <= 0) {
            return new \WP_Error('praktiqu_missing_clinic', 'clinic_id is required.', ['status' => 400]);
        }

        $table  = $wpdb->prefix . 'kc_clinics';
        $clinic = $wpdb->get_row($wpdb->prepare(
            "SELECT id, name, email, telephone_no, address, city, state, country, postal_code, clinic_admin_id FROM {$table} WHERE id = %d",
            $clinic_id
        ), ARRAY_A);
        if (!is_array($clinic)) {
            return new \WP_Error('praktiqu_clinic_not_found', 'That clinic does not exist.', ['status' => 404]);
        }
        if ((int) $clinic['clinic_admin_id'] !== 0) {
            return new \WP_Error('praktiqu_clinic_has_admin', 'That clinic already has an admin.', ['status' => 409]);
        }

        if (email_exists($email)) {
            return new \WP_Error('praktiqu_email_taken', 'That email is already registered.', ['status' => 409]);
        }

        $first    = explode(' ', $name)[0];
        $last     = trim(substr($name, strlen($first))) ?: '-';
        $username = $this->unique_username($email);
        // A real, hashed password — the welcome email delivers it.
        $password = wp_generate_password(12, true);

        $user_id = wp_insert_user([
            'user_login'   => $username,
            'user_email'   => $email,
            'user_pass'    => $password,
            'first_name'   => $first,
            'last_name'    => $last,
            'display_name' => $name,
            'role'         => self::ROLE,
        ]);
        if (is_wp_error($user_id)) {
            return $user_id;
        }
        $user_id = (int) $user_id;
        (new \WP_User($user_id))->set_role(self::ROLE);

        // Conditional claim: if another request gave the clinic an admin between the read
        // above and now, this matches no row and the user just created is removed again.
        $claimed = $wpdb->query($wpdb->prepare(
            "UPDATE {$table} SET clinic_admin_id = %d WHERE id = %d AND clinic_admin_id = 0",
            $user_id,
            $clinic_id
        ));
        if ($claimed !== 1) {
            if (!function_exists('wp_delete_user')) {
                require_once ABSPATH . 'wp-admin/includes/user.php';
            }
            wp_delete_user($user_id);
            return new \WP_Error('praktiqu_clinic_has_admin', 'That clinic already has an admin.', ['status' => 409]);
        }

        $email_sent = $this->send_welcome($user_id, $email, $username, $password, $first, $last, $name, $clinic);

        do_action('kivicare_clinic_admin_registered', [
            'id'            => $clinic_id,
            'user_id'       => $user_id,
            'username'      => $username,
            'password'      => $password,
            'user_email'    => $email,
            'first_name'    => $first,
            'last_name'     => $last,
            'mobile_number' => '',
            'clinic_name'   => (string) ($clinic['name'] ?? ''),
        ]);

        // No password in the response: the app does not need it, and responses get logged.
        return [
            'id'         => $user_id,
            'email'      => $email,
            'username'   => $username,
            'clinic_id'  => $clinic_id,
            'email_sent' => $email_sent,
        ];
    }

    /**
     * KiviCare's clinic_admin_registration template when KiviCare's sender is loaded (it
     * carries the username and password); otherwise WordPress's own new-user email, which
     * carries a set-password link instead. A failed send never fails the request.
     *
     * @param array<string,mixed> $clinic
     */
    private function send_welcome(int $user_id, string $email, string $username, string $password, string $first, string $last, string $name, array $clinic): bool
    {
        $prefix = defined('KIVI_CARE_PREFIX') ? KIVI_CARE_PREFIX : 'kiviCare_';

        if (class_exists('App\emails\KCEmailSender')) {
            try {
                $sender = \App\emails\KCEmailSender::get_instance();
                if ($sender !== null) {
                    $address = implode(', ', array_filter(array_map(
                        static fn ($k) => trim((string) ($clinic[$k] ?? '')),
                        ['address', 'city', 'state', 'country', 'postal_code']
                    )));
                    $sent = $sender->sendEmailByTemplate($prefix . 'clinic_admin_registration', $email, [
                        'user_name'             => $username,
                        'user_email'            => $email,
                        'user_password'         => $password,
                        'user_role'             => 'Clinic Administrator',
                        'user_contact'          => '',
                        'clinic_name'           => (string) ($clinic['name'] ?? ''),
                        'clinic_email'          => (string) ($clinic['email'] ?? ''),
                        'clinic_contact_number' => (string) ($clinic['telephone_no'] ?? ''),
                        'clinic_address'        => $address,
                        'first_name'            => $first,
                        'last_name'             => $last,
                        'display_name'          => $name,
                    ]);
                    if ($sent) {
                        return true;
                    }
                    error_log('[praktiqu-endpoint] clinic admin welcome template failed for user ' . $user_id . '; falling back to the WordPress email');
                }
            } catch (\Throwable $e) {
                error_log('[praktiqu-endpoint] clinic admin welcome email failed: ' . $e->getMessage());
            }
        }

        try {
            wp_new_user_notification($user_id, null, 'user');
            return true;
        } catch (\Throwable $e) {
            error_log('[praktiqu-endpoint] wp_new_user_notification failed: ' . $e->getMessage());
            return false;
        }
    }

    private function unique_username(string $email): string
    {
        $base = sanitize_user((string) strstr($email, '@', true), true) ?: 'clinicadmin';
        $candidate = $base;
        $suffix = 1;
        while (username_exists($candidate)) {
            $candidate = $base . $suffix;
            $suffix++;
        }
        return $candidate;
    }
}
