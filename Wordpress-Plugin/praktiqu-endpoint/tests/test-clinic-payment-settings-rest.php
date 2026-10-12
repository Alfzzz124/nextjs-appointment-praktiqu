<?php
/**
 * Assertions for REST_Controller::handle_get_clinic_payment_settings() and
 * ::handle_put_clinic_payment_settings(). Plain PHP — no PHPUnit, no real WordPress — runs in
 * a bare `php:8.4-cli` container, same as the other files in this directory.
 *
 * The harness loads the real classes unmodified, like test-service-authenticate.php:
 *   - ABSPATH is defined so the files' `defined('ABSPATH') || exit;` guards pass;
 *   - WP_Error, WP_REST_Request, WP_REST_Response, get_option()/update_option() and $wpdb are
 *     shimmed over plain arrays, with update_option()'s real "unchanged value -> false" rule;
 *   - the controller is built with ReflectionClass::newInstanceWithoutConstructor(): the two
 *     handlers under test use none of its ten injected services;
 *   - gmdate() is frozen inside the plugin namespace, so updated_at is deterministic.
 */

declare(strict_types=1);

namespace PraktiQU\Endpoint {
    function gmdate(string $format, ?int $timestamp = null): string
    {
        return '2026-10-06T08:00:00+00:00';
    }
}

namespace {
    use PraktiQU\Endpoint\REST_Controller;

    define('ABSPATH', __DIR__ . '/');

    final class WP_Error
    {
        public function __construct(public string $code = '', public string $message = '', public mixed $data = null)
        {
        }

        public function get_error_code(): string
        {
            return $this->code;
        }

        public function get_error_data(): mixed
        {
            return $this->data;
        }
    }

    final class WP_REST_Response
    {
        public function __construct(public mixed $data = null, public int $status = 200)
        {
        }

        public function get_data(): mixed
        {
            return $this->data;
        }

        public function get_status(): int
        {
            return $this->status;
        }
    }

    final class WP_REST_Request
    {
        /** @param array<string, mixed> $url_params */
        public function __construct(private array $url_params, private mixed $json = null)
        {
        }

        public function get_param(string $key): mixed
        {
            return $this->url_params[$key] ?? null;
        }

        public function get_json_params(): mixed
        {
            return $this->json;
        }
    }

    function is_wp_error($thing): bool
    {
        return $thing instanceof WP_Error;
    }

    $GLOBALS['__praktiqu_test_options']  = [];
    $GLOBALS['__praktiqu_update_broken'] = false;
    $GLOBALS['__praktiqu_encode_broken'] = false;

    /**
     * wp_json_encode() as WordPress has it: json_encode() that answers false when it cannot
     * encode. The flag makes it fail, which is the one way ClinicPaymentSettings::encode()
     * throws (a RuntimeException) from inside ::save().
     */
    function wp_json_encode($value, int $flags = 0, int $depth = 512)
    {
        return $GLOBALS['__praktiqu_encode_broken'] ? false : json_encode($value, $flags, $depth);
    }

    function get_option(string $name, $default = false)
    {
        return array_key_exists($name, $GLOBALS['__praktiqu_test_options'])
            ? $GLOBALS['__praktiqu_test_options'][$name]
            : $default;
    }

    function update_option(string $name, $value, $autoload = null): bool
    {
        if ($GLOBALS['__praktiqu_update_broken']) {
            return false;
        }
        if (array_key_exists($name, $GLOBALS['__praktiqu_test_options'])
            && $GLOBALS['__praktiqu_test_options'][$name] === $value) {
            return false;
        }
        $GLOBALS['__praktiqu_test_options'][$name] = $value;
        return true;
    }

    final class FakeWpdb
    {
        public string $prefix = 'wp_';

        public function prepare(string $query, ...$args): string
        {
            return vsprintf($query, $args);
        }

        public function get_var(string $query)
        {
            if (preg_match('/FROM wp_kc_clinics WHERE id = (\d+)/', $query, $m) === 1) {
                return in_array((int) $m[1], [4, 5, 7], true) ? $m[1] : null;
            }
            return null;
        }
    }

    $wpdb = new FakeWpdb();

    require_once __DIR__ . '/../includes/class-praktiqu-endpoint-clinic-payment-settings.php';
    require_once __DIR__ . '/../includes/class-praktiqu-endpoint-rest-controller.php';

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

    /** @var REST_Controller $controller */
    $controller = (new ReflectionClass(REST_Controller::class))->newInstanceWithoutConstructor();

    /** [status, code-or-body] of a handler result. */
    function put(int $clinic_id, mixed $json): array
    {
        global $controller;
        $result = $controller->handle_put_clinic_payment_settings(new WP_REST_Request(['id' => $clinic_id], $json));
        if ($result instanceof WP_Error) {
            return [$result->get_error_data()['status'] ?? null, $result->get_error_code(), $result->get_error_data()['field'] ?? null];
        }
        return [$result->get_status(), $result->get_data()];
    }

