<?php
/**
 * ClinicPaymentSettings — one clinic's international payment settings
 * (2026-10-06 international clinic payment design, §1 and §4).
 *
 * Stored as ONE wp_options row per clinic, `praktiqu_endpoint_clinic_{id}_payment`,
 * autoload off. The value is a JSON **string**, never a PHP array: WordPress would
 * maybe_serialize() an array into `a:6:{…}`, which Next.js (it reads the row through
 * the KcOption model and JSON.parse) cannot parse, and every clinic would silently
 * stop being international.
 *
 * validate(), encode() and decode() are pure, so tests/test-clinic-payment-settings.php
 * runs them in a bare PHP container — the same pattern, and the same reason, as Money.
 * get(), save() and clinic_exists() are the thin WordPress-backed wrappers.
 *
 * @package PraktiQU\Endpoint
 */

declare(strict_types=1);

namespace PraktiQU\Endpoint;

// The test harness defines PRAKTIQU_ENDPOINT_CLINIC_PAYMENT_SETTINGS_TEST so this file
// can be required outside WordPress. Everything else still exits without ABSPATH.
defined('ABSPATH') || defined('PRAKTIQU_ENDPOINT_CLINIC_PAYMENT_SETTINGS_TEST') || exit;

final class ClinicPaymentSettings
{
    public const OPTION_PREFIX = 'praktiqu_endpoint_clinic_';
    public const OPTION_SUFFIX = '_payment';

    /** A usable rate is rupiah per 1 USD within this range, for the clinic and the global value alike. */
    public const RATE_MIN   = 1000.0;
    public const RATE_MAX   = 100000.0;
    public const MARKUP_MAX = 100.0;
    public const FEE_MAX    = 10000000;

    public const GLOBAL_RATE_OPTION = 'praktiqu_endpoint_paypal_idr_rate';

    public static function option_name(int $clinic_id): string
    {
        return self::OPTION_PREFIX . $clinic_id . self::OPTION_SUFFIX;
    }

    /**
     * A rate is usable when it is numeric and within RATE_MIN..RATE_MAX. The range rejects
     * an inverted or mistyped entry, such as 0.00006, or "16.500" read as 16.5.
     *
     * "Numeric" is an int/float, or a string that is plain decimal text after trim() — the
     * exact text Next.js accepts for the global option (parseOptionNumber in
     * intl-pricing.ts). is_numeric() is not used: it also passes "1.8e4" or "18000.", which
     * Next.js reads as "not set", and the two sides would then disagree on whether a usable
     * global rate exists (spec §1: one definition of a usable rate).
     */
    public static function is_usable_rate(mixed $v): bool
    {
        if (is_string($v)) {
            $text = trim($v);
            if (preg_match('/^\d+(\.\d+)?$/D', $text) !== 1) {
                return false;
            }
            $rate = (float) $text;
        } elseif (is_int($v) || is_float($v)) {
            $rate = (float) $v;
        } else {
            return false;
        }
        return $rate >= self::RATE_MIN && $rate <= self::RATE_MAX;
    }

    /**
     * Validate a PUT body (storage keys) against the §1 rules.
     *
     * Every key is required: a PUT replaces the clinic's whole object, so a missing key
     * is a client bug, not "leave unchanged". `fx_rate` / `markup_percent` must be JSON
     * numbers (never numeric strings), `fixed_fee_idr` and `updated_by` JSON integers.
     *
     * @param array<string, mixed> $input
     * @param mixed                $global_rate The raw global rate option ('' when unset).
     *
     * @return array{ok: true, data: array{international: bool, fx_rate: ?float, markup_percent: ?float, fixed_fee_idr: ?int, updated_by: ?int}}
     *        |array{ok: false, code: string, message: string, field: ?string}
     */
    public static function validate(array $input, mixed $global_rate): array
    {
        foreach (['international', 'fx_rate', 'markup_percent', 'fixed_fee_idr', 'updated_by'] as $key) {
            if (!array_key_exists($key, $input)) {
                return self::invalid($key, sprintf('%s is required', $key));
            }
        }

        $international = $input['international'];
        if (!is_bool($international)) {
            return self::invalid('international', 'international must be a boolean');
        }

        $fx_rate = $input['fx_rate'];
        if ($fx_rate !== null) {
            if (!self::is_number($fx_rate) || $fx_rate < self::RATE_MIN || $fx_rate > self::RATE_MAX || !self::has_at_most_2_decimals($fx_rate)) {
                return self::invalid('fx_rate', 'fx_rate must be null or a number from 1000 to 100000 with at most 2 decimals');
            }
            $fx_rate = (float) $fx_rate;
        }

        $markup = $input['markup_percent'];
        if ($markup !== null) {
            if (!self::is_number($markup) || $markup < 0 || $markup > self::MARKUP_MAX || !self::has_at_most_2_decimals($markup)) {
                return self::invalid('markup_percent', 'markup_percent must be null or a number from 0 to 100 with at most 2 decimals');
            }
            $markup = (float) $markup;
        }

        $fee = $input['fixed_fee_idr'];
        if ($fee !== null && (!is_int($fee) || $fee < 0 || $fee > self::FEE_MAX)) {
            return self::invalid('fixed_fee_idr', 'fixed_fee_idr must be null or an integer from 0 to 10000000');
        }

        $updated_by = $input['updated_by'];
        if ($updated_by !== null && (!is_int($updated_by) || $updated_by <= 0)) {
            return self::invalid('updated_by', 'updated_by must be null or a positive integer');
        }

        // Cross-field: an international clinic needs a usable rate, its own or the global one.
        // A non-null clinic fx_rate is already in range here, so it is usable by construction.
        if ($international && $fx_rate === null && !self::is_usable_rate($global_rate)) {
            return [
                'ok'      => false,
                'code'    => 'fx_rate_required',
                'message' => 'An international clinic needs an FX rate: set fx_rate, or set a global rate from 1000 to 100000',
                'field'   => 'fx_rate',
            ];
        }

        return [
            'ok'   => true,
            'data' => [
                'international'  => $international,
                'fx_rate'        => $fx_rate,
                'markup_percent' => $markup,
                'fixed_fee_idr'  => $fee,
                'updated_by'     => $updated_by,
            ],
        ];
    }

