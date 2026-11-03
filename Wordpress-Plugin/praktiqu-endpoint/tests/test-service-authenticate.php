<?php
/**
 * Assertions for Service::authenticate(). Plain PHP — no PHPUnit, no real WordPress —
 * runs in a bare `php:8.4-cli` container, same as the other files in this directory.
 *
 * What matters here is SEC-9: the answer to a WRONG password must not depend on the
 * account's status. authenticate() used to check `praktiqu_user_status` before the
 * password, so an inactive account answered 403 'inactive' to any password at all, and
 * anyone could learn an address had a deactivated account without knowing its password.
 *
 * The harness loads the real class unmodified, like test-jobs-secret-sanitizer.php:
 *   - ABSPATH is defined so the file's `defined('ABSPATH') || exit;` guard passes;
 *   - the handful of WordPress functions and classes authenticate() touches are shimmed
 *     over plain arrays. wp_check_password() is a stand-in hash comparison that also
 *     counts its calls, so the test can pin that every path runs exactly one check.
 */

declare(strict_types=1);

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

final class WP_User
{
    public int $ID = 0;
    public string $user_email = '';
    public string $user_login = '';
    public string $user_pass = '';
    public string $display_name = '';
    public string $first_name = '';
    public string $last_name = '';
    public string $user_registered = '2026-01-01 00:00:00';
    public int $user_status = 0;
    public array $roles = [];
}

/** @var array<string, WP_User> $USERS keyed by email */
$USERS = [];
/** @var array<int, array<string, string>> $META */
$META = [];
$PASSWORD_CHECKS = 0;

function get_user_by(string $field, $value)
{
    global $USERS;
    if ($field === 'email') {
        return $USERS[$value] ?? false;
    }
    foreach ($USERS as $u) {
        if ($u->ID === (int) $value) {
            return $u;
        }
    }
    return false;
}

function get_user_meta(int $user_id, string $key, bool $single = false)
{
    global $META;
    return $META[$user_id][$key] ?? '';
}

function wp_check_password(string $password, string $hash, $user_id = ''): bool
{
    global $PASSWORD_CHECKS;
    $PASSWORD_CHECKS++;
    return $hash === 'hash:' . $password;
}

function mysql2date(string $format, string $date): string
{
    return $date;
}

function is_wp_error($thing): bool
{
    return $thing instanceof WP_Error;
}

require_once __DIR__ . '/../includes/class-praktiqu-endpoint-service.php';

use PraktiQU\Endpoint\Service;

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

function add_user(int $id, string $email, string $password, ?string $status): void
{
    global $USERS, $META;
    $u = new WP_User();
    $u->ID = $id;
    $u->user_email = $email;
    $u->user_login = 'user' . $id;
    $u->user_pass = 'hash:' . $password;
    $u->roles = ['kiviCare_receptionist'];
    $USERS[$email] = $u;
    if ($status !== null) {
        $META[$id]['praktiqu_user_status'] = $status;
    }
}

/** Run authenticate() and report [code or 'ok', http status, password checks it ran]. */
function attempt(string $email, string $password): array
{
    global $PASSWORD_CHECKS;
    $PASSWORD_CHECKS = 0;
    $result = (new Service())->authenticate($email, $password);
    if ($result instanceof WP_Error) {
        return [$result->get_error_code(), $result->get_error_data()['status'] ?? null, $PASSWORD_CHECKS];
    }
    return ['ok', 200, $PASSWORD_CHECKS];
}

add_user(8750101, 'aktif@klinik.test', 'Benar-Sekali-1', 'active');
add_user(8750102, 'nonaktif@klinik.test', 'Benar-Sekali-2', 'inactive');
add_user(8750103, 'diblokir@klinik.test', 'Benar-Sekali-3', 'blocked');
add_user(8750104, 'lama@klinik.test', 'Benar-Sekali-4', null); // no status meta at all

echo "Service::authenticate — a wrong password never reveals the account's status\n";

check('inactive account + wrong password -> 401 invalid_credentials',
    attempt('nonaktif@klinik.test', 'tebakan'), ['invalid_credentials', 401, 1]);
check('blocked account + wrong password -> 401 invalid_credentials',
    attempt('diblokir@klinik.test', 'tebakan'), ['invalid_credentials', 401, 1]);
check('active account + wrong password -> 401 invalid_credentials',
    attempt('aktif@klinik.test', 'tebakan'), ['invalid_credentials', 401, 1]);
check('unknown address -> 401 invalid_credentials, still one (dummy) password check',
    attempt('hantu@klinik.test', 'tebakan'), ['invalid_credentials', 401, 1]);

echo "\nService::authenticate — the right password\n";

check('inactive account + right password -> 403 inactive',
    attempt('nonaktif@klinik.test', 'Benar-Sekali-2'), ['inactive', 403, 1]);
check('blocked account + right password -> 403 inactive',
    attempt('diblokir@klinik.test', 'Benar-Sekali-3'), ['inactive', 403, 1]);
check('active account + right password -> identity',
    attempt('aktif@klinik.test', 'Benar-Sekali-1'), ['ok', 200, 1]);
check('account with no status meta + right password -> identity',
    attempt('lama@klinik.test', 'Benar-Sekali-4'), ['ok', 200, 1]);

$identity = (new Service())->authenticate('  AKTIF@klinik.test ', 'Benar-Sekali-1');
check('email is trimmed and lower-cased before lookup', is_array($identity) ? $identity['wpUserId'] : $identity, 8750101);

echo "\nService::authenticate — empty input\n";

check('empty password -> 401 without a lookup', attempt('aktif@klinik.test', ''), ['invalid_credentials', 401, 0]);

echo "\n";
if ($failures > 0) {
    echo "{$failures} FAILURE(S)\n";
    exit(1);
}
echo "ALL PASS\n";