    function get(int $clinic_id): array
    {
        global $controller;
        $result = $controller->handle_get_clinic_payment_settings(new WP_REST_Request(['id' => $clinic_id]));
        return [$result->get_status(), $result->get_data()];
    }

    $body = [
        'international'  => true,
        'fx_rate'        => 18000,
        'markup_percent' => 10,
        'fixed_fee_idr'  => 25000,
        'updated_by'     => 123,
    ];
    $saved = [
        'international'  => true,
        'fx_rate'        => 18000,
        'markup_percent' => 10,
        'fixed_fee_idr'  => 25000,
        'updated_at'     => '2026-10-06T08:00:00+00:00',
        'updated_by'     => 123,
    ];

    echo "PUT /clinics/{id}/payment-settings\n";
    check('unknown clinic -> 404 clinic_not_found', put(99, $body), [404, 'clinic_not_found', null]);
    check('unknown clinic writes no option', array_key_exists('praktiqu_endpoint_clinic_99_payment', $GLOBALS['__praktiqu_test_options']), false);

    check('valid body -> 200 with the decoded option', put(4, $body), [200, ['clinicId' => 4, 'settings' => $saved]]);
    $raw = $GLOBALS['__praktiqu_test_options']['praktiqu_endpoint_clinic_4_payment'] ?? null;
    check('stored value is a JSON string beginning with {', is_string($raw) && $raw[0] === '{', true);
    check('stored value json_decodes to the saved object', json_decode((string) $raw, true), $saved);
    check('identical re-save -> 200', put(4, $body), [200, ['clinicId' => 4, 'settings' => $saved]]);

    check('markup 150 -> 400 invalid_settings on markup_percent', put(4, array_merge($body, ['markup_percent' => 150])), [400, 'invalid_settings', 'markup_percent']);
    check('a rejected PUT leaves the stored value alone', $GLOBALS['__praktiqu_test_options']['praktiqu_endpoint_clinic_4_payment'], $raw);
    check('no JSON body -> 400 invalid_settings', put(4, null), [400, 'invalid_settings', 'international']);
    check('updated_by "123" -> 400 invalid_settings', put(4, array_merge($body, ['updated_by' => '123'])), [400, 'invalid_settings', 'updated_by']);

    check('international, no rate anywhere -> 422 fx_rate_required', put(5, array_merge($body, ['fx_rate' => null])), [422, 'fx_rate_required', 'fx_rate']);
    $GLOBALS['__praktiqu_test_options']['praktiqu_endpoint_paypal_idr_rate'] = '500000';
    check('global rate out of range -> 422 fx_rate_required', put(5, array_merge($body, ['fx_rate' => null])), [422, 'fx_rate_required', 'fx_rate']);
    $GLOBALS['__praktiqu_test_options']['praktiqu_endpoint_paypal_idr_rate'] = '18000';
    check('usable global rate -> 200 with fx_rate null', put(5, array_merge($body, ['fx_rate' => null])),
        [200, ['clinicId' => 5, 'settings' => array_merge($saved, ['fx_rate' => null])]]);

    $GLOBALS['__praktiqu_update_broken'] = true;
    check('a failed write -> 500 save_failed', put(7, $body), [500, 'save_failed', null]);
    $GLOBALS['__praktiqu_update_broken'] = false;

    $GLOBALS['__praktiqu_encode_broken'] = true;
    try {
        $thrown = put(7, $body);
    } catch (\Throwable $e) {
        $thrown = ['uncaught ' . get_class($e), $e->getMessage(), null];
    }
    check('save() throwing (encode fails) -> 500 save_failed, not an uncaught exception', $thrown, [500, 'save_failed', null]);
    check('a throwing save writes no option', array_key_exists('praktiqu_endpoint_clinic_7_payment', $GLOBALS['__praktiqu_test_options']), false);
    $GLOBALS['__praktiqu_encode_broken'] = false;

    echo "\nGET /clinics/{id}/payment-settings\n";
    check('saved clinic', get(4), [200, ['clinicId' => 4, 'settings' => $saved]]);
    check('no option -> settings null', get(7), [200, ['clinicId' => 7, 'settings' => null]]);
    $GLOBALS['__praktiqu_test_options']['praktiqu_endpoint_clinic_8_payment'] = ['international' => true];
    check('a serialized (array) value -> settings null', get(8), [200, ['clinicId' => 8, 'settings' => null]]);

    echo "\n";
    if ($failures > 0) {
        echo "{$failures} FAILURE(S)\n";
        exit(1);
    }
    echo "ALL PASS\n";
}
