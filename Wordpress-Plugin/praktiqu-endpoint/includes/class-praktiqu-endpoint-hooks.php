<?php
/**
 * WP-side hooks — emit webhooks to PraktiQU when state changes
 * that would otherwise leave PraktiQU with stale tokens / cached identity.
 *
 * Addresses audit finding C4 (refresh-token / password staleness):
 *   - `password_reset`     → PraktiQU invalidates all refresh tokens for the user
 *   - `profile_update`     → if user_pass or user_status changed, notify PraktiQU
 *   - `wp_login`           → optional: notify PraktiQU of the new auth (for audit)
 *   - `delete_user`        → notify PraktiQU to deactivate the User
 *   - `praktiqu_endpoint_password_changed` (our own action) → mark password timestamp
 *
 * Webhook target is configured in the plugin settings page (or via the
 * `praktiqu_endpoint_webhook_url` / `praktiqu_endpoint_webhook_secret` options).
 *
 * @package PraktiQU\Endpoint
 */

declare(strict_types=1);

namespace PraktiQU\Endpoint;

defined('ABSPATH') || exit;

final class Hooks
{
    private Service $service;

    public function __construct(Service $service)
    {
        $this->service = $service;
    }

    public function register(): void
    {
        // Mark the password-changed timestamp whenever password changes
        // (whether by our REST endpoint or by any other WP path).
        add_action('praktiqu_endpoint_password_changed', [$this, 'on_password_changed_internal'], 10, 2);
        add_action('password_reset', [$this, 'on_password_reset'], 10, 2);
        add_action('profile_update', [$this, 'on_profile_update'], 10, 2);

        // User deactivation / deletion.
        add_action('delete_user', [$this, 'on_user_deleted'], 10, 2);
        add_action('deactivated_user', [$this, 'on_user_deactivated'], 10, 1);
        add_action('activated_user', [$this, 'on_user_reactivated'], 10, 1);

        // User role changes (added/removed role).
        add_action('set_user_role', [$this, 'on_user_role_changed'], 10, 3);

        // Failed login (for audit, optional).
        add_action('wp_login_failed', [$this, 'on_login_failed'], 10, 1);
    }

    /**
     * Internal password change (REST endpoint) → mark timestamp + webhook.
     */
    public function on_password_changed_internal(int $wp_user_id, string $_new_password): void
    {
        $this->service->mark_password_changed($wp_user_id);
        $this->dispatch_webhook('password.changed', $wp_user_id);
    }

    /**
     * WordPress password reset (e.g., via wp-login.php or admin reset).
     * Signature: (WP_User $user, string $new_pass)
     */
    public function on_password_reset(\WP_User $user, string $_new_pass): void
    {
        $this->service->mark_password_changed((int) $user->ID);
        $this->dispatch_webhook('password.changed', (int) $user->ID);
    }

    /**
     * profile_update fires on any user update. We only act if user_pass
     * or user_status changed.
     */
    public function on_profile_update(int $wp_user_id, \WP_User $_old_user): void
    {
        $user = get_user_by('id', $wp_user_id);
        if (!$user instanceof \WP_User) {
            return;
        }

        // If password changed via wp_update_user, mark the timestamp.
        if ($_old_user->user_pass !== $user->user_pass) {
            $this->service->mark_password_changed($wp_user_id);
            $this->dispatch_webhook('password.changed', $wp_user_id);
            return;
        }

        // If user_status changed, emit deactivation/reactivation event.
        if ((int) $_old_user->user_status !== (int) $user->user_status) {
            $event = ((int) $user->user_status === 0) ? 'user.reactivated' : 'user.deactivated';
            $this->dispatch_webhook($event, $wp_user_id);
        }
    }

    public function on_user_deleted(int $wp_user_id, int $_reassign): void
    {
        $this->dispatch_webhook('user.deleted', $wp_user_id);
    }

    public function on_user_deactivated(int $wp_user_id): void
    {
        $this->dispatch_webhook('user.deactivated', $wp_user_id);
    }

    public function on_user_reactivated(int $wp_user_id): void
    {
        $this->dispatch_webhook('user.reactivated', $wp_user_id);
    }

    /**
     * set_user_role fires on add_role / remove_role / set_role.
     * Signature: (int $wp_user_id, string $new_role, string[] $old_roles)
     */
    public function on_user_role_changed(int $wp_user_id, string $new_role, array $old_roles): void
    {
        if (in_array($new_role, $old_roles, true)) {
            return; // no change
        }
        $this->dispatch_webhook('user.role_changed', $wp_user_id, [
            'oldRoles' => array_values($old_roles),
            'newRole'  => $new_role,
        ]);
    }

    public function on_login_failed(string $username): void
    {
        $this->dispatch_webhook('login.failed', 0, ['username' => $username]);
    }

    /**
     * Dispatch a signed webhook to the configured PraktiQU endpoint.
     *
     * The payload is HMAC-SHA256 signed with the `praktiqu_endpoint_webhook_secret`
     * option and sent in the `X-PraktiQU-Webhook-Signature` header. The
     * receiving PraktiQU endpoint MUST verify the signature before acting.
     */
    public function dispatch_webhook(string $event, int $wp_user_id, array $extra = []): void
    {
        $url = (string) get_option('praktiqu_endpoint_webhook_url', '');
        if ($url === '') {
            return; // No webhook configured; silent no-op.
        }

        $secret = (string) get_option('praktiqu_endpoint_webhook_secret', '');
        $payload = array_merge([
            'event'    => $event,
            'wpUserId' => $wp_user_id,
            'issuedAt' => gmdate('c'),
            'source'   => 'praktiqu-endpoint',
        ], $extra);
        $body = wp_json_encode($payload);
        if ($body === false) {
            return;
        }

        $signature = $secret !== ''
            ? hash_hmac('sha256', $body, $secret)
            : '';

        $args = [
            'method'      => 'POST',
            'timeout'     => 5,
            'redirection' => 0,
            'headers'     => [
                'Content-Type'                  => 'application/json',
                'X-PraktiQU-Webhook-Event'      => $event,
                'X-PraktiQU-Webhook-Signature'  => $signature,
            ],
            'body'        => $body,
            'blocking'    => false, // fire-and-forget; log failures async
        ];

        $response = wp_remote_post($url, $args);
        if (is_wp_error($response)) {
            // Optional: write to a debug log. Don't crash the WP request.
            if (defined('WP_DEBUG') && WP_DEBUG) {
                error_log('[praktiqu-endpoint] webhook dispatch failed: ' . $response->get_error_message());
            }
        }
    }
}
