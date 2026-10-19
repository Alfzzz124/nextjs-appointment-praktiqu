<?php
/**
 * Assertions for Patients::create() when the email already has a WordPress account.
 * Plain PHP — no PHPUnit, no real WordPress — runs in a bare `php:8.4-cli` container,
 * same as the other files in this directory.
 *
 * The case: a client who signed up through WooCommerce (role `customer`) is booked by
 * clinic staff. The address exists, so a plain create answers 409 and the booking dies.
 * With `adopt_existing`, an account that holds only ordinary site roles gains the patient
 * role instead; staff accounts are still refused.
 */

declare(strict_types=1);

namespace {
    use PraktiQU\Endpoint\Patients;

    define('ABSPATH', __DIR__ . '/');

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
    }

    final class WP_User
    {
        public array $roles = [];
        public string $first_name = '';
        public string $last_name = '';
        public string $user_email = '';
        public string $user_login = '';

        public function __construct(public int $ID)
        {
            $row = $GLOBALS['users'][$ID] ?? [];
            $this->roles = $row['roles'] ?? [];
            $this->first_name = $GLOBALS['meta'][$ID]['first_name'] ?? '';
            $this->last_name = $GLOBALS['meta'][$ID]['last_name'] ?? '';
            $this->user_email = $row['email'] ?? '';
            $this->user_login = $row['login'] ?? '';
        }

        public function set_role(string $role): void
        {
            $GLOBALS['users'][$this->ID]['roles'] = [$role];
        }

        public function add_role(string $role): void
        {
            $GLOBALS['users'][$this->ID]['roles'][] = $role;
        }
    }

    function is_wp_error($thing): bool
    {
        return $thing instanceof WP_Error;
    }

    function sanitize_email(string $email): string
    {
        return trim($email);
    }

    function is_email(string $email): bool
    {
        return filter_var($email, FILTER_VALIDATE_EMAIL) !== false;
    }

    function sanitize_text_field(string $text): string
    {
        return trim(strip_tags($text));
    }

    function sanitize_textarea_field(string $text): string
    {
        return trim(strip_tags($text));
    }

    function sanitize_user(string $username, bool $strict = false): string
    {
        return (string) preg_replace('/[^a-z0-9._-]/i', '', $username);
    }

    function email_exists(string $email)
    {
        foreach ($GLOBALS['users'] as $id => $row) {
            if (strtolower($row['email']) === strtolower($email)) {
                return $id;
            }
        }
        return false;
    }

    function get_user_by(string $field, $value)
    {
        return $field === 'id' && isset($GLOBALS['users'][(int) $value]) ? new WP_User((int) $value) : false;
    }

    function username_exists(string $username)
    {
        return false;
    }

    function wp_generate_password(int $length = 12, bool $special = true): string
    {
        return 'Rahasia#1234';
    }

    function wp_insert_user(array $data)
    {
        $GLOBALS['inserted'][] = $data;
        $id = 900 + count($GLOBALS['inserted']);
        $GLOBALS['users'][$id] = ['email' => $data['user_email'], 'login' => $data['user_login'], 'roles' => [$data['role']]];
        return $id;
    }

    function wp_update_user(array $data)
    {
        $GLOBALS['updated'][] = $data;
        foreach (['first_name', 'last_name'] as $key) {
            if (isset($data[$key])) {
                $GLOBALS['meta'][$data['ID']][$key] = $data[$key];
            }
        }
        return $data['ID'];
    }

    function get_user_meta(int $user_id, string $key, bool $single = false)
    {
        return $GLOBALS['meta'][$user_id][$key] ?? '';
    }

    function update_user_meta(int $user_id, string $key, $value): void
    {
        $GLOBALS['meta'][$user_id][$key] = $value;
    }

    function get_current_user_id(): int
    {
        return 0;
    }

    function wp_json_encode($data, int $flags = 0): string
    {
        return (string) json_encode($data, $flags);
    }

    function wp_get_attachment_url(int $id): string
    {
        return '';
    }

    function current_time(string $type): string
    {
        return '2026-10-19 10:00:00';
    }

    function do_action(string $hook, ...$args): void
    {
        $GLOBALS['actions'][] = $hook;
    }

    final class FakeWpdb
    {
        public string $prefix = 'wp_';

        public function prepare(string $query, ...$args): string
        {
            return vsprintf($query, $args);
        }

        public function get_var(string $query)
        {
            foreach ($GLOBALS['mappings'] as $row) {
                if (str_contains($query, "patient_id = {$row['patient_id']} AND clinic_id = {$row['clinic_id']}")) {
                    return 1;
                }
            }
            return null;
        }

        public function insert(string $table, array $data, array $format): void
        {
            $GLOBALS['mappings'][] = ['patient_id' => $data['patient_id'], 'clinic_id' => $data['clinic_id']];
        }
    }

    function reset_world(): void
    {
        global $wpdb;
        $wpdb = new FakeWpdb();
        $GLOBALS['users'] = [
            1032 => ['email' => 'dao@contoh.id', 'login' => 'dao', 'roles' => ['customer']],
            1040 => ['email' => 'langganan@contoh.id', 'login' => 'langganan', 'roles' => ['subscriber']],
            77   => ['email' => 'psikolog@klinik.id', 'login' => 'psikolog', 'roles' => ['kiviCare_doctor']],
            53   => ['email' => 'editor@praktiqu.com', 'login' => 'editor', 'roles' => ['editor']],
            60   => ['email' => 'campur@contoh.id', 'login' => 'campur', 'roles' => ['customer', 'shop_manager']],
            61   => ['email' => 'tanpa-peran@contoh.id', 'login' => 'tanpa', 'roles' => []],
            500  => ['email' => 'pasien@contoh.id', 'login' => 'pasien', 'roles' => ['kiviCare_patient']],
        ];
        $GLOBALS['meta'] = [
            1032 => ['first_name' => 'Dao', 'last_name' => ''],
        ];
        $GLOBALS['inserted'] = [];
        $GLOBALS['updated'] = [];
        $GLOBALS['actions'] = [];
        $GLOBALS['mappings'] = [];
    }

    require_once __DIR__ . '/../includes/class-praktiqu-endpoint-patients.php';

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

    /** [status, code] of an error, or ['ok', body] of a success. */
    function create(array $params): array
    {
        $result = (new Patients())->create($params, new WP_REST_Request());
        if ($result instanceof WP_Error) {
            return [$result->get_error_data()['status'] ?? null, $result->get_error_code()];
        }
        return ['ok', $result];
    }

    $booking = ['first_name' => 'Dao', 'last_name' => 'Anh', 'contact_number' => '0812345678', 'clinic_id' => 4];

    echo "POST /patients — existing account, no adopt_existing (unchanged)\n";
    reset_world();
    check('customer email → 409', create(['email' => 'dao@contoh.id'] + $booking), [409, 'praktiqu_email_taken']);
    check('role untouched', $GLOBALS['users'][1032]['roles'], ['customer']);
    check('adopt_existing=false is the same as absent', create(['email' => 'dao@contoh.id', 'adopt_existing' => false] + $booking), [409, 'praktiqu_email_taken']);

    echo "\nPOST /patients — adopt a WooCommerce customer\n";
    reset_world();
    [$status, $body] = create(['email' => 'DAO@contoh.id', 'adopt_existing' => true] + $booking);
    check('succeeds', $status, 'ok');
    check('same user id, no new user', [$body['id'] ?? null, $GLOBALS['inserted']], [1032, []]);
    check('patient role ADDED, customer kept for WooCommerce', $GLOBALS['users'][1032]['roles'], ['customer', 'kiviCare_patient']);
    check('flagged as adopted', $body['adopted'] ?? null, true);
    check('phone stored in basic_data', json_decode($GLOBALS['meta'][1032]['basic_data'], true)['mobile_number'] ?? null, '0812345678');
    check('mapped to the clinic', $GLOBALS['mappings'], [['patient_id' => 1032, 'clinic_id' => 4]]);
    check('existing first name kept, empty last name filled', [$GLOBALS['meta'][1032]['first_name'], $GLOBALS['meta'][1032]['last_name']], ['Dao', 'Anh']);
    check('no welcome email / registration hooks, update hook only', $GLOBALS['actions'], ['kc_patient_update']);
    check('no temp password in payload', array_key_exists('temp_password', $body) ? $body['temp_password'] : 'missing', null);

    reset_world();
    check('subscriber is adopted too', [create(['email' => 'langganan@contoh.id', 'adopt_existing' => true] + $booking)[0], $GLOBALS['users'][1040]['roles']], ['ok', ['subscriber', 'kiviCare_patient']]);

    reset_world();
    [$status, $body] = create(['email' => 'pasien@contoh.id', 'adopt_existing' => true] + $booking);
    check('already a patient → reused, role not doubled', [$status, $body['id'] ?? null, $GLOBALS['users'][500]['roles']], ['ok', 500, ['kiviCare_patient']]);

    echo "\nPOST /patients — adopt_existing still refuses staff and site accounts\n";
    foreach ([
        'psikolog (kiviCare_doctor)' => 'psikolog@klinik.id',
        'site editor' => 'editor@praktiqu.com',
        'customer who is also shop_manager' => 'campur@contoh.id',
        'account with no role at all' => 'tanpa-peran@contoh.id',
    ] as $label => $email) {
        reset_world();
        $before = $GLOBALS['users'];
        check("{$label} → 409", create(['email' => $email, 'adopt_existing' => true] + $booking), [409, 'praktiqu_email_taken']);
        check("{$label}: nothing changed", [$GLOBALS['users'], $GLOBALS['mappings'], $GLOBALS['actions']], [$before, [], []]);
    }

    echo "\nPOST /patients — new address still creates\n";
    reset_world();
    [$status, $body] = create(['email' => 'baru@contoh.id', 'adopt_existing' => true] + $booking);
    check('created new user', [$status, $body['id'] ?? null, count($GLOBALS['inserted'])], ['ok', 901, 1]);
    check('registration hooks fired', $GLOBALS['actions'], ['kc_patient_save', 'kivicare_patient_registered']);
    check('not flagged as adopted', $body['adopted'] ?? null, null);

    echo "\n";
    if ($failures > 0) {
        echo "{$failures} FAILURE(S)\n";
        exit(1);
    }
    echo "ALL PASS\n";
}
