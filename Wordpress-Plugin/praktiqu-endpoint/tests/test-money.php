<?php
/**
 * Assertions for Money::idr_to_foreign(). Plain PHP — no PHPUnit, no WordPress —
 * so it runs in a bare `php:8.3-cli` container. See the plan's command list.
 */

declare(strict_types=1);

define('PRAKTIQU_ENDPOINT_MONEY_TEST', true);
require_once __DIR__ . '/../includes/class-praktiqu-endpoint-money.php';

use PraktiQU\Endpoint\Money;

$failures = 0;

function check(string $label, $actual, $expected): void
{
    global $failures;
    if ($actual === $expected) {
        echo "  ok   {$label}\n";
        return;
    }
    $failures++;
    echo "  FAIL {$label}: expected " . var_export($expected, true)
        . ', got ' . var_export($actual, true) . "\n";
}

echo "Money::idr_to_foreign\n";

// Exact division must not be inflated by a spurious cent. 180000/18000 = 10.00
// exactly; a naive ceil($x * 100) / 100 returns 10.01 here on some platforms.
check('exact division stays exact', Money::idr_to_foreign(180000, 18000), 10.0);

// 200000/18000 = 11.111... → rounds UP to 11.12, never down to 11.11.
check('rounds up, not to nearest', Money::idr_to_foreign(200000, 18000), 11.12);

// 150000/18000 = 8.333... → 8.34
check('rounds up a third', Money::idr_to_foreign(150000, 18000), 8.34);

// A sub-cent amount still costs a full cent rather than becoming free.
check('tiny amount becomes one cent', Money::idr_to_foreign(1, 18000), 0.01);

check('zero stays zero', Money::idr_to_foreign(0, 18000), 0.0);

// A tax line, to prove the same helper serves both item and tax amounts.
check('tax line converts', Money::idr_to_foreign(20000, 18000), 1.12);

echo "\nMoney::idr_to_foreign with markup\n";

// Default markup (0.0) must make the 2-arg call and the 3-arg call agree
// exactly, proving the new parameter is a no-op unless supplied.
check(
    'markup 0 matches the 2-arg call (200000)',
    Money::idr_to_foreign(200000, 18000, 0),
    Money::idr_to_foreign(200000, 18000)
);
check(
    'markup 0 matches the 2-arg call (180000)',
    Money::idr_to_foreign(180000, 18000, 0),
    Money::idr_to_foreign(180000, 18000)
);

// 200000/18000 = 11.111111... ; * 1.10 = 12.222222... -> ceil -> 12.23
check('markup 10 on an item line', Money::idr_to_foreign(200000, 18000, 10), 12.23);

// 180000/18000 = 10 exactly; * 1.10 = 11.00 exactly. The inner round(..., 6)
// guard must stop binary-float error from turning this into 11.01 -- this is
// the float-inflation case, now under markup rather than a bare rate.
check('markup 10 keeps an exact result exact', Money::idr_to_foreign(180000, 18000, 10), 11.0);

// A tax line: 20000/18000 = 1.111111... ; * 1.10 = 1.222222... -> ceil -> 1.23
check('markup 10 on a tax line', Money::idr_to_foreign(20000, 18000, 10), 1.23);

// markup 100 doubles the converted amount: 180000/18000 = 10; * 2.00 = 20.0 exactly.
check('markup 100 doubles the amount', Money::idr_to_foreign(180000, 18000, 100), 20.0);

echo "\nMoney::idr_to_foreign rejects a bad rate\n";

foreach ([0.0, -1.0] as $bad) {
    $threw = false;
    try {
        Money::idr_to_foreign(100000, $bad);
    } catch (\InvalidArgumentException $e) {
        $threw = true;
    }
    check('rate ' . $bad . ' throws', $threw, true);
}

echo "\nMoney::idr_to_foreign rejects a negative markup\n";

$threw = false;
try {
    Money::idr_to_foreign(100000, 18000, -1);
} catch (\InvalidArgumentException $e) {
    $threw = true;
}
check('markup -1 throws', $threw, true);

echo "\n" . ($failures === 0 ? "ALL PASS\n" : "{$failures} FAILURE(S)\n");
exit($failures === 0 ? 0 : 1);
