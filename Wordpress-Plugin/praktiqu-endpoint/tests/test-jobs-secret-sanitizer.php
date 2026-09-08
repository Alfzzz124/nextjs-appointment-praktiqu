<?php
/**
 * Assertions for Settings::sanitize_jobs_secret(). Plain PHP — no PHPUnit, no real
 * WordPress — runs in a bare `php:8.3-cli` container, same as tests/test-money.php and
 * tests/test-jobs-webhook.php.
 *
 * Unlike Jobs_Webhook, class-praktiqu-endpoint-settings.php was NOT designed to be
 * WordPress-free: sanitize_jobs_secret() calls get_option(), and the file's top-level
 * guard is `defined('ABSPATH') || exit;` with no test-bypass constant. So this harness
 * does the minimal thing needed to load the real class unmodified:
 *   - define ABSPATH (any value satisfies the guard — WordPress itself just checks
 *     it's defined, not its value)
 *   - define a get_option() shim backed by a plain array, standing in for wp-db-backed
 *     options
 * No WordPress function related to sanitize_jobs_secret()'s actual logic is faked —
 * get_option() here behaves exactly like the real one for the get/default contract this
 * method relies on. Everything else the class touches (add_action, register_setting,
 * current_user_can, ...) is never invoked, because this harness only instantiates
 * Settings and calls sanitize_jobs_secret() directly — register()/register_settings()/
 * render_page() are never called.
 */

declare(strict_types=1);

define('ABSPATH', '/tmp/praktiqu-endpoint-test/');

$GLOBALS['__praktiqu_test_options'] = [];

function get_option(string $name, $default = false)
{
    return $GLOBALS['__praktiqu_test_options'][$name] ?? $default;
}

require_once __DIR__ . '/../includes/class-praktiqu-endpoint-settings.php';

use PraktiQU\Endpoint\Settings;

$failures = 0;

function check(string $label, $actual, $expected): void
{
    global $failures;
    if ($actual === $expected) {
        echo "  ok   {$label}\n";
        return;
    }
    $failures++;
    echo "  FAIL {$label}\n";
    echo "       expected: " . var_export($expected, true) . "\n";
    echo "       actual:   " . var_export($actual, true) . "\n";
}

$settings = new Settings();

echo "Settings::sanitize_jobs_secret keeps the stored secret on a placeholder submission\n";

$GLOBALS['__praktiqu_test_options'] = [
    'praktiqu_endpoint_jobs_webhook_secret' => 'rahasia-jobs-lama',
];
check('empty submission keeps the stored secret', $settings->sanitize_jobs_secret(''), 'rahasia-jobs-lama');
check('8 asterisks keeps the stored secret', $settings->sanitize_jobs_secret('********'), 'rahasia-jobs-lama');
check('27 asterisks keeps the stored secret (the 2026-09-01 bug shape)', $settings->sanitize_jobs_secret(str_repeat('*', 27)), 'rahasia-jobs-lama');

echo "Settings::sanitize_jobs_secret rotates on a real submission\n";

check('a new value is stored verbatim', $settings->sanitize_jobs_secret('rahasia-jobs-baru'), 'rahasia-jobs-baru');
check('a value with an asterisk in the middle is not treated as a placeholder', $settings->sanitize_jobs_secret('rahasia*baru'), 'rahasia*baru');

echo "Settings::sanitize_jobs_secret falls back to its own option, not a sibling's\n";

$GLOBALS['__praktiqu_test_options'] = [
    'praktiqu_endpoint_webhook_secret'         => 'general-secret',
    'praktiqu_endpoint_payment_webhook_secret' => 'payment-secret',
    'praktiqu_endpoint_jobs_webhook_secret'    => 'jobs-secret',
];
check('placeholder submission reads the jobs option, not the general one', $settings->sanitize_jobs_secret(''), 'jobs-secret');
check('placeholder submission reads the jobs option, not the payment one', $settings->sanitize_jobs_secret('********'), 'jobs-secret');

echo "Settings::sanitize_jobs_secret with nothing stored yet\n";

$GLOBALS['__praktiqu_test_options'] = [];
check('placeholder submission with no stored option yields empty string', $settings->sanitize_jobs_secret(''), '');

echo "\n";
if ($failures > 0) {
    echo "{$failures} FAILURE(S)\n";
    exit(1);
}
echo "ALL PASS\n";
