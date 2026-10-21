<?php
/**
 * Shared by the test-schedule-*-db.php files: a wpdb-shaped wrapper over PDO, pointed at
 * a disposable database that the tests create and own.
 *
 * Configure with environment variables (never a WordPress, dev or production database):
 *   PRAKTIQU_TEST_MYSQL_DSN       e.g. mysql:host=127.0.0.1;port=3306  (no dbname)
 *   PRAKTIQU_TEST_MYSQL_USER      default root
 *   PRAKTIQU_TEST_MYSQL_PASSWORD  default empty
 *
 * Errors behave the way wpdb's do: nothing is thrown, last_error is set and the call
 * returns false (query) or null (get_var, get_row). PDO exceptions would hide exactly the
 * failures the code under test has to handle.
 */

declare(strict_types=1);

const SCHEDULE_TEST_DB = 'praktiqu_schedule_foundation_test';

final class Database
{
    public string $prefix = 'wp_';
    public string $last_error = '';
    /** A statement matching this regex fails the way wpdb reports a failed query. */
    public ?string $failOn = null;

    public function __construct(public PDO $pdo)
    {
    }

    /** Single pass, like wpdb: a substituted value is never scanned for placeholders. */
    public function prepare(string $sql, ...$args): string
    {
        $i = 0;

        return preg_replace_callback('/%[ds]/', function (array $m) use (&$i, $args): string {
            $arg = $args[$i++];

            return $m[0] === '%d' ? (string) (int) $arg : $this->pdo->quote((string) $arg);
        }, $sql);
    }

    public function query(string $sql): int|false
    {
        return $this->run($sql, fn () => $this->pdo->exec($sql), false);
    }

    public function get_var(string $sql): mixed
    {
        return $this->run($sql, function () use ($sql) {
            $value = $this->pdo->query($sql)->fetchColumn();

            return $value === false ? null : $value;
        }, null);
    }

    public function get_row(string $sql, $format = null): ?array
    {
        return $this->run($sql, fn () => $this->pdo->query($sql)->fetch(PDO::FETCH_ASSOC) ?: null, null);
    }

    private function run(string $sql, callable $fn, mixed $onError): mixed
    {
        $this->last_error = '';
        try {
            if ($this->failOn !== null && preg_match($this->failOn, $sql)) {
                throw new PDOException('injected failure');
            }

            return $fn();
        } catch (PDOException $e) {
            $this->last_error = $e->getMessage();

            return $onError;
        }
    }
}

function schedule_test_pdo(bool $withDatabase = true): PDO
{
    $dsn = (string) getenv('PRAKTIQU_TEST_MYSQL_DSN');
    if ($dsn === '' || stripos($dsn, 'dbname=') !== false) {
        fwrite(STDERR, "Set PRAKTIQU_TEST_MYSQL_DSN (without dbname) to a disposable MySQL/MariaDB server.\n");
        exit(2);
    }

    return new PDO(
        $dsn . ($withDatabase ? ';dbname=' . SCHEDULE_TEST_DB : ''),
        getenv('PRAKTIQU_TEST_MYSQL_USER') ?: 'root',
        (string) getenv('PRAKTIQU_TEST_MYSQL_PASSWORD'),
        [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]
    );
}

function schedule_test_db(): Database
{
    return new Database(schedule_test_pdo());
}

/** Create the disposable database and the outbox table from the real migration file. */
function schedule_test_setup(): Database
{
    schedule_test_pdo(false)->exec('CREATE DATABASE IF NOT EXISTS ' . SCHEDULE_TEST_DB);
    $db = schedule_test_db();
    $db->pdo->exec(file_get_contents(__DIR__ . '/../../../prisma/manual/2026-10-19-schedule-sync-outbox.sql'));

    return $db;
}

function check(bool $ok, string $name): void
{
    if (!$ok) {
        throw new RuntimeException("FAIL $name");
    }
    echo "PASS $name\n";
}
