<?php
/**
 * Assertions for Jobs_Webhook::build_body() and ::sign(). Plain PHP — no PHPUnit, no
 * WordPress — so it runs in a bare `php:8.3-cli` container, same as tests/test-money.php.
 *
 * What matters here is the wire contract with Next.js:
 *   - the body MUST be { event, data }, because processWebhook() reads payload.event and
 *     then calls handler(payload.data). A flat payload hands the handler undefined.
 *   - the signature MUST be HMAC-SHA256 hex over the raw body, because
 *     verifyWebhookSignature() in src/lib/jobs/webhook-handler.ts computes exactly that
 *     and compares with timingSafeEqual.
 */

declare(strict_types=1);

define('PRAKTIQU_ENDPOINT_JOBS_WEBHOOK_TEST', true);
require_once __DIR__ . '/../includes/class-praktiqu-endpoint-jobs-webhook.php';

use PraktiQU\Endpoint\Jobs_Webhook;

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

echo "Jobs_Webhook::build_body\n";

$body = Jobs_Webhook::build_body('session.reminder', ['sessionId' => 7, 'channel' => 'email_24h']);
check('nests the payload under data', $body, '{"event":"session.reminder","data":{"sessionId":7,"channel":"email_24h"}}');

$decoded = json_decode((string) $body, true);
check('event is top level', $decoded['event'], 'session.reminder');
check('sessionId lives under data', $decoded['data']['sessionId'], 7);
check('channel lives under data', $decoded['data']['channel'], 'email_24h');
check('no stray top-level keys', array_keys($decoded), ['event', 'data']);

$empty = Jobs_Webhook::build_body('session.reminder', []);
check('empty data still nests as an object', $empty, '{"event":"session.reminder","data":{}}');

echo "Jobs_Webhook::sign\n";

$secret = 'rahasia-webhook';
$sig = Jobs_Webhook::sign('{"a":1}', $secret);
check('hmac sha256 hex over the raw body', $sig, hash_hmac('sha256', '{"a":1}', $secret));
check('hex is 64 chars', strlen($sig), 64);
check('empty secret yields an empty signature', Jobs_Webhook::sign('{"a":1}', ''), '');
check('signature covers the body, not just the event', Jobs_Webhook::sign('{"a":2}', $secret) !== $sig, true);

echo "\n";
if ($failures > 0) {
    echo "{$failures} FAILURE(S)\n";
    exit(1);
}
echo "ALL PASS\n";
