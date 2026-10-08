<?php
/**
 * ChargeValidator — checks the USD `charge` object Next.js sends to create_order
 * (2026-10-06 international clinic payment design, §4 step 1).
 *
 * Next.js computes every USD amount (one TypeScript function produces both the displayed
 * and the charged figures); the plugin only builds the WooCommerce order from the finished
 * lines. So this class never converts currency. It checks the shape, turns every amount
 * into integer cents FROM THE STRING (never through `(float) × 100`), and requires the
 * lines to sum to the total exactly. Floats are never summed or compared.
 *
 * Pure — no WordPress, no WooCommerce — so tests/test-charge-validator.php runs it in a
 * bare PHP container. It uses ClinicPaymentSettings' pure range constants for the snapshot.
 *
 * @package PraktiQU\Endpoint
 */

declare(strict_types=1);

namespace PraktiQU\Endpoint;

// The test harness defines PRAKTIQU_ENDPOINT_CHARGE_VALIDATOR_TEST so this file can be
// required outside WordPress. Everything else still exits without ABSPATH.
defined('ABSPATH') || defined('PRAKTIQU_ENDPOINT_CHARGE_VALIDATOR_TEST') || exit;

final class ChargeValidator
{
    private const SOURCES = ['clinic', 'global', 'default'];

    /**
     * "12.23" -> 1223. Only a string of digits, a dot and exactly two digits is accepted
     * (the `D` modifier stops `$` from matching before a trailing newline). A JSON number,
     * "12.3", "12.230", "1e3" and "-1.00" are all rejected with null.
     */
    public static function to_cents(mixed $amount): ?int
    {
        if (!is_string($amount) || preg_match('/^\d+\.\d{2}$/D', $amount) !== 1) {
            return null;
        }
        [$whole, $fraction] = explode('.', $amount);
        if (strlen($whole) > 15) {
            return null; // would overflow an int once scaled; no real charge is that large
        }
        return ((int) $whole) * 100 + (int) $fraction;
    }

    /** 1362 -> "13.62", 5 -> "0.05". */
    public static function cents_to_string(int $cents): string
    {
        $sign = $cents < 0 ? '-' : '';
        $abs  = abs($cents);
        return sprintf('%s%d.%02d', $sign, intdiv($abs, 100), $abs % 100);
    }

    /**
     * @param array<string, mixed> $charge The decoded `charge` object.
     * @param array<int, mixed>    $items  The RUPIAH `items` of the same create_order input.
     * @param array<int, mixed>    $taxes  The RUPIAH `taxes` of the same create_order input.
     *
     * @return array{ok: true, items: list<array{name: string, cents: int}>, taxes: list<array{name: string, cents: int}>,
     *               fee: ?array{name: string, cents: int}, total_cents: int, snapshot: array<string, mixed>}
     *        |array{ok: false, message: string}
     */
    public static function validate(array $charge, array $items, array $taxes): array
    {
        if (($charge['currency'] ?? null) !== 'USD') {
            return self::fail('charge.currency must be "USD"');
        }

        $charge_items = $charge['items'] ?? null;
        if (!is_array($charge_items) || !array_is_list($charge_items)) {
            return self::fail('charge.items must be an array');
        }
        if (count($charge_items) !== count($items)) {
            return self::fail(sprintf('charge.items has %d entries but items has %d', count($charge_items), count($items)));
        }

        $charge_taxes = $charge['taxes'] ?? null;
        if (!is_array($charge_taxes) || !array_is_list($charge_taxes)) {
            return self::fail('charge.taxes must be an array');
        }
        // The same `<= 0` skip create_order() applies to rupiah taxes.
        $paid_taxes = 0;
        foreach ($taxes as $tax) {
            if (is_array($tax) && (float) ($tax['amount'] ?? 0) > 0) {
                $paid_taxes++;
            }
        }
        if (count($charge_taxes) !== $paid_taxes) {
            return self::fail(sprintf('charge.taxes has %d entries but %d rupiah taxes are above 0', count($charge_taxes), $paid_taxes));
        }

        $sum       = 0;
        $out_items = [];
        foreach ($charge_items as $i => $line) {
            $parsed = self::parse_line($line, sprintf('charge.items[%d]', $i));
            if (is_string($parsed)) {
                return self::fail($parsed);
            }
            // Item amounts may be 0.00 (a Rp 0 line next to a paid one keeps its 1:1 slot).
            $out_items[] = $parsed;
            $sum += $parsed['cents'];
        }

        $out_taxes = [];
        foreach ($charge_taxes as $i => $line) {
            $parsed = self::parse_line($line, sprintf('charge.taxes[%d]', $i));
            if (is_string($parsed)) {
                return self::fail($parsed);
            }
            if ($parsed['cents'] <= 0) {
                return self::fail(sprintf('charge.taxes[%d].amount must be greater than 0', $i));
            }
            $out_taxes[] = $parsed;
            $sum += $parsed['cents'];
        }

        $fee = null;
        if (($charge['fee'] ?? null) !== null) {
            $fee = self::parse_line($charge['fee'], 'charge.fee');
            if (is_string($fee)) {
                return self::fail($fee);
            }
            if ($fee['cents'] <= 0) {
                return self::fail('charge.fee.amount must be greater than 0');
            }
            $sum += $fee['cents'];
        }

        $total_cents = self::to_cents($charge['total'] ?? null);
        if ($total_cents === null) {
            return self::fail('charge.total must be a string like "13.62"');
        }
        if ($total_cents <= 0) {
            return self::fail('charge.total must be greater than 0');
        }
        if ($sum !== $total_cents) {
            return self::fail(sprintf(
                'charge lines sum to %s but charge.total is %s',
                self::cents_to_string($sum),
                self::cents_to_string($total_cents)
            ));
        }

        $snapshot = $charge['snapshot'] ?? null;
        $problem  = self::snapshot_problem($snapshot);
        if ($problem !== null) {
            return self::fail($problem);
        }

        return [
            'ok'          => true,
            'items'       => $out_items,
            'taxes'       => $out_taxes,
            'fee'         => $fee,
            'total_cents' => $total_cents,
            'snapshot'    => $snapshot,
        ];
    }

