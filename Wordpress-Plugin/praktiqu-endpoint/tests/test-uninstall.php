<?php
/**
 * Assertions for uninstall.php. Plain PHP — no PHPUnit, no real WordPress — runs in a bare
 * `php:8.4-cli` container, same as the other files in this directory.
 *
 * uninstall.php runs top to bottom when required, so the harness defines
 * WP_UNINSTALL_PLUGIN, shims delete_option()/delete_transient(), and gives it a fake $wpdb
 * whose get_col() evaluates the LIKE pattern the way MySQL does (`%` = any run, `_` = any one
 * character, a backslash escapes either). That is what proves the underscores are escaped:
 * an unescaped pattern would also match `praktiqu-endpoint-clinic-4-payment`.
 */

declare(strict_types=1);

define('WP_UNINSTALL_PLUGIN', 'praktiqu-endpoint/praktiqu-endpoint.php');

$GLOBALS['__deleted_options']    = [];
$GLOBALS['__deleted_transients'] = [];

function delete_option(string $name): bool
{
    $GLOBALS['__deleted_options'][] = $name;
    return true;
}

function delete_transient(string $name): bool
{
    $GLOBALS['__deleted_transients'][] = $name;
    return true;
}

final class FakeWpdb
{
    public string $options = 'wp_options';
    /** @var list<string> */
    public array $option_names = [
        'praktiqu_endpoint_clinic_4_payment',
        'praktiqu_endpoint_clinic_12_payment',
        'praktiqu_endpoint_clinic_4_payment_backup',
        'praktiqu-endpoint-clinic-4-payment',
        'praktiqu_endpoint_paypal_idr_rate',
        'kivicare_clinic_notifications_enabled_4',
    ];

    public function esc_like(string $text): string
    {
        return addcslashes($text, '_%\\');
    }

    public function prepare(string $query, ...$args): string
    {
        // A callback, not a replacement string: preg_replace() would eat the backslashes.
        return preg_replace_callback('/%s/', static function () use (&$args): string {
            return "'" . addslashes((string) array_shift($args)) . "'";
        }, $query);
    }

    /** @return list<string> */
    public function get_col(string $query): array
    {
        if (preg_match("/^SELECT option_name FROM wp_options WHERE option_name LIKE '(.*)'$/", $query, $m) !== 1) {
            return [];
        }
        $like  = stripslashes($m[1]); // undo prepare()'s addslashes
        $regex = '';
        for ($i = 0, $n = strlen($like); $i < $n; $i++) {
            $c = $like[$i];
            if ($c === '\\' && $i + 1 < $n) {
                $regex .= preg_quote($like[++$i], '/');
            } elseif ($c === '%') {
                $regex .= '.*';
            } elseif ($c === '_') {
                $regex .= '.';
            } else {
                $regex .= preg_quote($c, '/');
            }
        }
        return array_values(array_filter($this->option_names, static fn (string $name): bool => preg_match('/^' . $regex . '$/s', $name) === 1));
    }
}

$wpdb = new FakeWpdb();

require __DIR__ . '/../uninstall.php';

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

$deleted = $GLOBALS['__deleted_options'];

echo "uninstall.php\n";
check('deletes clinic 4 payment settings', in_array('praktiqu_endpoint_clinic_4_payment', $deleted, true), true);
check('deletes clinic 12 payment settings', in_array('praktiqu_endpoint_clinic_12_payment', $deleted, true), true);
check('keeps a name that only starts like one', in_array('praktiqu_endpoint_clinic_4_payment_backup', $deleted, true), false);
check('underscores are escaped (a dashed name is kept)', in_array('praktiqu-endpoint-clinic-4-payment', $deleted, true), false);
check('keeps KiviCare\'s own per-clinic option', in_array('kivicare_clinic_notifications_enabled_4', $deleted, true), false);
check('still deletes the global rate option', in_array('praktiqu_endpoint_paypal_idr_rate', $deleted, true), true);
check('still deletes the activation notice transient', $GLOBALS['__deleted_transients'], ['praktiqu_endpoint_activation_notice']);

echo "\n";
if ($failures > 0) {
    echo "{$failures} FAILURE(S)\n";
    exit(1);
}
echo "ALL PASS\n";
