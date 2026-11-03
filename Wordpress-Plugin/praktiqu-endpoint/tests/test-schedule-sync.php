<?php
/**
 * Assertions for Schedule_Sync, the external steps of a schedule move. Plain PHP — no
 * PHPUnit, no WordPress, no database — runs in a bare `php:8.4-cli` container.
 *
 * KiviCare's models, its telemed factory, KiviCare Pro's Google Calendar facade and the
 * Action Scheduler functions are shimmed in their own namespaces, and every call into
 * them is recorded in $GLOBALS['calls'].
 */

declare(strict_types=1);

namespace App\models {
    final class KCAppointment
    {
        public static function find($id): ?\FakeModel
        {
            return $GLOBALS['appointments'][(int) $id] ?? null;
        }
    }

    final class KCClinic
    {
        public static function find($id): object { return (object) ['id' => (int) $id, 'kind' => 'clinic']; }
    }

    final class KCPatient
    {
        public static function find($id): object { return (object) ['id' => (int) $id, 'kind' => 'patient']; }
    }

    final class KCDoctor
    {
        public static function find($id): object { return (object) ['id' => (int) $id, 'kind' => 'doctor']; }
    }

    final class KCService
    {
    }

    final class KCAppointmentServiceMapping
    {
        public static function table(string $alias): \FakeQuery
        {
            return new \FakeQuery();
        }
    }
}

namespace App\baseClasses {
    final class KCTelemedFactory
    {
        public static function get_provider_by_doctor_id($doctorId)
        {
            return $GLOBALS['provider'];
        }
    }
}

namespace KCProApp\controllers\api {
    final class GoogleCalendarIntegration
    {
        public static function getInstance(): self
        {
            return new self();
        }

        public function addAppointmentToGoogleCalendars($appointmentId, $appointmentData, $clinic, $patient, $doctor, $services): void
        {
            $GLOBALS['calls'][] = ['gcal', $appointmentId, $appointmentData, $clinic, $patient, $doctor, $services];
        }
    }
}

namespace {
    use PraktiQU\Endpoint\Schedule_Sync;

    define('ABSPATH', __DIR__ . '/');
    require_once __DIR__ . '/../includes/class-praktiqu-endpoint-schedule-sync.php';

    final class FakeModel
    {
        /** @param array<string,mixed> $attrs */
        public function __construct(private array $attrs)
        {
        }

        public function __get(string $key): mixed
        {
            return $this->attrs[$key] ?? null;
        }

        /** @return array<string,mixed> */
        public function toArray(): array
        {
            return $this->attrs;
        }
    }

    final class FakeCollection
    {
        /** @param list<array<string,mixed>> $rows */
        public function __construct(private array $rows)
        {
        }

        public function isEmpty(): bool
        {
            return $this->rows === [];
        }

        public function pluck(string $key): self
        {
            return new self(array_map(fn ($r) => [$key => $r[$key]], $this->rows));
        }

        /** @return list<mixed> */
        public function toArray(): array
        {
            return array_map(fn ($r) => array_values($r)[0], $this->rows);
        }
    }

    /** KiviCare's query builder, as far as Schedule_Sync uses it. */
    final class FakeQuery
    {
        public function select(array $cols): self { return $this; }
        public function leftJoin(...$args): self { return $this; }
        public function where(...$args): self { return $this; }
        public function get(): FakeCollection { return new FakeCollection($GLOBALS['services']); }
    }

    final class FakeProvider
    {
        public function __construct(private string $id, private ?object $meeting, private array|false $result = ['ok' => true])
        {
        }

        public function get_provider_id(): string
        {
            return $this->id;
        }

        public function get_meeting_by_appointment($appointmentId): ?object
        {
            return $this->meeting;
        }

        public function update_meeting($meetingId, $data = []): array|false
        {
            $GLOBALS['calls'][] = ['update_meeting', $this->id, $meetingId, $data];

            return $this->result;
        }
    }

    final class FakeWpdb
    {
        public string $prefix = 'wp_';
        public string $last_error = '';
        public int $gcal_rows = 0;

