<?php
/** Real MySQL/MariaDB test of Schedule_Write. Connection: see schedule-db-shim.php. */
declare(strict_types=1);
define('ABSPATH', __DIR__ . '/');
require_once __DIR__ . '/schedule-db-shim.php';
require_once __DIR__ . '/../includes/class-praktiqu-endpoint-schedule-write.php';
use PraktiQU\Endpoint\Schedule_Write;

function fails(callable $fn, string $code): void {
    try { $fn(); } catch (RuntimeException $e) { check($e->getMessage() === $code, $code); return; }
    throw new RuntimeException("Expected $code");
}
function snapshot(): array {
    return ['doctor_id'=>9, 'clinic_id'=>3, 'patient_id'=>7, 'visit_type'=>'4', 'status'=>1,
        'appointment_start_date'=>'2099-01-05','appointment_start_time'=>'09:00:00',
        'appointment_end_date'=>'2099-01-05','appointment_end_time'=>'10:00:00', 'appointment_timezone'=>'Asia/Jakarta'];
}
function bounds(array $row, DateTimeImmutable $start, DateTimeImmutable $end): bool {
    return $row['clinic_id']==3 && $start->format('H:i:s')>='08:00:00' && $end->format('H:i:s')<='17:00:00';
}
function move(Schedule_Write $writer, array $expected = []): array {
    return $writer->move(1, $expected ?: snapshot(), '2099-01-06', '10:00:00', 'staff:test', 'request:test', 'bounds');
}
function blockTarget(Database $db): void {
    $db->query("INSERT INTO wp_kc_appointments (id,doctor_id,clinic_id,patient_id,visit_type,status,appointment_start_date,appointment_start_time,appointment_end_date,appointment_end_time,appointment_timezone) VALUES (2,9,3,8,'4',1,'2099-01-06','10:00:00','2099-01-06','11:00:00','Asia/Jakarta')");
}
if (($argv[1]??'')==='worker') {
    $db=schedule_test_db(); $writer=new Schedule_Write($db);
    try {
        if ($argv[2]==='move') move($writer);
        else $writer->locked(9, function () use ($db, $writer) {
            $writer->assertFree(9, '2099-01-06', '10:00:00', '11:00:00');
            blockTarget($db);
        });
        echo 'won';
    } catch (RuntimeException $e) { echo $e->getMessage(); }
    exit;
}
$db=schedule_test_setup();
// Fixture reset is scoped to the disposable database, never WordPress/dev/prod.
$db->query('CREATE TABLE IF NOT EXISTS payment_orders (id INT PRIMARY KEY, appointmentId INT, wcOrderId INT, amount DECIMAL(12,2), status VARCHAR(20)) ENGINE=InnoDB');
$db->query("INSERT IGNORE INTO payment_orders VALUES (77,1,900,125000.00,'paid')");
$paid=$db->get_row('SELECT * FROM payment_orders WHERE id=77');
function resetFixture(Database $db): void {
    $db->failOn = null;
    $db->query('DELETE FROM wp_kc_appointments');
    $db->query('DELETE FROM wp_praktiqu_schedule_outbox');
    $db->query("INSERT INTO wp_kc_appointments (id,doctor_id,clinic_id,patient_id,visit_type,status,appointment_start_date,appointment_start_time,appointment_end_date,appointment_end_time,appointment_timezone) VALUES (1,9,3,7,'4',1,'2099-01-05','09:00:00','2099-01-05','10:00:00','Asia/Jakarta')");
}
resetFixture($db);
$writer=new Schedule_Write($db);
$result=move($writer);
check($result['appointment_start_date']==='2099-01-06', 'same appointment moved');
check($result['appointment_start_utc']==='2099-01-06 03:00:00' && $result['appointment_end_utc']==='2099-01-06 04:00:00', 'both UTC columns updated');
check((int)$db->get_var('SELECT COUNT(*) FROM wp_praktiqu_schedule_outbox')===1, 'outbox committed with schedule');
check($db->get_row('SELECT * FROM payment_orders WHERE id=77')===$paid, 'paid order id amount status unchanged');
fails(fn()=>move($writer), 'schedule_stale');
resetFixture($db);
$wrong=snapshot(); $wrong['status']=2;
fails(fn()=>move($writer,$wrong), 'schedule_stale');
$wrong=snapshot(); $wrong['clinic_id']=8;
fails(fn()=>move($writer,$wrong), 'schedule_stale');
$db->query('UPDATE wp_kc_appointments SET status=4 WHERE id=1');
$wrong=snapshot(); $wrong['status']=4;
fails(fn()=>move($writer,$wrong), 'schedule_terminal');
resetFixture($db);
fails(fn()=>$writer->move(1,snapshot(),'2099-01-06','17:00:00','staff:test','request:test','bounds'), 'schedule_unavailable');
fails(fn()=>$writer->move(1,snapshot(),'2099-02-30','10:00:00','staff:test','request:test','bounds'), 'schedule_invalid');
fails(fn()=>$writer->move(1,snapshot(),'2099-01-05','09:00:00','staff:test','request:test','bounds'), 'schedule_unchanged');
blockTarget($db);
fails(fn()=>move($writer), 'schedule_conflict');
// wpdb does not throw: a failed conflict query returns null, which must not read as "free".
$db->failOn = '/SELECT id FROM wp_kc_appointments\s+WHERE doctor_id/';
fails(fn()=>move($writer), 'schedule_db_error');
$db->failOn = null;
check($db->get_var('SELECT appointment_start_date FROM wp_kc_appointments WHERE id=1')==='2099-01-05', 'failed moves leave original untouched');
check((int)$db->get_var("SELECT COUNT(*) FROM wp_kc_appointments WHERE appointment_start_date='2099-01-06'")===1, 'failed conflict query did not double-book');
check((int)$db->get_var('SELECT COUNT(*) FROM wp_praktiqu_schedule_outbox')===0, 'failed moves no outbox');
resetFixture($db);
$db->failOn = '/^INSERT INTO wp_praktiqu_schedule_outbox/';
fails(fn()=>move($writer), 'schedule_db_error');
$db->failOn = null;
check($db->get_var('SELECT appointment_start_date FROM wp_kc_appointments WHERE id=1')==='2099-01-05', 'outbox failure rolls the move back');
for ($i=0;$i<20;$i++) {
    resetFixture($db);
    $workers=[];
    foreach (['move','book'] as $action) {
        $p=proc_open([PHP_BINARY,__FILE__,'worker',$action],[1=>['pipe','w'],2=>['pipe','w']],$pipes);
        $workers[]=[$p,$pipes];
    }
    $answers=[];
    foreach ($workers as [$p,$pipes]) {
        $answers[]=stream_get_contents($pipes[1]); $err=stream_get_contents($pipes[2]);
        fclose($pipes[1]); fclose($pipes[2]);
        if (proc_close($p)!==0 || $err) throw new RuntimeException($err);
    }
    sort($answers);
    check($answers===['schedule_conflict','won'], "race $i exactly one winner");
    check((int)$db->get_var("SELECT COUNT(*) FROM wp_kc_appointments WHERE appointment_start_date='2099-01-06'")===1, "race $i no double booking");
}
check($db->get_row('SELECT * FROM payment_orders WHERE id=77')===$paid, 'payment invariant after concurrency');
$db->query('ALTER TABLE wp_kc_appointments ENGINE=MyISAM');
resetFixture($db);
fails(fn()=>move($writer), 'schedule_requires_innodb');
$db->query('ALTER TABLE wp_kc_appointments ENGINE=InnoDB');
echo "ALL PASS (real MySQL; wpdb-shaped shim; no providers/mail)\n";
