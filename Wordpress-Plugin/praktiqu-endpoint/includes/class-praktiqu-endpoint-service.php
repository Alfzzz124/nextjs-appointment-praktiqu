<?php
/**
 * Service — credential verification, identity lookup, password changes,
 * and outbound webhook delivery to PraktiQU.
 *
 * All operations are stateless; the service holds no per-request data.
 * The KIVI_CARE_PREFIX constant is read from the KiviCare plugin if loaded
 * (it is the canonical WordPress role prefix used by the KiviCare plugin).
 *
 * @package PraktiQU\Endpoint
 */

declare(strict_types=1);

namespace PraktiQU\Endpoint;

defined('ABSPATH') || exit;

final class Service
{
    /**
     * Verify a user's email + password. Returns identity on success,
     * a WP_Error with a code on failure.
     *
     * Failure codes (per 001-auth-foundation/spec.md):
     *   - 'invalid_credentials' (401): wrong email or password
     *   - 'inactive'           (403): user meta `praktiqu_user_status` is not 'active'
     *                              (we use the WP `user_status` field for inactive accounts
     *                              and additionally a custom usermeta `praktiqu_user_status`
     *                              that admins can toggle without deactivating the WP account)
     */
    public function authenticate(string $email, string $password): array|\WP_Error
    {
        $email = strtolower(trim($email));
        if ($email === '' || $password === '') {
            return new \WP_Error('invalid_credentials', 'Invalid email or password.', ['status' => 401]);
        }

        $user = get_user_by('email', $email);
        if (!$user instanceof \WP_User) {
            // Run the password check anyway to mitigate user enumeration timing.
            $this->dummy_password_check($password);
            return new \WP_Error('invalid_credentials', 'Invalid email or password.', ['status' => 401]);
        }

        // Active status check (custom usermeta set by PraktiQU admin UI).
        $praktiqu_status = (string) get_user_meta($user->ID, 'praktiqu_user_status', true);
        if ($praktiqu_status !== '' && $praktiqu_status !== 'active') {
            return new \WP_Error('inactive', 'Account is inactive.', ['status' => 403]);
        }

        // Check the password using WP's password hashing (PHPASS / bcrypt).
        if (!wp_check_password($password, $user->user_pass, $user->ID)) {
            return new \WP_Error('invalid_credentials', 'Invalid email or password.', ['status' => 401]);
        }

        return $this->build_identity($user);
    }

    /**
     * Look up a user by wp_users.ID and return identity.
     */
    public function get_user_by_id(int $wp_user_id): array|\WP_Error
    {
        $user = get_user_by('id', $wp_user_id);
        if (!$user instanceof \WP_User) {
            return new \WP_Error('not_found', 'User not found.', ['status' => 404]);
        }
        return $this->build_identity($user);
    }

    /**
     * Look up a user by email and return identity.
     */
    public function get_user_by_email(string $email): array|\WP_Error
    {
        $email = strtolower(trim($email));
        if ($email === '') {
            return new \WP_Error('invalid_email', 'Email is required.', ['status' => 400]);
        }
        $user = get_user_by('email', $email);
        if (!$user instanceof \WP_User) {
            return new \WP_Error('not_found', 'User not found.', ['status' => 404]);
        }
        return $this->build_identity($user);
    }

