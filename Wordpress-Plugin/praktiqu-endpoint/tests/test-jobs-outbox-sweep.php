<?php
/**
 * The outbox sweep's recurring Action Scheduler action. Plain PHP, no WordPress.
 *
 * A plugin update does not run the activation hook, so the action registers itself the
 * first time Action Scheduler is ready, once (an option keeps it to one query), and
 * deactivation — which unschedules the whole praktiqu-jobs group — forgets that it did.
 */

declare(strict_types=1);

namespace PraktiQU\Endpoint {
    final class Service {}
    final class Payments {}
}

namespace {
    use PraktiQU\Endpoint\Jobs;
    use PraktiQU\Endpoint\Jobs_Webhook;
    use PraktiQU\Endpoint\Payments;
    use PraktiQU\Endpoint\Plugin;
    use PraktiQU\Endpoint\Service;

    define('ABSPATH', __DIR__ . '/');

    function add_action(string $hook, $callback, int $priority = 10, int $accepted_args = 1): void
    {
        $GLOBALS['actions'][$hook][] = [$callback, $accepted_args];
    }
    function get_option(string $name, $default = false) { return $GLOBALS['options'][$name] ?? $default; }
    function update_option(string $name, $value, $autoload = null): bool { $GLOBALS['options'][$name] = $value; return true; }
    function delete_option(string $name): bool { unset($GLOBALS['options'][$name]); return true; }
    function as_has_scheduled_action(string $hook, $args = null, string $group = ''): bool
    {
        $GLOBALS['queries']++;
        return isset($GLOBALS['recurring'][$hook]);
    }
    function as_schedule_recurring_action(int $at, int $interval, string $hook, array $args = [], string $group = ''): int
    {
        $GLOBALS['recurring'][$hook] = [$interval, $group];
        return 1;
    }
    function as_unschedule_all_actions(string $hook, array $args = [], string $group = ''): void
    {
        $GLOBALS['recurring'] = [];
    }
    function flush_rewrite_rules(): void {}

    require_once __DIR__ . '/../includes/class-praktiqu-endpoint-jobs-webhook.php';
    require_once __DIR__ . '/../includes/class-praktiqu-endpoint-jobs.php';
    require_once __DIR__ . '/../includes/class-praktiqu-endpoint-plugin.php';

    function check(bool $ok, string $name): void
    {
        if (!$ok) {
            throw new RuntimeException("FAIL $name");
        }
        echo "PASS $name\n";
    }

    $GLOBALS['actions'] = [];
    $GLOBALS['options'] = [];
    $GLOBALS['recurring'] = [];
    $GLOBALS['queries'] = 0;
    $jobs = new Jobs(new Service(), new Payments(), new Jobs_Webhook());
    $jobs->register();
    check(($GLOBALS['actions']['praktiqu_schedule_outbox_sweep'][0][1] ?? null) === 0, 'wires the sweep hook, no arguments');
    check(($GLOBALS['actions']['action_scheduler_init'][0][0] ?? null) === [$jobs, 'ensure_outbox_sweep'], 'registers the sweep once Action Scheduler is ready');

    $jobs->ensure_outbox_sweep();
    check(($GLOBALS['recurring']['praktiqu_schedule_outbox_sweep'] ?? null) === [300, 'praktiqu-jobs'], 'every 5 minutes, in the praktiqu-jobs group');
    $queries = $GLOBALS['queries'];
    $jobs->ensure_outbox_sweep();
    check($GLOBALS['queries'] === $queries, 'later requests do not ask Action Scheduler again');

    Plugin::on_deactivation();
    check($GLOBALS['recurring'] === [] && !isset($GLOBALS['options']['praktiqu_outbox_sweep_registered']), 'deactivation drops the action and forgets it was registered');
    $jobs->ensure_outbox_sweep();
    check(isset($GLOBALS['recurring']['praktiqu_schedule_outbox_sweep']), 'so the next activation registers it again');

    $GLOBALS['options'] = [];
    $before = $GLOBALS['recurring'];
    $jobs->ensure_outbox_sweep();
    check($GLOBALS['recurring'] === $before && ($GLOBALS['options']['praktiqu_outbox_sweep_registered'] ?? null) === '1', 'an action already scheduled is not scheduled twice');

    echo "ALL PASS\n";
}
