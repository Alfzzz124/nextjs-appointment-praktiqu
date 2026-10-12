<?php
/**
 * Assertions for Settings::sanitize_fx_rate(). Plain PHP — no PHPUnit, no real WordPress —
 * runs in a bare `php:8.4-cli` container, same as tests/test-jobs-secret-sanitizer.php,
 * whose harness this mirrors: ABSPATH is defined so the real class loads unmodified, and the
 * WordPress functions sanitize_fx_rate() touches (get_option, update_option,
 * add_settings_error, __) are shimmed over plain arrays. register()/render_page() are never
 * called.
 */

declare(strict_types=1);

define('ABSPATH', '/tmp/praktiqu-endpoint-test/');

$GLOBALS['__praktiqu_test_options'] = [];
$GLOBALS['__praktiqu_settings_errors'] = [];

function get_option(string $name, $default = false)
{
    return $GLOBALS['__praktiqu_test_options'][$name] ?? $default;
}

function update_option(string $name, $value, $autoload = null): bool
{
    $GLOBALS['__praktiqu_test_options'][$name] = $value;
    return true;
}

function add_settings_error(string $setting, string $code, string $message, string $type = 'error'): void
{
    $GLOBALS['__praktiqu_settings_errors'][] = $code;
}

function __(string $text, string $domain = 'default'): string
{
    return $text;
}

require_once __DIR__ . '/../includes/class-praktiqu-endpoint-clinic-payment-settings.php';
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

/** [returned value, settings errors raised] for one submission over a stored '18000'. */
function submit(string $value): array
{
    $GLOBALS['__praktiqu_test_options']   = ['praktiqu_endpoint_paypal_idr_rate' => '18000'];
    $GLOBALS['__praktiqu_settings_errors'] = [];
    $returned = (new Settings())->sanitize_fx_rate($value);
    return [$returned, $GLOBALS['__praktiqu_settings_errors']];
}

echo "Settings::sanitize_fx_rate accepts 1,000 to 100,000\n";
check('16500', submit('16500'), ['16500', []]);
check('lower bound 1000', submit('1000'), ['1000', []]);
check('upper bound 100000', submit('100000'), ['100000', []]);
check('a 2-decimal rate', submit('16500.50'), ['16500.50', []]);
check('surrounding spaces are trimmed', submit(' 17000 '), ['17000', []]);

echo "\nSettings::sanitize_fx_rate rejects anything else and keeps the stored rate\n";
check('16.5 ("16.500" read as 16.5)', submit('16.5'), ['18000', ['praktiqu_invalid_fx_rate']]);
check('999.99', submit('999.99'), ['18000', ['praktiqu_invalid_fx_rate']]);
check('100000.01', submit('100000.01'), ['18000', ['praktiqu_invalid_fx_rate']]);
check('500000', submit('500000'), ['18000', ['praktiqu_invalid_fx_rate']]);
check('0.00006 (inverted)', submit('0.00006'), ['18000', ['praktiqu_invalid_fx_rate']]);
check('0', submit('0'), ['18000', ['praktiqu_invalid_fx_rate']]);
check('blank', submit(''), ['18000', ['praktiqu_invalid_fx_rate']]);
check('not a number', submit('abc'), ['18000', ['praktiqu_invalid_fx_rate']]);
check('1.8e4 (is_numeric, but Next.js reads it as unset)', submit('1.8e4'), ['18000', ['praktiqu_invalid_fx_rate']]);
check('18000. (trailing dot)', submit('18000.'), ['18000', ['praktiqu_invalid_fx_rate']]);
check('16500.123 (more than 2 decimals)', submit('16500.123'), ['18000', ['praktiqu_invalid_fx_rate']]);

echo "\nSettings::sanitize_fx_rate stamps a real change only\n";
submit('16500');
check('a changed rate stamps _updated', isset($GLOBALS['__praktiqu_test_options']['praktiqu_endpoint_paypal_idr_rate_updated']), true);
submit('18000');
check('re-submitting the stored rate does not stamp', isset($GLOBALS['__praktiqu_test_options']['praktiqu_endpoint_paypal_idr_rate_updated']), false);
submit('16.5');
check('a rejected rate does not stamp', isset($GLOBALS['__praktiqu_test_options']['praktiqu_endpoint_paypal_idr_rate_updated']), false);

echo "\n";
if ($failures > 0) {
    echo "{$failures} FAILURE(S)\n";
    exit(1);
}
echo "ALL PASS\n";
