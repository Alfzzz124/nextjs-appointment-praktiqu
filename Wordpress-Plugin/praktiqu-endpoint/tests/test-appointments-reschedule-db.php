<?php
/**
 * Real MySQL/MariaDB test of Appointments::reschedule(), the body of
 * POST /praktiqu/v1/appointments/{id}/reschedule. Connection: see schedule-db-shim.php.
 *
 * The external steps are a recording double passed to the constructor; Schedule_Sync has
 * its own test. What is pinned here is the contract the Next.js app relies on: the
 * answer's shape, one error code per way a move can be refused, and that a failed
 * calendar step neither undoes the move nor turns it into an error.
 */

declare(strict_types=1);

namespace App\models {
    final class KCAppointment
    {
    }
}

namespace {
    use PraktiQU\Endpoint\Appointments;

    define('ABSPATH', __DIR__ . '/');
    require_once __DIR__ . '/schedule-db-shim.php';
    require_once __DIR__ . '/../includes/class-praktiqu-endpoint-schedule-write.php';
    require_once __DIR__ . '/../includes/class-praktiqu-endpoint-schedule-outbox.php';
    require_once __DIR__ . '/../includes/class-praktiqu-endpoint-appointments.php';

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

    function is_wp_error($thing): bool { return $thing instanceof WP_Error; }
    function sanitize_text_field(string $text): string { return trim(strip_tags($text)); }

    /** The external steps, recorded. */
    final class FakeSync
    {
        public array $calls = [];
        public bool $fail = false;

        public function calendar(int $id, array $payload): void
        {
            $this->calls[] = ['calendar', $id, $payload];
            if ($this->fail) {
                throw new RuntimeException('meet_update_failed');
            }
        }

        public function reminders(int $id, array $payload): void
        {
            $this->calls[] = ['reminders', $id, $payload];
        }

        public function meeting_url(int $id): ?string
        {
            return 'https://meet.google.com/abc-defg-hij';
        }
    }

    const DOCTOR = 34;

    function seed(Database $db, array $over = []): int
    {
        $row = array_merge([
            'doctor_id' => DOCTOR, 'clinic_id' => 3, 'patient_id' => 7, 'visit_type' => '4', 'status' => 1,
            'appointment_start_date' => '2099-03-10', 'appointment_start_time' => '09:00:00',
            'appointment_end_date' => '2099-03-10', 'appointment_end_time' => '10:00:00',
            'appointment_timezone' => 'Asia/Jakarta',
        ], $over);
        $db->insert('wp_kc_appointments', $row);

        return (int) $db->pdo->lastInsertId();
    }

    /** What the Next.js app sends: its own view of the row, in its own time format. */
    function request(int $id, array $over = [], array $expectedOver = []): array
    {
        return array_merge([
            'start_date' => '2099-03-11', 'start_time' => '10:00',
            'expected' => array_merge([
                'doctor_id' => DOCTOR, 'clinic_id' => 3, 'status' => 1,
                'start_date' => '2099-03-10', 'start_time' => '09:00', 'end_date' => '2099-03-10', 'end_time' => '10:00:00',
            ], $expectedOver),
            'actor' => 'wp:24', 'request_id' => 'req-' . $id,
        ], $over);
    }

    function refused(array|WP_Error $r, string $code, int $status, string $name): void
    {
        check(is_wp_error($r) && $r->get_error_code() === $code && (int) ($r->get_error_data()['status'] ?? 0) === $status, $name);
    }

    $db = schedule_test_setup();
    $GLOBALS['wpdb'] = $db;
    function reset_fixture(Database $db): void
    {
        $db->failOn = null;
        $db->query('DELETE FROM wp_kc_appointments');
        $db->query('DELETE FROM wp_praktiqu_schedule_outbox');
    }

    $sync = new FakeSync();
    $appointments = new Appointments($sync);

