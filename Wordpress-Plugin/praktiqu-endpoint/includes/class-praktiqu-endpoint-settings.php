<?php
/**
 * Admin settings page — webhook URL, webhook secret, service-token status.
 *
 * The service token itself is configured in wp-config.php (per security
 * policy) and is NOT editable from this page. This page only shows its
 * presence/length and a placeholder for rotation reminders.
 *
 * @package PraktiQU\Endpoint
 */

declare(strict_types=1);

namespace PraktiQU\Endpoint;

defined('ABSPATH') || exit;

final class Settings
{
    public const OPTION_GROUP = 'praktiqu_endpoint_settings';
    public const SETTINGS_SLUG = 'praktiqu-endpoint';

    public function register(): void
    {
        add_action('admin_menu', [$this, 'add_menu']);
        add_action('admin_init', [$this, 'register_settings']);
        add_action('admin_notices', [$this, 'maybe_show_activation_notice']);
    }

    public function add_menu(): void
    {
        add_options_page(
            __('PraktiQU Endpoint', 'praktiqu-endpoint'),
            __('PraktiQU Endpoint', 'praktiqu-endpoint'),
            'manage_options',
            self::SETTINGS_SLUG,
            [$this, 'render_page']
        );
    }

    public function register_settings(): void
    {
        register_setting(self::OPTION_GROUP, 'praktiqu_endpoint_webhook_url', [
            'type'              => 'string',
            'sanitize_callback' => 'esc_url_raw',
            'default'           => '',
        ]);
        register_setting(self::OPTION_GROUP, 'praktiqu_endpoint_webhook_secret', [
            'type'              => 'string',
            'sanitize_callback' => [$this, 'sanitize_secret'],
            'default'           => '',
        ]);
    }

    /**
     * Allow the secret to be either kept (placeholder) or rotated.
     * If the user submits the placeholder `********`, keep the existing value.
     */
    public function sanitize_secret(string $value): string
    {
        if ($value === '' || $value === str_repeat('*', 8)) {
            return (string) get_option('praktiqu_endpoint_webhook_secret', '');
        }
        return $value;
    }

    public function maybe_show_activation_notice(): void
    {
        if (get_transient('praktiqu_endpoint_activation_notice') !== 'token_missing') {
            return;
        }
        delete_transient('praktiqu_endpoint_activation_notice');
        ?>
        <div class="notice notice-warning">
            <p>
                <strong><?php esc_html_e('PraktiQU Endpoint:', 'praktiqu-endpoint'); ?></strong>
                <?php esc_html_e('The PRAKTIQU_SERVICE_TOKEN constant is not defined in wp-config.php. Add the following line and replace the placeholder with a long random string:', 'praktiqu-endpoint'); ?>
            </p>
            <pre style="background:#f6f7f7;padding:8px;border-radius:4px;">define('PRAKTIQU_SERVICE_TOKEN', '&lt;generate-with-openssl-rand-base64-48&gt;');</pre>
        </div>
        <?php
    }

