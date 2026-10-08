<?php
/**
 * Assertions for ClinicPaymentSettings. Plain PHP — no PHPUnit, no WordPress — so it runs
 * in a bare `php:8.4-cli` container, same as tests/test-money.php.
 *
 * validate(), encode() and decode() are pure and are called directly. get(), save() and
 * clinic_exists() are WordPress-backed, so this harness shims exactly what they touch:
 *   - get_option()/update_option() over a plain array, with update_option()'s real
 *     contract (returns false, writing nothing, when the value is unchanged);
 *   - a fake $wpdb with prepare()/get_var() over a list of clinic ids;
 *   - gmdate() inside the plugin's namespace, so save()'s timestamp is frozen and an
 *     identical re-save is deterministic. An unqualified gmdate() call in namespace
 *     PraktiQU\Endpoint resolves to this function before the global one.
 */

declare(strict_types=1);

namespace PraktiQU\Endpoint {
    function gmdate(string $format, ?int $timestamp = null): string
    {
        return $GLOBALS['__praktiqu_frozen_now'] ?? \gmdate($format, $timestamp ?? time());
    }
}

namespace {
    use PraktiQU\Endpoint\ClinicPaymentSettings as S;

    define('PRAKTIQU_ENDPOINT_CLINIC_PAYMENT_SETTINGS_TEST', true);

    $GLOBALS['__praktiqu_test_options']  = [];
    $GLOBALS['__praktiqu_test_autoload'] = [];
    $GLOBALS['__praktiqu_update_broken'] = false;

    function get_option(string $name, $default = false)
    {
        return array_key_exists($name, $GLOBALS['__praktiqu_test_options'])
            ? $GLOBALS['__praktiqu_test_options'][$name]
            : $default;
    }

    function update_option(string $name, $value, $autoload = null): bool
    {
        if ($GLOBALS['__praktiqu_update_broken']) {
            return false; // a database failure: nothing written
        }
        if (array_key_exists($name, $GLOBALS['__praktiqu_test_options'])
            && $GLOBALS['__praktiqu_test_options'][$name] === $value) {
            return false; // WordPress: unchanged value, nothing written
        }
        $GLOBALS['__praktiqu_test_options'][$name]  = $value;
        $GLOBALS['__praktiqu_test_autoload'][$name] = $autoload;
        return true;
    }

    final class FakeWpdb
    {
        public string $prefix = 'wp_';
        /** @var list<int> */
        public array $clinic_ids = [4, 7];
        /** @var list<string> */
        public array $queries = [];

        public function prepare(string $query, ...$args): string
        {
            return vsprintf($query, $args);
        }

        public function get_var(string $query)
        {
            $this->queries[] = $query;
            if (preg_match('/FROM wp_kc_clinics WHERE id = (\d+)/', $query, $m) === 1) {
                return in_array((int) $m[1], $this->clinic_ids, true) ? $m[1] : null;
            }
            return null;
        }
    }

    $wpdb = new FakeWpdb();

    require_once __DIR__ . '/../includes/class-praktiqu-endpoint-clinic-payment-settings.php';

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

    /** A complete, valid PUT body; each case overrides one key. */
    function body(array $override = []): array
    {
        return array_merge([
            'international'  => true,
            'fx_rate'        => 16500,
            'markup_percent' => 10,
            'fixed_fee_idr'  => 25000,
            'updated_by'     => 123,
        ], $override);
    }

    /** [code, field] of a failed validate(), or 'ok'. */
    function outcome(array $result)
    {
        return $result['ok'] ? 'ok' : [$result['code'], $result['field']];
    }

    echo "ClinicPaymentSettings::option_name\n";
    check('clinic 4', S::option_name(4), 'praktiqu_endpoint_clinic_4_payment');

    echo "\nClinicPaymentSettings::is_usable_rate\n";
    check('16500 int', S::is_usable_rate(16500), true);
    check('"18000" (how the global option is stored)', S::is_usable_rate('18000'), true);
    check('lower bound 1000', S::is_usable_rate(1000), true);
    check('upper bound 100000', S::is_usable_rate(100000.0), true);
    check('16.5 ("16.500" read as 16.5)', S::is_usable_rate(16.5), false);
    check('500000', S::is_usable_rate(500000), false);
    check('0.00006 (inverted)', S::is_usable_rate(0.00006), false);
    check('empty string (option unset)', S::is_usable_rate(''), false);
    check('null', S::is_usable_rate(null), false);
    check('true', S::is_usable_rate(true), false);
    // The string rule is Next.js parseOptionNumber's: plain digits, optional decimal part.
    // is_numeric() would accept the next two, which Next.js reads as "not set".
    check('"1.8e4" (exponent notation)', S::is_usable_rate('1.8e4'), false);
    check('"18000." (trailing dot)', S::is_usable_rate('18000.'), false);
    check('" 18000 " (trimmed, as Next.js trims)', S::is_usable_rate(' 18000 '), true);
    // A usable rate has at most 2 decimals, the same limit validate() puts on a clinic's fx_rate.
    check('"16500.12" (2 decimals)', S::is_usable_rate('16500.12'), true);
    check('"16500.123" (3 decimals)', S::is_usable_rate('16500.123'), false);
    check('16500.123 (float, 3 decimals)', S::is_usable_rate(16500.123), false);

