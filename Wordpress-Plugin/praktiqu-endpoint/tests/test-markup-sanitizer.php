<?php
/**
 * Assertions for Settings::sanitize_markup_percent(). Plain PHP — no PHPUnit, no real
 * WordPress — runs in a bare `php:8.4-cli` container, same harness as
 * tests/test-fx-rate-sanitizer.php: ABSPATH is defined so the real class loads unmodified,
 * and the WordPress functions the method touches (get_option, update_option,
 * add_settings_error, __) are shimmed over plain arrays.
 *
 * The accepted text is exactly what ClinicPaymentSettings::is_usable_markup() accepts after
 * trim(): digits with at most 2 decimals, 0 to 100. is_numeric() is not the rule — it passes
 * "1e1", ".5", "+10" and "10.", which Next.js reads as "not set" or as a different number.
 */

declare(strict_types=1);

define('ABSPATH', '/tmp/praktiqu-endpoint-test/');

$GLOBALS['__praktiqu_test_options'] = [];
$GLOBALS['__praktiqu_settings_errors'] = [];
$GLOBALS['__praktiqu_settings_messages'] = [];

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
    $GLOBALS['__praktiqu_settings_messages'][] = $message;
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

/** [returned value, settings errors raised] for one submission over a stored '10'. */
function submit(string $value): array
{
    $GLOBALS['__praktiqu_test_options']   = ['praktiqu_endpoint_paypal_markup_percent' => '10'];
    $GLOBALS['__praktiqu_settings_errors'] = [];
    $GLOBALS['__praktiqu_settings_messages'] = [];
    $returned = (new Settings())->sanitize_markup_percent($value);
    return [$returned, $GLOBALS['__praktiqu_settings_errors']];
}

echo "Settings::sanitize_markup_percent accepts digits from 0 to 100, at most 2 decimals\n";
check('10', submit('10'), ['10', []]);
check('lower bound 0', submit('0'), ['0', []]);
check('upper bound 100', submit('100'), ['100', []]);
check('100.00', submit('100.00'), ['100.00', []]);
check('a 1-decimal markup', submit('4.4'), ['4.4', []]);
check('a 2-decimal markup', submit('12.75'), ['12.75', []]);
check('surrounding spaces are trimmed (stored trimmed)', submit(' 4.4 '), ['4.4', []]);

echo "\nSettings::sanitize_markup_percent rejects anything else and keeps the stored markup\n";
$rejected = [
    '1e1 (is_numeric, but Next.js cannot parse it)' => '1e1',
    '.5 (no leading digit)'                         => '.5',
    '+10 (explicit plus)'                           => '+10',
    '10. (trailing dot)'                            => '10.',
    '10.123 (more than 2 decimals)'                 => '10.123',
    '101 (above 100)'                               => '101',
    '100.01 (above 100)'                            => '100.01',
    '-1 (below 0)'                                  => '-1',
    '10,5 (decimal comma)'                          => '10,5',
    'blank'                                         => '',
    'only spaces'                                   => '   ',
    'not a number'                                  => 'abc',
    '10% (percent sign)'                            => '10%',
];
foreach ($rejected as $label => $value) {
    check($label, submit($value), ['10', ['praktiqu_invalid_markup_percent']]);
}

echo "\nSettings::sanitize_markup_percent explains the rule in the notice\n";
submit('1e1');
$message = $GLOBALS['__praktiqu_settings_messages'][0] ?? '';
check('notice says digits only, from 0 to 100, at most 2 decimals', str_contains($message, 'digits only, from 0 to 100, at most 2 decimals'), true);

echo "\nSettings::sanitize_markup_percent stamps a real change only\n";
submit('5');
check('a changed markup stamps _updated', isset($GLOBALS['__praktiqu_test_options']['praktiqu_endpoint_paypal_markup_percent_updated']), true);
submit('10');
check('re-submitting the stored markup does not stamp', isset($GLOBALS['__praktiqu_test_options']['praktiqu_endpoint_paypal_markup_percent_updated']), false);
submit('1e1');
check('a rejected markup does not stamp', isset($GLOBALS['__praktiqu_test_options']['praktiqu_endpoint_paypal_markup_percent_updated']), false);

echo "\n";
if ($failures > 0) {
    echo "{$failures} FAILURE(S)\n";
    exit(1);
}
echo "ALL PASS\n";