    /**
     * The stored JSON string, keys in the §1 order, with updated_at stamped in.
     *
     * @param array<string, mixed> $data validate()'s `data`.
     */
    public static function encode(array $data, string $updated_at): string
    {
        $payload = [
            'international'  => (bool) ($data['international'] ?? false),
            'fx_rate'        => $data['fx_rate'] ?? null,
            'markup_percent' => $data['markup_percent'] ?? null,
            'fixed_fee_idr'  => $data['fixed_fee_idr'] ?? null,
            'updated_at'     => $updated_at,
            'updated_by'     => $data['updated_by'] ?? null,
        ];
        $json = function_exists('wp_json_encode') ? wp_json_encode($payload) : json_encode($payload);
        if (!is_string($json)) {
            // Unreachable for validate()d data (no INF/NAN, ASCII timestamp). Throwing beats
            // storing something Next.js would read as "not international" without a trace.
            throw new \RuntimeException('Clinic payment settings could not be JSON-encoded');
        }
        return $json;
    }

    /**
     * Decode a stored option value. Anything other than a string holding a JSON object is
     * malformed and yields null — including a PHP array, which is what get_option() returns
     * for a serialized `a:…` value.
     *
     * @return array<string, mixed>|null
     */
    public static function decode(mixed $raw): ?array
    {
        if (!is_string($raw)) {
            return null;
        }
        $trimmed = trim($raw);
        if ($trimmed === '' || $trimmed[0] !== '{') {
            return null;
        }
        $decoded = json_decode($trimmed, true);
        return is_array($decoded) ? $decoded : null;
    }

    /**
     * @return array<string, mixed>|null The decoded option, or null when absent or malformed.
     */
    public static function get(int $clinic_id): ?array
    {
        return self::decode(get_option(self::option_name($clinic_id), ''));
    }

    /**
     * Write the clinic's whole object, autoload off.
     *
     * update_option() returns false both on a database failure and when the new value
     * equals the stored one. The second case (an identical re-save in the same second)
     * is a success, so a false return is re-checked against what is stored now.
     *
     * @param array<string, mixed> $data validate()'s `data`.
     */
    public static function save(int $clinic_id, array $data): bool
    {
        $name = self::option_name($clinic_id);
        $json = self::encode($data, gmdate('c'));
        if (update_option($name, $json, false)) {
            return true;
        }
        return get_option($name, '') === $json;
    }

    public static function clinic_exists(int $clinic_id): bool
    {
        if ($clinic_id <= 0) {
            return false;
        }
        global $wpdb;
        $found = $wpdb->get_var($wpdb->prepare(
            "SELECT id FROM {$wpdb->prefix}kc_clinics WHERE id = %d LIMIT 1",
            $clinic_id
        ));
        return $found !== null;
    }

    private static function is_number(mixed $v): bool
    {
        return (is_int($v) || is_float($v)) && is_finite((float) $v);
    }

    /** Checked on the scaled value with a tolerance, never with fmod or an is-integer test. */
    private static function has_at_most_2_decimals(int|float $v): bool
    {
        $scaled = $v * 100;
        return abs(round($scaled) - $scaled) < 1e-6;
    }

    /** @return array{ok: false, code: string, message: string, field: ?string} */
    private static function invalid(string $field, string $message): array
    {
        return ['ok' => false, 'code' => 'invalid_settings', 'message' => $message, 'field' => $field];
    }
}