    /** @return array{name: string, cents: int}|string The line, or the problem. */
    private static function parse_line(mixed $line, string $label): array|string
    {
        if (!is_array($line)) {
            return sprintf('%s must be an object', $label);
        }
        if (!is_string($line['name'] ?? null)) {
            return sprintf('%s.name must be a string', $label);
        }
        $cents = self::to_cents($line['amount'] ?? null);
        if ($cents === null) {
            return sprintf('%s.amount must be a string like "12.23"', $label);
        }
        return ['name' => $line['name'], 'cents' => $cents];
    }

    /**
     * The snapshot is written to order meta and used for the effective fxRate, so its numbers
     * are range-checked too. clinicId is a JSON integer; the rest are decimal strings.
     */
    private static function snapshot_problem(mixed $snapshot): ?string
    {
        if (!is_array($snapshot)) {
            return 'charge.snapshot must be an object';
        }
        $clinic_id = $snapshot['clinicId'] ?? null;
        if (!is_int($clinic_id) || $clinic_id <= 0) {
            return 'charge.snapshot.clinicId must be a positive integer';
        }
        if (!ClinicPaymentSettings::is_usable_rate($snapshot['fxRate'] ?? null)) {
            return 'charge.snapshot.fxRate must be a number from 1000 to 100000';
        }
        $markup = $snapshot['markupPercent'] ?? null;
        if (!is_numeric($markup) || (float) $markup < 0 || (float) $markup > ClinicPaymentSettings::MARKUP_MAX) {
            return 'charge.snapshot.markupPercent must be a number from 0 to 100';
        }
        $fee = $snapshot['fixedFeeIdr'] ?? null;
        if (!is_numeric($fee) || (float) $fee < 0 || (float) $fee > ClinicPaymentSettings::FEE_MAX) {
            return 'charge.snapshot.fixedFeeIdr must be a number from 0 to 10000000';
        }
        $source = $snapshot['source'] ?? null;
        if (!is_array($source)) {
            return 'charge.snapshot.source must be an object';
        }
        foreach (['fxRate', 'markupPercent', 'fixedFeeIdr'] as $key) {
            if (!in_array($source[$key] ?? null, self::SOURCES, true)) {
                return sprintf('charge.snapshot.source.%s must be one of clinic, global, default', $key);
            }
        }
        return null;
    }

    /** @return array{ok: false, message: string} */
    private static function fail(string $message): array
    {
        return ['ok' => false, 'message' => $message];
    }
}
