<?php
/** Real MySQL/MariaDB test of the outbox: failure stays visible and retryable; success is idempotent. */
declare(strict_types=1);
define('ABSPATH', __DIR__ . '/');
require_once __DIR__ . '/schedule-db-shim.php';
require_once __DIR__ . '/../includes/class-praktiqu-endpoint-schedule-outbox.php';
use PraktiQU\Endpoint\Schedule_Outbox_Processor;

/** A WordPress site at UTC+7, like production. The processor must not use this clock. */
function current_time(string $type): string
{
    return (new DateTimeImmutable('now', new DateTimeZone('Asia/Jakarta')))->format('Y-m-d H:i:s');
}

$db = schedule_test_setup();
$db->query('DELETE FROM wp_praktiqu_schedule_outbox');
$db->query("INSERT INTO wp_praktiqu_schedule_outbox (appointment_id,payload,actor,request_id) VALUES (1,'{\"to\":{\"date\":\"2099-01-06\"}}','staff:1','r1')");
$id = (int) $db->pdo->lastInsertId();
$row = fn () => $db->get_row("SELECT *, TIMESTAMPDIFF(SECOND, NOW(), next_attempt_at) AS wait FROM wp_praktiqu_schedule_outbox WHERE id=$id");
$due = fn () => $db->query("UPDATE wp_praktiqu_schedule_outbox SET next_attempt_at = NOW() WHERE id=$id");

$calls = ['cal' => 0, 'rem' => 0];
$failCalendar = true;
$attemptsSeen = null;
$reminderPayload = null;
$p = new Schedule_Outbox_Processor(
    $db,
    function (int $a, array $payload) use (&$calls, &$failCalendar, &$attemptsSeen, $db, $id): void {
        $calls['cal']++;
        $attemptsSeen = (int) $db->get_var("SELECT attempts FROM wp_praktiqu_schedule_outbox WHERE id=$id");
        if ($failCalendar) throw new RuntimeException('kalender tidak tersedia — provider (MOCK) ✗');
    },
    function (int $a, array $payload) use (&$calls, &$reminderPayload): void { $calls['rem']++; $reminderPayload = $payload; }
);

$r = $p->process($id);
check($r['ok'] === false && $row()['status'] === 'pending' && (int) $row()['attempts'] === 1, 'failure stays pending with attempt count');
check($attemptsSeen === 1, 'attempt counted before the provider is called');
check(str_contains((string) $row()['last_error'], 'kalender tidak tersedia'), 'error visible (multibyte intact), not swallowed');
check($calls['rem'] === 0, 'reminders not marked synced when calendar failed');
check((int) $row()['wait'] > 240 && (int) $row()['wait'] <= 300, 'backoff measured on the database clock, not WordPress local time');

$r = $p->process($id);
check($r === ['ok' => false, 'error' => 'outbox_not_due'] && $calls['cal'] === 1, 'not retried before its backoff');

$other = schedule_test_pdo();
$other->query("SELECT GET_LOCK('praktiqu_schedule_outbox_$id', 0)");
$due();
$r = $p->process($id);
check($r === ['ok' => false, 'error' => 'outbox_busy'] && $calls['cal'] === 1, 'row held by another worker is not run twice');
$other->query("SELECT RELEASE_LOCK('praktiqu_schedule_outbox_$id')");

$failCalendar = false;
$r = $p->process($id);
check($r['ok'] === true && $row()['status'] === 'done' && $row()['last_error'] === null && $row()['done_at'] !== null, 'retry succeeds and clears error');
check($reminderPayload === ['to' => ['date' => '2099-01-06']], 'the reminder step gets the payload too');
$due();
$p->process($id);
check($calls['cal'] === 2 && $calls['rem'] === 1, 'done row is not re-run (idempotent)');

$db->query("UPDATE wp_praktiqu_schedule_outbox SET status='pending', attempts=0, last_error=NULL WHERE id=$id");
$failCalendar = true;
for ($k = 0; $k < 5; $k++) { $due(); $p->process($id); }
check($row()['status'] === 'failed' && (int) $row()['attempts'] === 5, 'exhausted retries become visible failed state');
$before = $calls['cal'];
$due();
check($p->process($id) === ['ok' => false, 'error' => 'outbox_failed'] && $calls['cal'] === $before, 'failed row is not retried by itself');

// Attempts that died mid-call leave the row pending with attempts used up.
$db->query("UPDATE wp_praktiqu_schedule_outbox SET status='pending', attempts=5 WHERE id=$id");
$due();
check($p->process($id) === ['ok' => false, 'error' => 'outbox_failed'] && $calls['cal'] === $before && $row()['status'] === 'failed', 'crashed attempts still exhaust');

echo "ALL PASS (real MySQL outbox state; calendar/reminder providers are MOCKS, no live provider claim)\n";