        public function prepare(string $query, ...$args): string
        {
            return vsprintf($query, $args);
        }

        public function get_var(string $query): mixed
        {
            return str_contains($query, 'kc_gcal_appointment_mapping') ? (string) $this->gcal_rows : null;
        }
    }

    function get_userdata($id): object
    {
        return (object) ['user_email' => $id === 7 ? 'klien@contoh.test' : 'psikolog@contoh.test'];
    }

    function wp_timezone_string(): string
    {
        return 'Asia/Jakarta';
    }

    // Action Scheduler, in memory: [hook|group|args json] => timestamp.
    function as_next_scheduled_action(string $hook, array $args, string $group): int|bool
    {
        return $GLOBALS['actions'][$hook . '|' . $group . '|' . json_encode($args)] ?? false;
    }

    function as_unschedule_action(string $hook, array $args, string $group): void
    {
        $GLOBALS['calls'][] = ['unschedule', $hook];
        unset($GLOBALS['actions'][$hook . '|' . $group . '|' . json_encode($args)]);
    }

    function as_schedule_single_action(int $at, string $hook, array $args, string $group): int
    {
        $GLOBALS['calls'][] = ['schedule', $hook, $at];
        $GLOBALS['actions'][$hook . '|' . $group . '|' . json_encode($args)] = $at;

        return 1;
    }

    function check(bool $ok, string $name): void
    {
        if (!$ok) {
            throw new RuntimeException("FAIL $name");
        }
        echo "PASS $name\n";
    }

    function calls(string $kind): array
    {
        return array_values(array_filter($GLOBALS['calls'], fn ($c) => $c[0] === $kind));
    }

    function reset_world(): void
    {
        $GLOBALS['calls'] = [];
        $GLOBALS['actions'] = [];
        $GLOBALS['provider'] = null;
        $GLOBALS['services'] = [['name' => 'Konseling Individu']];
        $GLOBALS['wpdb'] = new FakeWpdb();
        $GLOBALS['appointments'] = [812 => new FakeModel([
            'id' => 812, 'doctorId' => 34, 'patientId' => 7, 'clinicId' => 3, 'status' => 1,
            'description' => 'Sesi lanjutan', 'appointmentStartDate' => '2099-03-11', 'appointmentStartTime' => '10:00:00',
            'appointmentEndDate' => '2099-03-11', 'appointmentEndTime' => '11:00:00',
        ])];
    }

    // Moved from Tue 10 Mar 09:00-10:00 to Wed 11 Mar 10:00-11:00, Jakarta time.
    const PAYLOAD = [
        'from' => ['date' => '2099-03-10', 'start' => '09:00:00', 'end' => '10:00:00'],
        'to' => ['date' => '2099-03-11', 'start' => '10:00:00', 'end' => '11:00:00'],
        'timezone' => 'Asia/Jakarta',
    ];

    $sync = new Schedule_Sync();

    reset_world();
    $sync->calendar(812, PAYLOAD);
    check($GLOBALS['calls'] === [], 'no provider and no calendar event: nothing is called');

    reset_world();
    $GLOBALS['provider'] = new FakeProvider('googlemeet', null);
    $sync->calendar(812, PAYLOAD);
    check(calls('update_meeting') === [], 'a provider without a meeting for this appointment is left alone');

    reset_world();
    $GLOBALS['provider'] = new FakeProvider('googlemeet', (object) ['eventId' => 'evt-1', 'url' => 'https://meet.google.com/abc-defg-hij']);
    $sync->calendar(812, PAYLOAD);
    [$call] = calls('update_meeting');
    check($call[2] === 'evt-1', 'Meet: the existing event is updated');
    check($call[3]['start_time'] === '2099-03-11T10:00:00+07:00' && $call[3]['end_time'] === '2099-03-11T11:00:00+07:00', 'Meet: to the new time, with its offset');
    check($call[3]['attendees'] === ['klien@contoh.test', 'psikolog@contoh.test'] && $call[3]['topic'] === 'Konseling Individu'
        && $call[3]['doctor_id'] === 34 && $call[3]['timezone'] === 'Asia/Jakarta', 'Meet: keeps attendees, topic and owner');
    check($sync->meeting_url(812) === 'https://meet.google.com/abc-defg-hij', 'the online session link is readable after the update');