    reset_fixture($db);
    $id = seed($db);
    $r = $appointments->reschedule($id, request($id));
    check(!is_wp_error($r) && $r['id'] === $id && $r['start_date'] === '2099-03-11' && $r['start_time'] === '10:00:00'
        && $r['end_date'] === '2099-03-11' && $r['end_time'] === '11:00:00', 'moves the appointment, keeping its hour');
    check($r['previous'] === ['start_date' => '2099-03-10', 'start_time' => '09:00:00', 'end_time' => '10:00:00'], 'reports where it was');
    $outbox = $db->get_row('SELECT * FROM wp_praktiqu_schedule_outbox');
    check($r['sync'] === ['outbox_id' => (int) $outbox['id'], 'ok' => true, 'meeting_url' => 'https://meet.google.com/abc-defg-hij'], 'runs the outbox row at once and reports it');
    check($outbox['status'] === 'done' && $outbox['actor'] === 'wp:24' && $outbox['request_id'] === 'req-' . $id, 'outbox row done, with who asked');
    check(array_column($sync->calls, 0) === ['calendar', 'reminders'] && $sync->calls[0][2]['to'] === ['date' => '2099-03-11', 'start' => '10:00:00', 'end' => '11:00:00'], 'calendar and reminders get the new slot');

    reset_fixture($db);
    $id = seed($db);
    $sync->fail = true;
    $r = $appointments->reschedule($id, request($id));
    $sync->fail = false;
    check(!is_wp_error($r) && $r['sync']['ok'] === false && $r['sync']['error'] === 'meet_update_failed', 'a failed calendar step is reported, not an error');
    check($db->get_var("SELECT appointment_start_date FROM wp_kc_appointments WHERE id = $id") === '2099-03-11', 'and the move stays');
    $outbox = $db->get_row('SELECT * FROM wp_praktiqu_schedule_outbox');
    check($outbox['status'] === 'pending' && str_contains((string) $outbox['last_error'], 'meet_update_failed'), 'the row waits for the sweep with its error');

    reset_fixture($db);
    $id = seed($db);
    seed($db, ['patient_id' => 8, 'appointment_start_date' => '2099-03-11', 'appointment_start_time' => '10:30:00', 'appointment_end_date' => '2099-03-11', 'appointment_end_time' => '11:30:00']);
    refused($appointments->reschedule($id, request($id)), 'praktiqu_schedule_conflict', 409, 'a taken slot: 409 conflict');

    reset_fixture($db);
    $id = seed($db);
    refused($appointments->reschedule($id, request($id, [], ['start_time' => '08:00'])), 'praktiqu_schedule_stale', 409, 'a row that changed since it was read: 409 stale');
    refused($appointments->reschedule($id, request($id, ['start_date' => '2099-03-10', 'start_time' => '09:00'])), 'praktiqu_schedule_unchanged', 400, 'the same slot: 400 unchanged');
    refused($appointments->reschedule($id, request($id, ['start_date' => '2099-02-30'])), 'praktiqu_schedule_invalid', 400, 'a date that does not exist: 400 invalid');
    refused($appointments->reschedule($id, request($id, ['start_date' => '2001-03-11'])), 'praktiqu_schedule_unavailable', 422, 'a time already past: 422 unavailable');
    refused($appointments->reschedule($id, request($id, ['start_time' => ''])), 'praktiqu_missing_field', 400, 'no new time: 400 missing field');
    refused($appointments->reschedule(999999, request(999999)), 'praktiqu_appointment_not_found', 404, 'an unknown appointment: 404');

    $db->query("UPDATE wp_kc_appointments SET status = 4 WHERE id = $id");
    refused($appointments->reschedule($id, request($id, [], ['status' => 4])), 'praktiqu_schedule_terminal', 409, 'a checked-in session: 409 terminal');

    reset_fixture($db);
    $id = seed($db);
    $other = schedule_test_pdo();
    $other->query("SELECT GET_LOCK('praktiqu_doc_schedule_" . DOCTOR . "', 0)");
    refused($appointments->reschedule($id, request($id)), 'praktiqu_schedule_busy', 503, 'a schedule still locked after the wait: 503 busy');
    $other->query("SELECT RELEASE_LOCK('praktiqu_doc_schedule_" . DOCTOR . "')");

    $db->failOn = '/SELECT id FROM wp_kc_appointments\s+WHERE doctor_id/';
    refused($appointments->reschedule($id, request($id)), 'praktiqu_schedule_db_error', 500, 'a failed conflict check: 500 db error');
    $db->failOn = null;
    check($db->get_var("SELECT appointment_start_date FROM wp_kc_appointments WHERE id = $id") === '2099-03-10'
        && (int) $db->get_var('SELECT COUNT(*) FROM wp_praktiqu_schedule_outbox') === 0, 'no refusal moved anything or queued anything');

    echo "ALL PASS (real MySQL; sync steps recorded; no providers/mail)\n";
}
