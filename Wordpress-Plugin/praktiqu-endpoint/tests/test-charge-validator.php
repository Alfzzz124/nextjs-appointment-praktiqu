<?php
/**
 * Assertions for ChargeValidator. Plain PHP — no PHPUnit, no WordPress — so it runs in a
 * bare `php:8.4-cli` container, same as tests/test-money.php.
 *
 * The wire format under test is exactly what Next.js serialises (spec §4): every money
 * amount is a "12.23"-style string, snapshot.clinicId is a JSON integer, the other snapshot
 * numbers are decimal strings, and `fee` is left out when there is no fee.
 */

declare(strict_types=1);

define('PRAKTIQU_ENDPOINT_CLINIC_PAYMENT_SETTINGS_TEST', true);
define('PRAKTIQU_ENDPOINT_CHARGE_VALIDATOR_TEST', true);
require_once __DIR__ . '/../includes/class-praktiqu-endpoint-clinic-payment-settings.php';
require_once __DIR__ . '/../includes/class-praktiqu-endpoint-charge-validator.php';

use PraktiQU\Endpoint\ChargeValidator as V;

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

/** The §2 worked example: rate 18,000, markup 10%, fee Rp 25,000, service Rp 200,000. */
function worked_charge(array $override = []): array
{
    return array_merge([
        'currency' => 'USD',
        'items'    => [['name' => 'Konsultasi', 'amount' => '12.23']],
        'taxes'    => [],
        'fee'      => ['name' => 'International service fee', 'amount' => '1.39'],
        'total'    => '13.62',
        'snapshot' => [
            'clinicId'      => 4,
            'fxRate'        => '18000',
            'markupPercent' => '10',
            'fixedFeeIdr'   => '25000',
            'source'        => ['fxRate' => 'clinic', 'markupPercent' => 'global', 'fixedFeeIdr' => 'clinic'],
        ],
    ], $override);
}

$rupiah_items = [['name' => 'Konsultasi', 'price' => 200000]];

/** The message of a failed validate(), or 'ok'. */
function verdict(array $result): string
{
    return $result['ok'] ? 'ok' : $result['message'];
}

echo "ChargeValidator::to_cents\n";
check('"12.23"', V::to_cents('12.23'), 1223);
check('"0.00"', V::to_cents('0.00'), 0);
check('"0.05"', V::to_cents('0.05'), 5);
check('"1000.10"', V::to_cents('1000.10'), 100010);
check('a JSON number 12.23 is rejected', V::to_cents(12.23), null);
check('an int is rejected', V::to_cents(12), null);
check('"12.3" (one decimal)', V::to_cents('12.3'), null);
check('"12.230" (three decimals)', V::to_cents('12.230'), null);
check('"12" (no decimals)', V::to_cents('12'), null);
check('"-1.00"', V::to_cents('-1.00'), null);
check('"1e3"', V::to_cents('1e3'), null);
check('" 12.23" (leading space)', V::to_cents(' 12.23'), null);
check('"12.23\n" (trailing newline)', V::to_cents("12.23\n"), null);
check('null', V::to_cents(null), null);
check('16 integer digits would overflow', V::to_cents('1234567890123456.00'), null);

echo "\nChargeValidator::cents_to_string\n";
check('1362', V::cents_to_string(1362), '13.62');
check('0', V::cents_to_string(0), '0.00');
check('5', V::cents_to_string(5), '0.05');
check('100', V::cents_to_string(100), '1.00');
check('round trip 4889', V::cents_to_string((int) V::to_cents('48.89')), '48.89');

echo "\nChargeValidator::validate accepts\n";
$ok = V::validate(worked_charge(), $rupiah_items, []);
check('the worked example 12.23 + 1.39 = 13.62', verdict($ok), 'ok');
check('item line in cents', $ok['items'] ?? null, [['name' => 'Konsultasi', 'cents' => 1223]]);
check('no tax lines', $ok['taxes'] ?? null, []);
check('fee line in cents', $ok['fee'] ?? null, ['name' => 'International service fee', 'cents' => 139]);
check('total cents', $ok['total_cents'] ?? null, 1362);
check('snapshot passed through untouched', $ok['snapshot'] ?? null, worked_charge()['snapshot']);

$no_fee = worked_charge(['fee' => null, 'total' => '12.23']);
check('a null fee counts as absent', verdict(V::validate($no_fee, $rupiah_items, [])), 'ok');
$absent_fee = worked_charge(['total' => '12.23']);
unset($absent_fee['fee']);
$absent = V::validate($absent_fee, $rupiah_items, []);
check('an absent fee', verdict($absent), 'ok');
check('an absent fee yields fee null', array_key_exists('fee', $absent) ? $absent['fee'] : 'missing', null);

$two_items = worked_charge([
    'items' => [['name' => 'Konsultasi', 'amount' => '12.23'], ['name' => 'Gratis', 'amount' => '0.00']],
]);
check('a 0.00 item next to a paid item keeps the 1:1 count',
    verdict(V::validate($two_items, [['name' => 'Konsultasi', 'price' => 200000], ['name' => 'Gratis', 'price' => 0]], [])), 'ok');