    echo "\nClinicPaymentSettings::validate accepts\n";
    $ok = S::validate(body(), '');
    check('the §1 example, no global rate needed', outcome($ok), 'ok');
    check('normalised data', $ok['data'], [
        'international'  => true,
        'fx_rate'        => 16500.0,
        'markup_percent' => 10.0,
        'fixed_fee_idr'  => 25000,
        'updated_by'     => 123,
    ]);
    check('2-decimal rate and markup', outcome(S::validate(body(['fx_rate' => 16500.25, 'markup_percent' => 1.1]), '')), 'ok');
    check('all-null fields, not international', outcome(S::validate(body([
        'international' => false, 'fx_rate' => null, 'markup_percent' => null, 'fixed_fee_idr' => null, 'updated_by' => null,
    ]), '')), 'ok');
    check('international with a null rate falls back to a usable global rate', outcome(S::validate(body(['fx_rate' => null]), '18000')), 'ok');
    check('fee 0 and markup 0', outcome(S::validate(body(['fixed_fee_idr' => 0, 'markup_percent' => 0]), '')), 'ok');
    check('not international: a null rate is not required', outcome(S::validate(body(['international' => false, 'fx_rate' => null]), '')), 'ok');

    echo "\nClinicPaymentSettings::validate rejects\n";
    $missing = body();
    unset($missing['updated_by']);
    check('a missing key', outcome(S::validate($missing, '')), ['invalid_settings', 'updated_by']);
    check('international as a string', outcome(S::validate(body(['international' => 'true']), '')), ['invalid_settings', 'international']);
    check('international as 1', outcome(S::validate(body(['international' => 1]), '')), ['invalid_settings', 'international']);
    check('fx_rate below 1000', outcome(S::validate(body(['fx_rate' => 999.99]), '')), ['invalid_settings', 'fx_rate']);
    check('fx_rate 16.5', outcome(S::validate(body(['fx_rate' => 16.5]), '')), ['invalid_settings', 'fx_rate']);
    check('fx_rate above 100000', outcome(S::validate(body(['fx_rate' => 100000.01]), '')), ['invalid_settings', 'fx_rate']);
    check('fx_rate with 3 decimals', outcome(S::validate(body(['fx_rate' => 16500.255]), '')), ['invalid_settings', 'fx_rate']);
    check('fx_rate as a numeric string', outcome(S::validate(body(['fx_rate' => '16500']), '')), ['invalid_settings', 'fx_rate']);
    check('markup -1', outcome(S::validate(body(['markup_percent' => -1]), '')), ['invalid_settings', 'markup_percent']);
    check('markup 100.5', outcome(S::validate(body(['markup_percent' => 100.5]), '')), ['invalid_settings', 'markup_percent']);
    check('markup with 3 decimals', outcome(S::validate(body(['markup_percent' => 1.125]), '')), ['invalid_settings', 'markup_percent']);
    check('fee as a float', outcome(S::validate(body(['fixed_fee_idr' => 25000.5]), '')), ['invalid_settings', 'fixed_fee_idr']);
    check('fee negative', outcome(S::validate(body(['fixed_fee_idr' => -1]), '')), ['invalid_settings', 'fixed_fee_idr']);
    check('fee above 10,000,000', outcome(S::validate(body(['fixed_fee_idr' => 10000001]), '')), ['invalid_settings', 'fixed_fee_idr']);
    check('updated_by 0', outcome(S::validate(body(['updated_by' => 0]), '')), ['invalid_settings', 'updated_by']);
    check('updated_by as a string', outcome(S::validate(body(['updated_by' => '123']), '')), ['invalid_settings', 'updated_by']);
    check('international, no clinic rate, no global rate', outcome(S::validate(body(['fx_rate' => null]), '')), ['fx_rate_required', 'fx_rate']);
    check('international, no clinic rate, global rate out of range', outcome(S::validate(body(['fx_rate' => null]), '500000')), ['fx_rate_required', 'fx_rate']);
    check('international, no clinic rate, global rate 16.5', outcome(S::validate(body(['fx_rate' => null]), '16.5')), ['fx_rate_required', 'fx_rate']);
    check('international, no clinic rate, global rate "1.8e4" (Next.js reads it as unset)', outcome(S::validate(body(['fx_rate' => null]), '1.8e4')), ['fx_rate_required', 'fx_rate']);
    check('a field error wins over fx_rate_required', outcome(S::validate(body(['fx_rate' => null, 'markup_percent' => 150]), '')), ['invalid_settings', 'markup_percent']);