    reset_world();
    $GLOBALS['provider'] = new FakeProvider('googlemeet', (object) ['eventId' => 'evt-1'], false);
    $threw = false;
    try {
        $sync->calendar(812, PAYLOAD);
    } catch (RuntimeException $e) {
        $threw = $e->getMessage() === 'meet_update_failed';
    }
    check($threw, 'Meet: a refused update throws, so the outbox keeps the row for a retry');

    reset_world();
    $GLOBALS['provider'] = new FakeProvider('zoom', (object) ['zoomId' => 'z-9', 'joinUrl' => 'https://zoom.us/j/9']);
    $sync->calendar(812, PAYLOAD);
    [$call] = calls('update_meeting');
    check($call[2] === 'z-9' && $call[3] === ['start_time' => '2099-03-11 10:00:00', 'duration' => 60, 'doctor_id' => 34], 'Zoom: new start and duration');
    check($sync->meeting_url(812) === 'https://zoom.us/j/9', 'Zoom: join link is readable');

    reset_world();
    $sync->calendar(812, PAYLOAD);
    check(calls('gcal') === [], 'Google Calendar: no event mapped, no call');
    $GLOBALS['wpdb']->gcal_rows = 2;
    $sync->calendar(812, PAYLOAD);
    [$call] = calls('gcal');
    check($call[1] === 812 && $call[2]['appointmentStartDate'] === '2099-03-11' && $call[2]['status'] === 1
        && $call[3]->kind === 'clinic' && $call[4]->kind === 'patient' && $call[5]->kind === 'doctor'
        && $call[6]->pluck('name')->toArray() === ['Konseling Individu'], 'Google Calendar: KiviCare Pro syncs the moved appointment');

    reset_world();
    $sync->reminders(812, PAYLOAD);
    check($GLOBALS['calls'] === [], 'no pending KiviCare reminder: nothing scheduled');

    reset_world();
    // Pro reminder pending 24h before the old start: 9 Mar 09:00 Jakarta.
    $old = (new DateTimeImmutable('2099-03-09 09:00:00', new DateTimeZone('Asia/Jakarta')))->getTimestamp();
    $GLOBALS['actions']['kivicare_pro_appointment_reminder|kivicare-pro-reminders|[812]'] = $old;
    $sync->reminders(812, PAYLOAD);
    $expected = (new DateTimeImmutable('2099-03-10 10:00:00', new DateTimeZone('Asia/Jakarta')))->getTimestamp();
    check(calls('unschedule') === [['unschedule', 'kivicare_pro_appointment_reminder']]
        && calls('schedule') === [['schedule', 'kivicare_pro_appointment_reminder', $expected]], 'a pending KiviCare reminder moves by the same shift (+1 day +1 hour)');
    $sync->reminders(812, ['from' => PAYLOAD['to'], 'to' => PAYLOAD['to'], 'timezone' => 'Asia/Jakarta']);
    check(end($GLOBALS['actions']) === $expected, 'running it again with no shift leaves the reminder where it is');

    reset_world();
    $GLOBALS['actions']['kivicare_appointment_reminder|kivicare-reminders|[812]'] = time() + 3600;
    $sync->reminders(812, [
        'from' => ['date' => '2099-03-10', 'start' => '09:00:00', 'end' => '10:00:00'],
        'to' => ['date' => '2000-01-01', 'start' => '09:00:00', 'end' => '10:00:00'],
        'timezone' => 'Asia/Jakarta',
    ]);
    check(calls('unschedule') !== [] && calls('schedule') === [], 'a reminder that would land in the past is dropped, not rescheduled');

    echo "ALL PASS (KiviCare, Pro and Action Scheduler shimmed)\n";
}
