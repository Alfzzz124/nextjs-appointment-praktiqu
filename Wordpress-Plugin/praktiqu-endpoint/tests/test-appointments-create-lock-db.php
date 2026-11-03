<?php
/**
 * Real MySQL/MariaDB test of Appointments::create() under the doctor's schedule lock.
 * Connection: see schedule-db-shim.php.
 *
 * Every booking — public and staff — reaches wp_kc_appointments through create(). The
 * backend checks the slot first, but that check and this write are separate requests,
 * so two bookings for the same slot could both pass it. The authoritative check is the
 * one create() runs while holding the same per-doctor lock that Schedule_Write::move()
 * takes, so a new booking and a reschedule cannot land on one slot either.
 *
 * WordPress functions and KiviCare's KCAppointment model are shimmed; the model writes
 * through the same wpdb-shaped connection, after an optional delay that widens the
 * check-then-write window enough for the races below to be real races.
 */

declare(strict_types=1);

namespace App\models {
    final class KCAppointment
    {
        /** @param array<string,mixed> $data */
        public static function create(array $data): int|false
        {
            usleep((int) ($GLOBALS['model_delay_us'] ?? 0));
            $db = $GLOBALS['wpdb'];
            $ok = $db->insert('wp_kc_appointments', [
                'appointment_start_date' => $data['appointmentStartDate'],
                'appointment_start_time' => $data['appointmentStartTime'],
                'appointment_end_date'   => $data['appointmentEndDate'],
                'appointment_end_time'   => $data['appointmentEndTime'],
                'visit_type'             => $data['visitType'],
                'clinic_id'              => $data['clinicId'],
                'doctor_id'              => $data['doctorId'],
                'patient_id'             => $data['patientId'],
                'description'            => $data['description'],
                'status'                 => $data['status'],
                'created_at'             => $data['createdAt'],
                'appointment_timezone'   => $data['appointmentTimezone'],
            ]);

            return $ok === 1 ? (int) $db->pdo->lastInsertId() : false;
        }
    }
}

namespace {
    use PraktiQU\Endpoint\Appointments;
    use PraktiQU\Endpoint\Schedule_Write;

    define('ABSPATH', __DIR__ . '/');
    require_once __DIR__ . '/schedule-db-shim.php';
    require_once __DIR__ . '/../includes/class-praktiqu-endpoint-schedule-write.php';
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

    final class WP_REST_Request
    {
        public function get_param(string $key): mixed
        {
            return null;
        }
    }

    function is_wp_error($thing): bool { return $thing instanceof WP_Error; }
    function sanitize_text_field(string $text): string { return trim(strip_tags($text)); }
    function sanitize_textarea_field(string $text): string { return trim(strip_tags($text)); }
    function absint($value): int { return abs((int) $value); }
    function current_time(string $type): string { return gmdate('Y-m-d H:i:s'); }
    function wp_timezone_string(): string { return 'Asia/Jakarta'; }
    function apply_filters(string $hook, $value, ...$args) {
        return isset($GLOBALS['filters'][$hook]) ? $GLOBALS['filters'][$hook]($value, ...$args) : $value;
    }
    function do_action(string $hook, ...$args): void { $GLOBALS['actions'][] = $hook; }

    const DOCTOR = 9;

    /** @param array<string,mixed> $over */
    function booking(array $over = []): array
    {
        return array_merge([
            'clinic_id' => 3, 'doctor_id' => DOCTOR, 'patient_id' => 7, 'start_date' => '2099-01-06',
            'start_time' => '10:00:00', 'end_date' => '2099-01-06', 'end_time' => '11:00:00',
            'service_ids' => [4], 'status' => 1, 'timezone' => 'Asia/Jakarta',
        ], $over);
    }

    function create(array $params): array|WP_Error
    {
        return (new Appointments())->create($params, new WP_REST_Request());
    }

    /** One process's answer, as a short word the parent can compare. */
    function outcome(array|WP_Error $result): string
    {
        return is_wp_error($result) ? $result->get_error_code() : 'won';
    }

    function bookedAt(Database $db, string $start): int
    {
        return (int) $db->get_var("SELECT COUNT(*) FROM wp_kc_appointments WHERE doctor_id = " . DOCTOR
            . " AND appointment_start_date = '2099-01-06' AND appointment_start_time = '{$start}' AND status IN (1,2,4)");
    }

    function refused(array|WP_Error $result, string $code, int $status, string $name): void
    {
        check(is_wp_error($result) && $result->get_error_code() === $code
            && (int) ($result->get_error_data()['status'] ?? 0) === $status, $name);
    }

    if (($argv[1] ?? '') === 'worker') {
        $GLOBALS['wpdb'] = schedule_test_db();
        $GLOBALS['model_delay_us'] = 150000;
        if ($argv[2] === 'create') {
            echo outcome(create(booking()));
        } else {
            $expected = $GLOBALS['wpdb']->get_row("SELECT * FROM wp_kc_appointments WHERE id = {$argv[3]}");
            try {
                (new Schedule_Write($GLOBALS['wpdb']))->move((int) $argv[3], $expected, '2099-01-06', '10:00:00', 'staff:test', 'r', fn () => true);
                echo 'won';
            } catch (RuntimeException $e) {
                echo $e->getMessage();
            }
        }
        exit;
    }

