<?php
/** Real MariaDB test of the outbox: failure stays visible and retryable; success is idempotent. */
declare(strict_types=1);
define('ABSPATH', __DIR__ . '/');
require_once __DIR__ . '/../includes/class-praktiqu-endpoint-schedule-outbox.php';
use PraktiQU\Endpoint\Schedule_Outbox_Processor;

const SOCKET = '/home/malaka/.hermes/cache/scratch/reschedule-db/run/m.sock';
const DB = 'praktiqu_schedule_foundation_test';
final class Database {
    public string $prefix = 'wp_';
    public function __construct(public PDO $pdo) {}
    public function prepare(string $sql, ...$args): string {
        foreach ($args as $a) { $sql = preg_replace('/%[ds]/', is_int($a) ? (string)$a : $this->pdo->quote((string)$a), $sql, 1); }
        return $sql;
    }
    public function query(string $sql): int|false { return $this->pdo->exec($sql); }
    public function get_row(string $sql, $f = null): ?array { return $this->pdo->query($sql)->fetch(PDO::FETCH_ASSOC) ?: null; }
}
function check(bool $ok, string $name): void { if (!$ok) throw new RuntimeException($name); echo "PASS $name\n"; }

$pdo = new PDO('mysql:unix_socket=' . SOCKET . ';dbname=' . DB, 'root', '', [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$db = new Database($pdo);
$pdo->exec(file_get_contents(__DIR__ . '/../../../prisma/manual/2026-10-19-schedule-sync-outbox.sql'));
$db->query('DELETE FROM wp_praktiqu_schedule_outbox');
$db->query("INSERT INTO wp_praktiqu_schedule_outbox (appointment_id,payload,actor,request_id) VALUES (1,'{\"to\":{\"date\":\"2099-01-06\"}}','staff:1','r1')");
$id = (int) $pdo->lastInsertId();

$calls = ['cal' => 0, 'rem' => 0];
$failCalendar = true;
$p = new Schedule_Outbox_Processor(
    $db,
    function (int $a, array $payload) use (&$calls, &$failCalendar): void {
        $calls['cal']++;
        if ($failCalendar) throw new RuntimeException('calendar provider unavailable (MOCK)');
    },
    function (int $a) use (&$calls): void { $calls['rem']++; }
);
$r = $p->process($id);
$row = $db->get_row("SELECT * FROM wp_praktiqu_schedule_outbox WHERE id=$id");
check($r['ok'] === false && $row['status'] === 'pending' && (int)$row['attempts'] === 1, 'failure stays pending with attempt count');
check(str_contains((string)$row['last_error'], 'calendar provider unavailable'), 'error visible, not swallowed');
check($calls['rem'] === 0, 'reminders not marked synced when calendar failed');
$failCalendar = false;
$r = $p->process($id);
$row = $db->get_row("SELECT * FROM wp_praktiqu_schedule_outbox WHERE id=$id");
check($r['ok'] === true && $row['status'] === 'done' && $row['last_error'] === null, 'retry succeeds and clears error');
$p->process($id);
check($calls['cal'] === 2 && $calls['rem'] === 1, 'done row is not re-run (idempotent)');
for ($i = 0; $i < 6; $i++) {
    $db->query("UPDATE wp_praktiqu_schedule_outbox SET status='pending', attempts=0 WHERE id=$id");
    $failCalendar = true;
    for ($k = 0; $k < 5; $k++) $p->process($id);
}
check($db->get_row("SELECT status FROM wp_praktiqu_schedule_outbox WHERE id=$id")['status'] === 'failed', 'exhausted retries become visible failed state');
echo "ALL PASS (real MariaDB outbox state; calendar/reminder providers are MOCKS, no live provider claim)\n";