$with_tax = worked_charge([
    'taxes' => [['name' => 'PPN', 'amount' => '1.23']],
    'total' => '14.85',
]);
check('one paid tax; a Rp 0 tax is skipped in the count',
    verdict(V::validate($with_tax, $rupiah_items, [['name' => 'PPN', 'amount' => 20000], ['name' => 'Nol', 'amount' => 0]])), 'ok');
check('markup 1.1 as a decimal string', verdict(V::validate(worked_charge(['snapshot' => array_merge(worked_charge()['snapshot'], ['markupPercent' => '1.1'])]), $rupiah_items, [])), 'ok');

echo "\nChargeValidator::validate rejects\n";
check('currency IDR', verdict(V::validate(worked_charge(['currency' => 'IDR']), $rupiah_items, [])), 'charge.currency must be "USD"');
check('a float-looking item amount', verdict(V::validate(worked_charge(['items' => [['name' => 'Konsultasi', 'amount' => 12.23]]]), $rupiah_items, [])),
    'charge.items[0].amount must be a string like "12.23"');
check('a float-looking total', verdict(V::validate(worked_charge(['total' => 13.62]), $rupiah_items, [])), 'charge.total must be a string like "13.62"');
check('a mismatched sum', verdict(V::validate(worked_charge(['total' => '13.63']), $rupiah_items, [])), 'charge lines sum to 13.62 but charge.total is 13.63');
check('more charge items than rupiah items',
    verdict(V::validate(worked_charge(['items' => [['name' => 'A', 'amount' => '6.00'], ['name' => 'B', 'amount' => '6.23']]]), $rupiah_items, [])),
    'charge.items has 2 entries but items has 1');
check('a charge tax with no paid rupiah tax',
    verdict(V::validate($with_tax, $rupiah_items, [['name' => 'Nol', 'amount' => 0]])), 'charge.taxes has 1 entries but 0 rupiah taxes are above 0');
check('a paid rupiah tax with no charge tax',
    verdict(V::validate(worked_charge(), $rupiah_items, [['name' => 'PPN', 'amount' => 20000]])), 'charge.taxes has 0 entries but 1 rupiah taxes are above 0');
check('a 0.00 tax line',
    verdict(V::validate(worked_charge(['taxes' => [['name' => 'PPN', 'amount' => '0.00']]]), $rupiah_items, [['name' => 'PPN', 'amount' => 1]])),
    'charge.taxes[0].amount must be greater than 0');
check('a 0.00 fee', verdict(V::validate(worked_charge(['fee' => ['name' => 'International service fee', 'amount' => '0.00'], 'total' => '12.23']), $rupiah_items, [])),
    'charge.fee.amount must be greater than 0');
check('a zero total', verdict(V::validate(worked_charge(['items' => [['name' => 'Konsultasi', 'amount' => '0.00']], 'fee' => null, 'total' => '0.00']), $rupiah_items, [])),
    'charge.total must be greater than 0');
check('items not a list', verdict(V::validate(worked_charge(['items' => ['a' => ['name' => 'X', 'amount' => '12.23']]]), $rupiah_items, [])), 'charge.items must be an array');
check('taxes missing', verdict(V::validate(array_diff_key(worked_charge(), ['taxes' => true]), $rupiah_items, [])), 'charge.taxes must be an array');
check('a line without a name', verdict(V::validate(worked_charge(['items' => [['amount' => '12.23']]]), $rupiah_items, [])), 'charge.items[0].name must be a string');
check('a line that is not an object', verdict(V::validate(worked_charge(['items' => ['12.23']]), $rupiah_items, [])), 'charge.items[0] must be an object');

$snap = worked_charge()['snapshot'];
check('snapshot missing', verdict(V::validate(array_diff_key(worked_charge(), ['snapshot' => true]), $rupiah_items, [])), 'charge.snapshot must be an object');
check('clinicId as a string', verdict(V::validate(worked_charge(['snapshot' => array_merge($snap, ['clinicId' => '4'])]), $rupiah_items, [])),
    'charge.snapshot.clinicId must be a positive integer');
check('clinicId 0', verdict(V::validate(worked_charge(['snapshot' => array_merge($snap, ['clinicId' => 0])]), $rupiah_items, [])),
    'charge.snapshot.clinicId must be a positive integer');
check('fxRate 16.5', verdict(V::validate(worked_charge(['snapshot' => array_merge($snap, ['fxRate' => '16.5'])]), $rupiah_items, [])),
    'charge.snapshot.fxRate must be a number from 1000 to 100000');
check('markupPercent 150', verdict(V::validate(worked_charge(['snapshot' => array_merge($snap, ['markupPercent' => '150'])]), $rupiah_items, [])),
    'charge.snapshot.markupPercent must be a number from 0 to 100');
check('fixedFeeIdr missing', verdict(V::validate(worked_charge(['snapshot' => array_diff_key($snap, ['fixedFeeIdr' => true])]), $rupiah_items, [])),
    'charge.snapshot.fixedFeeIdr must be a number from 0 to 10000000');
check('an unknown source', verdict(V::validate(worked_charge(['snapshot' => array_merge($snap, ['source' => ['fxRate' => 'clinic', 'markupPercent' => 'guess', 'fixedFeeIdr' => 'clinic']])]), $rupiah_items, [])),
    'charge.snapshot.source.markupPercent must be one of clinic, global, default');

echo "\n";
if ($failures > 0) {
    echo "{$failures} FAILURE(S)\n";
    exit(1);
}
echo "ALL PASS\n";
