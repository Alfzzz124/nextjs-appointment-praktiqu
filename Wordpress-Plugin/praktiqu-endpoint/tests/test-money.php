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

echo "\n" . ($failures === 0 ? "ALL PASS\n" : "{$failures} FAILURE(S)\n");
exit($failures === 0 ? 0 : 1);