    /** Run the given workers at once; returns their answers, sorted. */
    function race(array $workers): array
    {
        $running = [];
        foreach ($workers as $args) {
            $p = proc_open(array_merge([PHP_BINARY, __FILE__, 'worker'], $args), [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes);
            $running[] = [$p, $pipes];
        }
        $answers = [];
        foreach ($running as [$p, $pipes]) {
            $answers[] = stream_get_contents($pipes[1]);
            $err = stream_get_contents($pipes[2]);
            fclose($pipes[1]);
            fclose($pipes[2]);
            if (proc_close($p) !== 0 || $err) {
                throw new RuntimeException($err);
            }
        }
        sort($answers);

        return $answers;
    }

    $db = schedule_test_setup();
    $GLOBALS['wpdb'] = $db;
    function reset_fixture(Database $db): void
    {
        $db->failOn = null;
        $GLOBALS['filters'] = [];
        $GLOBALS['actions'] = [];
        $db->query('DELETE FROM wp_kc_appointments');
        $db->query('DELETE FROM wp_kc_appointment_service_mapping');
    }

    reset_fixture($db);
    $first = create(booking());
    check(!is_wp_error($first) && bookedAt($db, '10:00:00') === 1, 'books a free slot');
    check((int) $db->get_var('SELECT COUNT(*) FROM wp_kc_appointment_service_mapping') === 1, 'service mapping written');

    $GLOBALS['actions'] = [];
    $clash = create(booking(['start_time' => '10:30:00', 'end_time' => '11:30:00', 'patient_id' => 8]));
    refused($clash, 'praktiqu_schedule_conflict', 409, 'an overlapping booking is refused with 409');
    check(bookedAt($db, '10:30:00') === 0 && $GLOBALS['actions'] === [], 'the refused booking wrote nothing and mailed nobody');

    check(!is_wp_error(create(booking(['doctor_id' => 10]))), 'another professional at the same time is fine');
    check(!is_wp_error(create(booking(['start_time' => '11:00:00', 'end_time' => '12:00:00']))), 'a booking starting when the last one ends is fine');

    reset_fixture($db);
    create(booking(['status' => 0]));
    check(!is_wp_error(create(booking())), 'a cancelled appointment does not hold its slot');

    reset_fixture($db);
    create(booking(['status' => 2]));
    refused(create(booking()), 'praktiqu_schedule_conflict', 409, 'a PENDING booking holds its slot');

    reset_fixture($db);
    create(booking());
    $GLOBALS['filters']['kivicare_appointment_data'] = function (array $data): array {
        $data['appointmentStartTime'] = '10:00:00';
        $data['appointmentEndTime'] = '11:00:00';

        return $data;
    };
    refused(create(booking(['start_time' => '14:00:00', 'end_time' => '15:00:00'])), 'praktiqu_schedule_conflict', 409, 'checks the slot the filter actually writes');

    reset_fixture($db);
    refused(create(booking(['end_time' => ''])), 'praktiqu_missing_field', 400, 'an active booking without an end time is refused');

    reset_fixture($db);
    $db->failOn = '/SELECT id FROM wp_kc_appointments\s+WHERE doctor_id/';
    refused(create(booking()), 'praktiqu_schedule_db_error', 500, 'a failed conflict query refuses the booking');
    $db->failOn = null;
    check(bookedAt($db, '10:00:00') === 0, 'and writes nothing');

    reset_fixture($db);
    $other = schedule_test_pdo();
    $other->query("SELECT GET_LOCK('praktiqu_doc_schedule_" . DOCTOR . "', 0)");
    refused(create(booking()), 'praktiqu_schedule_busy', 503, 'a professional whose schedule stays locked answers busy');
    $other->query("SELECT RELEASE_LOCK('praktiqu_doc_schedule_" . DOCTOR . "')");
    check(bookedAt($db, '10:00:00') === 0, 'and writes nothing while busy');

    for ($i = 0; $i < 10; $i++) {
        reset_fixture($db);
        $answers = race([['create'], ['create']]);
        check($answers === ['praktiqu_schedule_conflict', 'won'] && bookedAt($db, '10:00:00') === 1, "race $i: two bookings for one slot, exactly one wins");
    }

    for ($i = 0; $i < 10; $i++) {
        reset_fixture($db);
        $db->query("INSERT INTO wp_kc_appointments (doctor_id, clinic_id, patient_id, visit_type, status, appointment_start_date, appointment_start_time, appointment_end_date, appointment_end_time, appointment_timezone)
                    VALUES (" . DOCTOR . ", 3, 8, '4', 1, '2099-01-05', '09:00:00', '2099-01-05', '10:00:00', 'Asia/Jakarta')");
        $moving = (int) $db->pdo->lastInsertId();
        $answers = race([['create'], ['move', (string) $moving]]);
        check(in_array('won', $answers, true) && count(array_keys($answers, 'won', true)) === 1 && bookedAt($db, '10:00:00') === 1, "race $i: a booking and a reschedule into one slot, exactly one wins");
    }

    echo "ALL PASS (real MySQL; KiviCare model + WordPress shimmed; no mail)\n";
}
