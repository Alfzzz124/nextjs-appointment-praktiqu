<?php
/**
 * Assertions for Appointments::set_status(). Plain PHP — no PHPUnit, no real WordPress —
 * runs in a bare `php:8.4-cli` container, same as the other files in this directory.
 *
 * What matters is when `kc_appointment_payment_completed` fires. It is the hook KiviCare's
 * own KCAppointmentPaymentService::confirmPayment fires, and the only one besides
 * `kc_after_create_appointment` that sends the booking emails to patient, doctor and
 * clinic. A paid public booking is created PENDING (no create hook), so this is its one
 * chance. It must fire exactly once per payment, and never for a status change that is
 * not a payment — a staff approval must not mail "your payment has been processed".
 *
 * WordPress functions, WP_Error, WP_REST_Request, $wpdb and KiviCare's KCAppointment
 * model are shimmed over plain arrays.
 */

declare(strict_types=1);

namespace App\models {
    final class KCAppointment
    {
        public static function find($id): ?object
        {
            $row = $GLOBALS['wpdb']->appointments[(int) $id] ?? null;
            return $row === null ? null : (object) $row;
        }
    }
}

namespace {
    use PraktiQU\Endpoint\Appointments;

    define('ABSPATH', __DIR__ . '/');

    // A listener that throws is part of what is tested; its log line is noise here.
    ini_set('error_log', '/dev/null');

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
        /** @param array<string,mixed> $params */
        public function __construct(private array $params = [])
        {
        }

