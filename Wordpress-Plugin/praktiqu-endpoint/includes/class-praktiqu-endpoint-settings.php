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
        register_setting(self::OPTION_GROUP, 'praktiqu_endpoint_payment_webhook_url', [
            'type'              => 'string',
            'sanitize_callback' => 'esc_url_raw',
            'default'           => '',
        ]);
        register_setting(self::OPTION_GROUP, 'praktiqu_endpoint_payment_webhook_secret', [
            'type'              => 'string',
            'sanitize_callback' => [$this, 'sanitize_payment_secret'],
            'default'           => '',
        ]);
        register_setting(self::OPTION_GROUP, 'praktiqu_endpoint_paypal_idr_rate', [
            'type'              => 'string',
            'sanitize_callback' => [$this, 'sanitize_fx_rate'],
            'default'           => '18000',
        ]);
        register_setting(self::OPTION_GROUP, 'praktiqu_endpoint_paypal_markup_percent', [
            'type'              => 'string',
            'sanitize_callback' => [$this, 'sanitize_markup_percent'],
            'default'           => '0',
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

    /**
     * Same placeholder-preserving behavior as sanitize_secret(), but for the
     * payment webhook secret — kept independently rotatable from the general
     * webhook secret (see 2026-07-14 payment feature design §5 Security).
     */
    public function sanitize_payment_secret(string $value): string
    {
        if ($value === '' || $value === str_repeat('*', 8)) {
            return (string) get_option('praktiqu_endpoint_payment_webhook_secret', '');
        }
        return $value;
    }

    /**
     * Keep the FX rate a positive number, and stamp when it last changed so a
     * stale rate is visible on the settings screen rather than silent.
     *
     * A rejected value keeps the stored one: a blank or malformed submission
     * must not zero the rate, because Payments::create_order() treats a
     * non-positive rate as a hard failure and would refuse every PayPal order.
     * A rejection also registers a settings-API error so the admin sees *why*
     * the value on screen didn't change, instead of a plain "Settings saved"
     * that reads as success.
     */
    public function sanitize_fx_rate(string $value): string
    {
        $current = (string) get_option('praktiqu_endpoint_paypal_idr_rate', '18000');
        $trimmed = trim($value);
        if ($trimmed === '' || !is_numeric($trimmed) || (float) $trimmed <= 0) {
            add_settings_error(
                'praktiqu_endpoint_paypal_idr_rate',
                'praktiqu_invalid_fx_rate',
                __('PayPal FX Rate was not updated: it must be a number greater than 0. The previous value was kept.', 'praktiqu-endpoint')
            );
            return $current;
        }
        if ($trimmed !== $current) {
            update_option('praktiqu_endpoint_paypal_idr_rate_updated', gmdate('c'));
        }
        return $trimmed;
    }

    /**
     * Keep the foreign-patient markup between 0 and 100, and stamp when it
     * last changed — mirrors sanitize_fx_rate()'s behaviour, but 0 is a
     * valid, meaningful value here (it means "no markup"), unlike the rate.
     *
     * A value above 100 is far more likely a typo (e.g. an extra digit)
     * than an intended 100%+ surcharge, so it's rejected like any other bad
     * input.
     *
     * A rejected value keeps the stored one, same rationale as the rate
     * field: a blank or malformed submission must not silently change what
     * foreign patients are charged. A rejection also registers a
     * settings-API error, same as sanitize_fx_rate() — without it, a typo'd
     * markup (e.g. "150") saves silently at the old value while the screen
     * still says "Settings saved," which reads as success when it isn't.
     */
    public function sanitize_markup_percent(string $value): string
    {
        $current = (string) get_option('praktiqu_endpoint_paypal_markup_percent', '0');
        $trimmed = trim($value);
        if ($trimmed === '' || !is_numeric($trimmed) || (float) $trimmed < 0 || (float) $trimmed > 100) {
            add_settings_error(
                'praktiqu_endpoint_paypal_markup_percent',
                'praktiqu_invalid_markup_percent',
                __('Foreign Patient Markup was not updated: it must be a number between 0 and 100. The previous value was kept.', 'praktiqu-endpoint')
            );
            return $current;
        }
        if ($trimmed !== $current) {
            update_option('praktiqu_endpoint_paypal_markup_percent_updated', gmdate('c'));
        }
        return $trimmed;
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

            <?php
            // Renders any add_settings_error() notices registered by the
            // sanitize_* callbacks above (e.g. a rejected FX rate or markup) —
            // without this call the rejection happens silently and the page
            // just shows WordPress's generic "Settings saved" notice.
            settings_errors();
            ?>

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

                <h2><?php esc_html_e('PraktiQU Payment Webhook', 'praktiqu-endpoint'); ?></h2>
                <p class="description">
                    <?php esc_html_e('Separate URL + secret for payment.completed / payment.failed / payment.expired events (Xendit via WooCommerce). Kept independent of the general webhook secret above so it can be rotated without affecting password/user-state webhooks.', 'praktiqu-endpoint'); ?>
                </p>
                <table class="form-table" role="presentation">
                    <tr>
                        <th scope="row">
                            <label for="praktiqu_endpoint_payment_webhook_url"><?php esc_html_e('Payment Webhook URL', 'praktiqu-endpoint'); ?></label>
                        </th>
                        <td>
                            <input
                                type="url"
                                id="praktiqu_endpoint_payment_webhook_url"
                                name="praktiqu_endpoint_payment_webhook_url"
                                value="<?php echo esc_attr((string) get_option('praktiqu_endpoint_payment_webhook_url', '')); ?>"
                                class="regular-text"
                                placeholder="https://praktiqu.example.com/api/v1/sessions/payment-webhook"
                            />
                        </td>
                    </tr>
                    <tr>
                        <th scope="row">
                            <label for="praktiqu_endpoint_payment_webhook_secret"><?php esc_html_e('Payment Webhook Secret', 'praktiqu-endpoint'); ?></label>
                        </th>
                        <td>
                            <?php $payment_secret = (string) get_option('praktiqu_endpoint_payment_webhook_secret', ''); ?>
                            <input
                                type="text"
                                id="praktiqu_endpoint_payment_webhook_secret"
                                name="praktiqu_endpoint_payment_webhook_secret"
                                value="<?php echo esc_attr($payment_secret === '' ? '' : str_repeat('*', max(8, strlen($payment_secret)))); ?>"
                                class="regular-text"
                                placeholder="<?php esc_attr_e('(unchanged)', 'praktiqu-endpoint'); ?>"
                            />
                            <p class="description">
                                <?php esc_html_e('Must match the PraktiQU Next.js app\'s PAYMENT_WEBHOOK_SECRET env var exactly.', 'praktiqu-endpoint'); ?>
                            </p>
                        </td>
                    </tr>
                    <tr>
                        <th scope="row">
                            <label for="praktiqu_endpoint_paypal_idr_rate"><?php esc_html_e('PayPal FX Rate (IDR per 1 USD)', 'praktiqu-endpoint'); ?></label>
                        </th>
                        <td>
                            <input
                                type="text"
                                id="praktiqu_endpoint_paypal_idr_rate"
                                name="praktiqu_endpoint_paypal_idr_rate"
                                value="<?php echo esc_attr((string) get_option('praktiqu_endpoint_paypal_idr_rate', '18000')); ?>"
                                class="regular-text"
                                placeholder="18000"
                            />
                            <p class="description">
                                <?php esc_html_e('PayPal does not support IDR, so PayPal and card orders are charged in USD. This should be the honest market rate — keep it tracking the real exchange rate, not adjusted to change what a patient pays. To charge foreign patients more (or less), use the Foreign Patient Markup field below instead.', 'praktiqu-endpoint'); ?>
                                <?php
                                $rate_updated = (string) get_option('praktiqu_endpoint_paypal_idr_rate_updated', '');
                                if ($rate_updated !== '') {
                                    echo '<br/>' . esc_html(sprintf(
                                        /* translators: %s is an ISO-8601 timestamp. */
                                        __('Last changed: %s', 'praktiqu-endpoint'),
                                        $rate_updated
                                    ));
                                }
                                ?>
                            </p>
                        </td>
                    </tr>
                    <tr>
                        <th scope="row">
                            <label for="praktiqu_endpoint_paypal_markup_percent"><?php esc_html_e('Foreign Patient Markup (%)', 'praktiqu-endpoint'); ?></label>
                        </th>
                        <td>
                            <input
                                type="text"
                                id="praktiqu_endpoint_paypal_markup_percent"
                                name="praktiqu_endpoint_paypal_markup_percent"
                                value="<?php echo esc_attr((string) get_option('praktiqu_endpoint_paypal_markup_percent', '0')); ?>"
                                class="regular-text"
                                placeholder="0"
                            />
                            <p class="description">
                                <?php esc_html_e('Extra percentage added on top of the converted amount, for foreign patients. The FX rate above should stay the honest market rate; put the business markup here. At rate 18000 and markup 10%, a Rp 200.000 service is charged $12.23.', 'praktiqu-endpoint'); ?>
                                <?php
                                $markup_updated = (string) get_option('praktiqu_endpoint_paypal_markup_percent_updated', '');
                                if ($markup_updated !== '') {
                                    echo '<br/>' . esc_html(sprintf(
                                        /* translators: %s is an ISO-8601 timestamp. */
                                        __('Last changed: %s', 'praktiqu-endpoint'),
                                        $markup_updated
                                    ));
                                }
                                ?>
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
                <li><code>POST /payments/order</code> — create a WooCommerce order for an appointment/bill</li>
                <li><code>GET  /payments/order/{id}</code> — read WooCommerce order status</li>
            </ul>
        </div>
        <?php
    }
}
