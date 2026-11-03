<?php
/**
 * Assertions for ClinicAdmins::create(). Plain PHP — no PHPUnit, no real WordPress — runs in a
 * bare `php:8.4-cli` container, same as the other files in this directory.
 *
 * WordPress functions, WP_Error, WP_User and $wpdb are shimmed over plain arrays. The KiviCare
 * email sender class does not exist here, so create() takes its wp_new_user_notification()
 * fallback.
 */

declare(strict_types=1);

namespace {
    use PraktiQU\Endpoint\ClinicAdmins;

    define('ABSPATH', __DIR__ . '/');
    define('ARRAY_A', 'ARRAY_A');

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

        public function get_error_message(): string
        {
            return $this->message;
        }
    }

    final class WP_REST_Request
    {
    }

    final class WP_User
    {
        public function __construct(public int $ID)
        {
        }

        public function set_role(string $role): void
        {
            $GLOBALS['roles'][$this->ID] = $role;
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

    function sanitize_user(string $username, bool $strict = false): string
    {
        return (string) preg_replace('/[^a-z0-9._-]/i', '', $username);
    }

    function email_exists(string $email)
    {
        return in_array(strtolower($email), $GLOBALS['taken_emails'], true) ? 1 : false;
    }

    function username_exists(string $username)
    {
        return in_array($username, $GLOBALS['taken_usernames'], true) ? 1 : false;
    }

    function wp_generate_password(int $length = 12, bool $special = true): string
    {
        return 'Rahasia#1234';
    }

    function wp_insert_user(array $data)
    {
        $GLOBALS['inserted'][] = $data;
        return 900 + count($GLOBALS['inserted']);
    }

    function wp_delete_user(int $id): bool
    {
        $GLOBALS['deleted'][] = $id;
        return true;
    }

    function wp_new_user_notification(int $user_id, $deprecated = null, string $notify = ''): void
    {
        $GLOBALS['notified'][] = [$user_id, $notify];
    }

    function do_action(string $hook, ...$args): void
    {
        $GLOBALS['actions'][] = $hook;
    }

    final class FakeWpdb
    {
        public string $prefix = 'wp_';
        public bool $lose_race = false;

        /** @var array<int, array<string, mixed>> */
        public array $clinics = [];

        public function prepare(string $query, ...$args): string
        {
            return vsprintf($query, $args);
        }

        public function get_row(string $query, $output = null)
        {
            if (preg_match('/FROM wp_kc_clinics WHERE id = (\d+)/', $query, $m) !== 1) {
                return null;
            }
            return $this->clinics[(int) $m[1]] ?? null;
        }

        public function query(string $query)
        {
            if (preg_match('/UPDATE wp_kc_clinics SET clinic_admin_id = (\d+) WHERE id = (\d+) AND clinic_admin_id = 0/', $query, $m) !== 1) {
                return false;
            }
            $id = (int) $m[2];
            if ($this->lose_race || !isset($this->clinics[$id]) || (int) $this->clinics[$id]['clinic_admin_id'] !== 0) {
                return 0;
            }
            $this->clinics[$id]['clinic_admin_id'] = (int) $m[1];
            return 1;
        }
    }

    function reset_world(): void
    {
        global $wpdb;
        $wpdb = new FakeWpdb();
        $wpdb->clinics = [
            57 => ['id' => 57, 'name' => 'Klinik Baru', 'email' => 'kb@klinik.id', 'telephone_no' => '0221', 'address' => 'Jl. A', 'city' => 'Bandung', 'state' => '', 'country' => 'Indonesia', 'postal_code' => '40111', 'clinic_admin_id' => 0],
            58 => ['id' => 58, 'name' => 'Klinik Berpemilik', 'email' => null, 'telephone_no' => null, 'address' => null, 'city' => null, 'state' => null, 'country' => null, 'postal_code' => null, 'clinic_admin_id' => 512],
        ];
        $GLOBALS['taken_emails'] = ['lama@klinik.id'];
        $GLOBALS['taken_usernames'] = [];
        $GLOBALS['inserted'] = [];
        $GLOBALS['deleted'] = [];
        $GLOBALS['notified'] = [];
        $GLOBALS['actions'] = [];
        $GLOBALS['roles'] = [];
    }

    require_once __DIR__ . '/../includes/class-praktiqu-endpoint-clinic-admins.php';

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

    /** [status, code] of an error, or [201, body] of a success. */
    function create(array $params): array
    {
        $result = (new ClinicAdmins())->create($params, new WP_REST_Request());
        if ($result instanceof WP_Error) {
            return [$result->get_error_data()['status'] ?? null, $result->get_error_code()];
        }
        return [201, $result];
    }

    $ok = ['name' => 'Dewi Lestari', 'email' => 'dewi@contoh.id', 'clinic_id' => 57];

    echo "POST /clinic-admins — refusals\n";
    reset_world();
    check('bad email', create(['email' => 'bukan-email'] + $ok), [400, 'praktiqu_invalid_email']);
    check('empty name', create(['name' => '  <b></b> '] + $ok), [400, 'praktiqu_invalid_name']);
    check('missing clinic', create(['clinic_id' => 0] + $ok), [400, 'praktiqu_missing_clinic']);
    check('unknown clinic', create(['clinic_id' => 99] + $ok), [404, 'praktiqu_clinic_not_found']);
    check('clinic already has an admin', create(['clinic_id' => 58] + $ok), [409, 'praktiqu_clinic_has_admin']);
    check('email already registered', create(['email' => 'LAMA@klinik.id'] + $ok), [409, 'praktiqu_email_taken']);
    check('nothing was inserted by any refusal', $GLOBALS['inserted'], []);

    echo "\nPOST /clinic-admins — success\n";
    reset_world();
    [$status, $body] = create($ok);
    check('201', $status, 201);
    check('body', $body, ['id' => 901, 'email' => 'dewi@contoh.id', 'username' => 'dewi', 'clinic_id' => 57, 'email_sent' => true]);
    check('user fields', array_intersect_key($GLOBALS['inserted'][0], array_flip(['user_login', 'user_email', 'first_name', 'last_name', 'display_name', 'role'])), [
        'user_login' => 'dewi', 'user_email' => 'dewi@contoh.id', 'first_name' => 'Dewi', 'last_name' => 'Lestari', 'display_name' => 'Dewi Lestari', 'role' => 'kiviCare_clinic_admin',
    ]);
    check('real password handed to wp_insert_user', $GLOBALS['inserted'][0]['user_pass'], 'Rahasia#1234');
    check('role set', $GLOBALS['roles'][901] ?? null, 'kiviCare_clinic_admin');
    check('clinic now owned by the new user', $wpdb->clinics[57]['clinic_admin_id'], 901);
    check('fallback notification sent', $GLOBALS['notified'], [[901, 'user']]);
    check('KiviCare SMS hook fired, clinic-save hook not', $GLOBALS['actions'], ['kivicare_clinic_admin_registered']);

    echo "\nPOST /clinic-admins — edge cases\n";
    reset_world();
    $GLOBALS['taken_usernames'] = ['dewi'];
    check('username taken → suffix', create($ok)[1]['username'] ?? null, 'dewi1');

    reset_world();
    check('single-word name → last name "-"', [create(['name' => 'Dewi'] + $ok)[0], $GLOBALS['inserted'][0]['last_name'] ?? null], [201, '-']);

    reset_world();
    $wpdb->lose_race = true;
    check('lost the race for the clinic', create($ok), [409, 'praktiqu_clinic_has_admin']);
    check('the user it created is deleted again', $GLOBALS['deleted'], [901]);
    check('no notification for the deleted user', $GLOBALS['notified'], []);

    echo "\n";
    if ($failures > 0) {
        echo "{$failures} FAILURE(S)\n";
        exit(1);
    }
    echo "ALL PASS\n";
}