        public function get_param(string $key): mixed
        {
            return $this->params[$key] ?? null;
        }
    }

    function is_wp_error($thing): bool
    {
        return $thing instanceof WP_Error;
    }

    function sanitize_text_field(string $text): string
    {
        return trim(strip_tags($text));
    }

    function absint($value): int
    {
        return abs((int) $value);
    }

    function add_action(string $hook, callable $listener): void
    {
        $GLOBALS['listeners'][$hook][] = $listener;
    }

    function do_action(string $hook, ...$args): void
    {
        $GLOBALS['actions'][] = [$hook, $args];
        foreach ($GLOBALS['listeners'][$hook] ?? [] as $listener) {
            $listener(...$args);
        }
    }

    final class FakeWpdb
    {
        public string $prefix = 'wp_';

        /** Another request moves the row off PENDING just before our claim runs. */
        public bool $lose_race = false;

        /** @var array<int, array<string, mixed>> */
        public array $appointments = [];

        public function prepare(string $query, ...$args): string
        {
            return vsprintf($query, $args);
        }

        /** The conditional claim: UPDATE … SET status = B WHERE id = I AND status = P. */
        public function query(string $query)
        {
            if (preg_match('/UPDATE wp_kc_appointments SET status = (\d+) WHERE id = (\d+) AND status = (\d+)/', $query, $m) !== 1) {
                return false;
            }
            [, $to, $id, $from] = array_map('intval', $m);
            if ($this->lose_race && isset($this->appointments[$id])) {
                $this->appointments[$id]['status'] = $to;
            }
            if (!isset($this->appointments[$id]) || $this->appointments[$id]['status'] !== $from) {
                return 0;
            }
            $this->appointments[$id]['status'] = $to;
            return 1;
        }

        /** The re-read after a missed claim: SELECT status FROM … WHERE id = I. */
        public function get_var(string $query)
        {
            if (preg_match('/SELECT status FROM wp_kc_appointments WHERE id = (\d+)/', $query, $m) !== 1) {
                return null;
            }
            $row = $this->appointments[(int) $m[1]] ?? null;
            return $row === null ? null : (string) $row['status'];
        }

        /** Like MySQL, an UPDATE that leaves the value as it was affects 0 rows, not false. */
        public function update(string $table, array $data, array $where, $format = null, $where_format = null)
        {
            $id = (int) $where['id'];
            if ($table !== 'wp_kc_appointments' || !isset($this->appointments[$id])) {
                return 0;
            }
            $changed = $this->appointments[$id]['status'] !== (int) $data['status'];
            $this->appointments[$id]['status'] = (int) $data['status'];
            return $changed ? 1 : 0;
        }
    }

    const PAID = ['gateway' => 'xendit', 'wc_order_id' => 49863, 'transaction_id' => 'xnd-tx-1'];

    function reset_world(int $status): void
    {
        global $wpdb;
        $wpdb = new FakeWpdb();
        $wpdb->appointments = [3358 => ['id' => 3358, 'status' => $status]];
        $GLOBALS['actions'] = [];
        $GLOBALS['listeners'] = [];
    }

    /** @return string[] */
    function fired(): array
    {
        return array_map(static fn(array $a): string => $a[0], $GLOBALS['actions']);
    }

    function payment_hooks(): array
    {
        return array_values(array_filter($GLOBALS['actions'], static fn(array $a): bool => $a[0] === 'kc_appointment_payment_completed'));
    }

    function set_status(int $status, array $params = [], int $id = 3358)
    {
        return (new Appointments())->set_status($id, $status, new WP_REST_Request($params));
    }

    require_once __DIR__ . '/../includes/class-praktiqu-endpoint-appointments.php';

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

    echo "PENDING → BOOKED with a payment\n";
    reset_world(2);
    // Same signature and first check as KCAppointmentNotificationListener::handleAppointmentBooked,
    // which returns without mailing while the row still reads PENDING.
    $seen = null;
    add_action('kc_appointment_payment_completed', static function (int $appointmentId, array $paymentData) use (&$seen): void {
        $seen = \App\models\KCAppointment::find($appointmentId)?->status;
    });
    $result = set_status(1, ['status' => 1, 'payment' => PAID]);
    check('the listener reads the row as BOOKED already', $seen, 1);
    check('row is BOOKED', $wpdb->appointments[3358]['status'], 1);
    check('payment hook fired exactly once', count(payment_hooks()), 1);
    check('with KiviCare\'s (int id, array data) arguments', payment_hooks()[0][1] ?? null, [3358, [
        'gateway'        => 'xendit',
        'transaction_id' => 'xnd-tx-1',
        'payment_id'     => '49863',
        'payment_status' => 'completed',
    ]]);
    check('status hook still fires, before it', fired(), ['kc_appointment_status_update', 'kc_appointment_payment_completed']);
    check('response says the payment was confirmed', $result['payment_confirmed'] ?? null, true);

    echo "\nThe same payment confirmed twice (webhook, then the client's status poll)\n";
    set_status(1, ['status' => 1, 'payment' => PAID]);
    check('still exactly one payment hook', count(payment_hooks()), 1);

    echo "\nTwo confirmations racing past Next.js's PENDING read\n";
    reset_world(2);
    $wpdb->lose_race = true;
    $result = set_status(1, ['status' => 1, 'payment' => PAID]);
    check('the loser fires no payment hook', count(payment_hooks()), 0);
    check('the row stays BOOKED', $wpdb->appointments[3358]['status'], 1);
    check('and is not an error', is_array($result), true);
    check('response says this request did not confirm it', $result['payment_confirmed'] ?? null, false);

    echo "\nPENDING → BOOKED without a payment (staff approval)\n";
    reset_world(2);
    set_status(1, ['status' => 1]);
    check('row is BOOKED', $wpdb->appointments[3358]['status'], 1);
    check('no payment hook — nobody paid', fired(), ['kc_appointment_status_update']);

    echo "\nA payment on anything that is not PENDING → BOOKED\n";
    foreach ([[1, 1, 'BOOKED → BOOKED'], [2, 2, 'PENDING → PENDING'], [0, 1, 'CANCELLED → BOOKED'], [4, 1, 'CHECK_IN → BOOKED']] as [$from, $to, $label]) {
        reset_world($from);
        set_status($to, ['status' => $to, 'payment' => PAID]);
        check("{$label}: no payment hook", count(payment_hooks()), 0);
        check("{$label}: row set as asked, as before", $wpdb->appointments[3358]['status'], $to);
    }
    reset_world(2);
    set_status(0, ['status' => 0, 'payment' => PAID]);
    check('PENDING → CANCELLED: cancellation hooks only', fired(), ['kc_appointment_cancelled', 'kc_appointment_status_update']);

    echo "\nOther transitions are unchanged\n";
    foreach ([[1, 4], [4, 3], [1, 0], [2, 0]] as [$from, $to]) {
        reset_world($from);
        set_status($to, ['status' => $to]);
        $expected = $to === 0 ? ['kc_appointment_cancelled', 'kc_appointment_status_update'] : ['kc_appointment_status_update'];
        check("{$from} → {$to}: same hooks as 1.8.0", fired(), $expected);
    }

    echo "\nA payment listener that throws\n";
    reset_world(2);
    add_action('kc_appointment_payment_completed', static function (): void {
        throw new \RuntimeException('mail transport down');
    });
    $result = set_status(1, ['status' => 1, 'payment' => PAID]);
    check('the hook did fire', count(payment_hooks()), 1);
    check('the committed status is still reported as success', $result['status'] ?? null, 1);
    check('row is BOOKED', $wpdb->appointments[3358]['status'], 1);

    // expect_status (1.8.4): a compare-and-set. PraktiQU's approval sends it so an approval
    // whose plugin call lands after a cancellation cannot rewrite CANCELLED as BOOKED.
    echo "\nexpect_status PENDING, with a payment, on a PENDING row\n";
    reset_world(2);
    $result = set_status(1, ['status' => 1, 'payment' => PAID, 'expect_status' => 2]);
    check('row is BOOKED', $wpdb->appointments[3358]['status'], 1);
    check('payment hook fired exactly once', count(payment_hooks()), 1);
    check('status hook before it', fired(), ['kc_appointment_status_update', 'kc_appointment_payment_completed']);
    check('response: claimed, payment confirmed', [$result['claimed'] ?? null, $result['payment_confirmed'] ?? null], [true, true]);

    echo "\nexpect_status PENDING on a row cancelled meanwhile\n";
    reset_world(0);
    $result = set_status(1, ['status' => 1, 'payment' => PAID, 'expect_status' => 2]);
    check(
        '409 praktiqu_status_conflict naming the current status',
        $result instanceof WP_Error ? [$result->get_error_code(), $result->get_error_data()] : $result,
        ['praktiqu_status_conflict', ['status' => 409, 'current_status' => 0]],
    );
    check('row stays CANCELLED', $wpdb->appointments[3358]['status'], 0);
    check('nothing fired', fired(), []);

    echo "\nexpect_status PENDING on a row another request already BOOKED\n";
    foreach ([[1, 'already BOOKED'], [2, 'BOOKED by a racing request']] as [$start, $label]) {
        reset_world($start);
        $wpdb->lose_race = $start === 2;
        $result = set_status(1, ['status' => 1, 'payment' => PAID, 'expect_status' => 2]);
        check("{$label}: not an error", is_array($result), true);
        check("{$label}: not claimed, payment not confirmed here", [$result['claimed'] ?? null, $result['payment_confirmed'] ?? null], [false, false]);
        check("{$label}: row stays BOOKED", $wpdb->appointments[3358]['status'], 1);
        check("{$label}: nothing fired", fired(), []);
    }

    echo "\nexpect_status PENDING without a payment (marked paid by hand, then approved)\n";
    reset_world(2);
    $result = set_status(1, ['status' => 1, 'expect_status' => 2]);
    check('row is BOOKED', $wpdb->appointments[3358]['status'], 1);
    check('status hook only, no payment hook', fired(), ['kc_appointment_status_update']);
    check('response: claimed, no payment', [$result['claimed'] ?? null, $result['payment_confirmed'] ?? null], [true, false]);
    reset_world(4);
    $result = set_status(1, ['status' => 1, 'expect_status' => 2]);
    check(
        'on a CHECK_IN row: 409, row untouched',
        [$result instanceof WP_Error ? $result->get_error_data() : $result, $wpdb->appointments[3358]['status'], fired()],
        [['status' => 409, 'current_status' => 4], 4, []],
    );

    echo "\nexpect_status on a cancellation\n";
    reset_world(2);
    set_status(0, ['status' => 0, 'expect_status' => 2]);
    check('PENDING → CANCELLED claimed: cancellation hooks', fired(), ['kc_appointment_cancelled', 'kc_appointment_status_update']);

    echo "\nUnknown appointment\n";
    reset_world(2);
    $result = set_status(1, ['status' => 1, 'payment' => PAID], 9999);
    check('404', $result instanceof WP_Error ? [$result->get_error_data()['status'], $result->get_error_code()] : $result, [404, 'praktiqu_appointment_not_found']);
    check('nothing fired', fired(), []);

    echo "\n";
    if ($failures > 0) {
        echo "{$failures} FAILURE(S)\n";
        exit(1);
    }
    echo "ALL PASS\n";
}