    public function render_page(): void
    {
        if (!current_user_can('manage_options')) {
            return;
        }

        $webhook_url    = (string) get_option('praktiqu_endpoint_webhook_url', '');
        $webhook_secret = (string) get_option('praktiqu_endpoint_webhook_secret', '');
        $token_set      = Plugin::service_token_configured();
        $token_length   = $token_set ? strlen((string) constant('PRAKTIQU_SERVICE_TOKEN')) : 0;
        ?>
        <div class="wrap">
            <h1><?php esc_html_e('PraktiQU Endpoint Settings', 'praktiqu-endpoint'); ?></h1>

            <h2><?php esc_html_e('Service Token', 'praktiqu-endpoint'); ?></h2>
            <?php if ($token_set): ?>
                <p>
                    <span style="color:#1a7f37;">✓</span>
                    <?php
                    /* translators: %d: token length in characters */
                    printf(esc_html__('Configured (length: %d characters).', 'praktiqu-endpoint'), (int) $token_length);
                    ?>
                </p>
                <p class="description">
                    <?php esc_html_e('Rotate by updating the PRAKTIQU_SERVICE_TOKEN constant in wp-config.php on both this WordPress site and the PraktiQU Next.js app (.env).', 'praktiqu-endpoint'); ?>
                </p>
            <?php else: ?>
                <p>
                    <span style="color:#b32d2e;">✗</span>
                    <?php esc_html_e('Not configured. Add the PRAKTIQU_SERVICE_TOKEN constant to wp-config.php.', 'praktiqu-endpoint'); ?>
                </p>
            <?php endif; ?>

            <hr/>

            <form method="post" action="options.php">
                <?php settings_fields(self::OPTION_GROUP); ?>

                <h2><?php esc_html_e('PraktiQU Webhook', 'praktiqu-endpoint'); ?></h2>
                <p class="description">
                    <?php esc_html_e('PraktiQU will receive signed webhook POSTs when user state changes on this WordPress site (password change, role change, deactivation, deletion, failed login).', 'praktiqu-endpoint'); ?>
                </p>

                <table class="form-table" role="presentation">
                    <tr>
                        <th scope="row">
                            <label for="praktiqu_endpoint_webhook_url"><?php esc_html_e('Webhook URL', 'praktiqu-endpoint'); ?></label>
                        </th>
                        <td>
                            <input
                                type="url"
                                id="praktiqu_endpoint_webhook_url"
                                name="praktiqu_endpoint_webhook_url"
                                value="<?php echo esc_attr($webhook_url); ?>"
                                class="regular-text"
                                placeholder="https://praktiqu.example.com/api/v1/webhooks/wordpress"
                            />
                            <p class="description">
                                <?php esc_html_e('Example: https://praktiqu.example.com/api/v1/webhooks/wordpress. Leave empty to disable webhooks.', 'praktiqu-endpoint'); ?>
                            </p>
                        </td>
                    </tr>
                    <tr>
                        <th scope="row">
                            <label for="praktiqu_endpoint_webhook_secret"><?php esc_html_e('Webhook Signing Secret', 'praktiqu-endpoint'); ?></label>
                        </th>
                        <td>
                            <input
                                type="text"
                                id="praktiqu_endpoint_webhook_secret"
                                name="praktiqu_endpoint_webhook_secret"
                                value="<?php echo esc_attr($webhook_secret === '' ? '' : str_repeat('*', max(8, strlen($webhook_secret)))); ?>"
                                class="regular-text"
                                placeholder="<?php esc_attr_e('(unchanged)', 'praktiqu-endpoint'); ?>"
                            />
                            <p class="description">
                                <?php esc_html_e('HMAC-SHA256 secret used to sign webhook bodies. Submit the placeholder to keep the existing value; submit a new value to rotate.', 'praktiqu-endpoint'); ?>
                            </p>
                        </td>
                    </tr>
                </table>

                <?php submit_button(); ?>
            </form>

            <hr/>

            <h2><?php esc_html_e('REST Endpoints', 'praktiqu-endpoint'); ?></h2>
            <p><?php esc_html_e('All endpoints require the X-PraktiQU-Service-Token header. Base path:', 'praktiqu-endpoint'); ?> <code><?php echo esc_html(rest_url(PRAKTIQU_ENDPOINT_REST_NAMESPACE)); ?></code></p>
            <ul style="list-style:disc;padding-left:24px;">
                <li><code>POST /authenticate</code> — verify email + password</li>
                <li><code>GET  /users/{id}</code> — get identity by WP user ID</li>
                <li><code>POST /users/lookup</code> — get identity by email</li>
                <li><code>POST /users/{id}/change-password</code> — change password</li>
                <li><code>GET  /health</code> — liveness probe</li>
            </ul>
        </div>
        <?php
    }
}