    echo "\nClinicPaymentSettings::encode\n";
    $json = S::encode($ok['data'], '2026-10-06T08:00:00+00:00');
    // This exact string is the shared fixture for the Next.js KcOption integration test.
    check('exact stored string', $json, '{"international":true,"fx_rate":16500,"markup_percent":10,"fixed_fee_idr":25000,"updated_at":"2026-10-06T08:00:00+00:00","updated_by":123}');
    check('a JSON object, not serialized PHP', $json[0], '{');
    check('nulls stay JSON null', S::encode(['international' => false, 'fx_rate' => null, 'markup_percent' => null, 'fixed_fee_idr' => null, 'updated_by' => null], 'T'),
        '{"international":false,"fx_rate":null,"markup_percent":null,"fixed_fee_idr":null,"updated_at":"T","updated_by":null}');
    check('a 2-decimal rate keeps its decimals', S::encode(['international' => true, 'fx_rate' => 16500.25, 'markup_percent' => 1.1, 'fixed_fee_idr' => 0, 'updated_by' => null], 'T'),
        '{"international":true,"fx_rate":16500.25,"markup_percent":1.1,"fixed_fee_idr":0,"updated_at":"T","updated_by":null}');

    echo "\nClinicPaymentSettings::decode\n";
    check('round trip', S::decode($json), [
        'international' => true, 'fx_rate' => 16500, 'markup_percent' => 10, 'fixed_fee_idr' => 25000,
        'updated_at' => '2026-10-06T08:00:00+00:00', 'updated_by' => 123,
    ]);
    check('empty string (option absent)', S::decode(''), null);
    check('false (get_option miss)', S::decode(false), null);
    check('a PHP array (get_option of a serialized value)', S::decode(['international' => true]), null);
    check('serialized text', S::decode('a:1:{s:13:"international";b:1;}'), null);
    check('malformed JSON', S::decode('{"international":'), null);
    check('a JSON list is not an object', S::decode('[true]'), null);
    check('a JSON scalar', S::decode('true'), null);
    check('surrounding whitespace is tolerated', S::decode("  {\"international\":false}\n"), ['international' => false]);

    echo "\nClinicPaymentSettings::save / get (shimmed options)\n";
    $GLOBALS['__praktiqu_frozen_now'] = '2026-10-06T08:00:00+00:00';
    check('get on an absent option is null', S::get(4), null);
    check('first save succeeds', S::save(4, $ok['data']), true);
    $stored = $GLOBALS['__praktiqu_test_options']['praktiqu_endpoint_clinic_4_payment'] ?? null;
    check('stores the encoded string under the clinic key', $stored, $json);
    check('stored value is a string json_decode accepts', is_array(json_decode((string) $stored, true)), true);
    check('autoload is off', $GLOBALS['__praktiqu_test_autoload']['praktiqu_endpoint_clinic_4_payment'] ?? 'unset', false);
    check('get decodes it', S::get(4)['fx_rate'] ?? null, 16500);
    check('identical re-save (update_option returns false) still succeeds', S::save(4, $ok['data']), true);
    $GLOBALS['__praktiqu_update_broken'] = true;
    $GLOBALS['__praktiqu_frozen_now'] = '2026-10-06T08:00:01+00:00';
    check('a failed write of a different value is a failure', S::save(4, $ok['data']), false);
    $GLOBALS['__praktiqu_update_broken'] = false;
    $GLOBALS['__praktiqu_test_options']['praktiqu_endpoint_clinic_7_payment'] = ['international' => true];
    check('get treats a serialized (array) value as absent', S::get(7), null);

    echo "\nClinicPaymentSettings::clinic_exists (fake \$wpdb)\n";
    check('existing clinic', S::clinic_exists(4), true);
    check('query reads the prefixed kc_clinics table', end($wpdb->queries), 'SELECT id FROM wp_kc_clinics WHERE id = 4 LIMIT 1');
    check('unknown clinic', S::clinic_exists(99), false);
    $before = count($wpdb->queries);
    check('id 0 is never a clinic', S::clinic_exists(0), false);
    check('id 0 runs no query', count($wpdb->queries), $before);

    echo "\n";
    if ($failures > 0) {
        echo "{$failures} FAILURE(S)\n";
        exit(1);
    }
    echo "ALL PASS\n";
}