    /**
     * Change a user's password. Returns identity on success, WP_Error on failure.
     *
     * Triggers the `praktiqu_endpoint_password_changed` action so other code
     * (and the webhook dispatcher in Hooks) can react.
     */
    public function change_password(int $wp_user_id, string $new_password): array|\WP_Error
    {
        $user = get_user_by('id', $wp_user_id);
        if (!$user instanceof \WP_User) {
            return new \WP_Error('not_found', 'User not found.', ['status' => 404]);
        }

        $validation = $this->validate_password_strength($new_password);
        if (is_wp_error($validation)) {
            return $validation;
        }

        // wp_set_password is the canonical WP API; it hashes with the
        // currently-active algorithm (PHPASS or bcrypt).
        wp_set_password($new_password, $wp_user_id);

        // Force session cookie regeneration by clearing the auth cookie.
        // (If the user was logged in, this invalidates their session.)
        wp_clear_auth_cookie();

        /**
         * Fires after a PraktiQU-initiated password change succeeds.
         *
         * @param int    $wp_user_id   The WordPress user ID.
         * @param string $new_password The new plaintext password (handle with care;
         *                             do not log or persist).
         */
        do_action('praktiqu_endpoint_password_changed', $wp_user_id, $new_password);

        return $this->build_identity(get_user_by('id', $wp_user_id));
    }

    /**
     * Build the canonical identity payload returned to PraktiQU.
     */
    public function build_identity(\WP_User $user): array
    {
        return [
            'wpUserId'           => (int) $user->ID,
            'email'              => (string) $user->user_email,
            'username'           => (string) $user->user_login,
            'displayName'        => (string) $user->display_name,
            'firstName'          => (string) $user->first_name,
            'lastName'           => (string) $user->last_name,
            'roles'              => array_values((array) $user->roles),
            'status'             => $this->resolve_status($user),
            'passwordChangedAt'  => $this->resolve_password_changed_at($user),
            'registeredAt'       => mysql2date('c', (string) $user->user_registered),
        ];
    }

    /**
     * Resolve the PraktiQU-level status (active / inactive / blocked).
     * Uses the `praktiqu_user_status` usermeta, falling back to WP's user_status.
     */
    private function resolve_status(\WP_User $user): string
    {
        $meta = (string) get_user_meta($user->ID, 'praktiqu_user_status', true);
        if ($meta !== '') {
            return $meta;
        }
        // WP user_status: 0 = active, 1 = spam/disabled (per WP core).
        return ((int) $user->user_status) === 0 ? 'active' : 'inactive';
    }

    /**
     * Resolve the last password-changed timestamp.
     *
     * WP core does not track this directly, so we maintain a usermeta
     * `praktiqu_password_changed_at` that we update on every password change
     * and read here. PraktiQU uses this for token-family invalidation and
     * cache-busting on the verify-password cache.
     */
    private function resolve_password_changed_at(\WP_User $user): string
    {
        $stored = (string) get_user_meta($user->ID, 'praktiqu_password_changed_at', true);
        if ($stored !== '') {
            return mysql2date('c', $stored);
        }
        // Fallback to user_registered (best estimate for legacy users).
        return mysql2date('c', (string) $user->user_registered);
    }

    /**
     * Update the `praktiqu_password_changed_at` usermeta.
     */
    public function mark_password_changed(int $wp_user_id): void
    {
        update_user_meta($wp_user_id, 'praktiqu_password_changed_at', current_time('mysql', true));
    }

    /**
     * Lightweight password strength validation.
     * WordPress core does not enforce strength; we add a minimum baseline.
     */
    public function validate_password_strength(string $password): true|\WP_Error
    {
        if (strlen($password) < 12) {
            return new \WP_Error(
                'password_too_short',
                'Password must be at least 12 characters.',
                ['status' => 400]
            );
        }
        if (!preg_match('/[A-Z]/', $password)
            || !preg_match('/[a-z]/', $password)
            || !preg_match('/[0-9]/', $password)
        ) {
            return new \WP_Error(
                'password_too_weak',
                'Password must contain uppercase, lowercase, and a digit.',
                ['status' => 400]
            );
        }
        return true;
    }

    /**
     * Run a dummy password hash to mitigate user-enumeration timing.
     */
    private function dummy_password_check(string $password): void
    {
        // PHPASS-style dummy hash; matching a real PHPASS hash would be
        // impossible, so wp_check_password will reliably return false
        // without revealing whether the user exists.
        wp_check_password($password, '$P$DummyHashForTimingAttackMitigationOnly.');
    }
}
