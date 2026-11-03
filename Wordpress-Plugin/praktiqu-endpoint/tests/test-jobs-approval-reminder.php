<?php
/**
 * Jobs: hook praktiqu_approval_reminder (plugin 1.8.3, approval psikolog).
 *
 * Plain PHP — no PHPUnit, no WordPress. WordPress and Action Scheduler functions are
 * stubbed in the global namespace below; the class under test is the real file.
 *
 * What matters is the contract with Next.js:
 *   - enqueue() must accept the hook, or every reminder is dropped with a 400.
 *   - register() must wire it with ONE positional argument: Action Scheduler calls
 *     do_action_ref_array($hook, array_values($args)), so { appointmentId } arrives as
 *     the bare id.
 *   - the handler must call back with event approval.reminder and data { appointmentId },
 *     which is what src/services/approval/reminder-handler.ts reads.
 */

declare(strict_types=1);

namespace {
    define('ABSPATH', __DIR__ . '/');
    define('PRAKTIQU_ENDPOINT_JOBS_WEBHOOK_TEST', true);

    $GLOBALS['pq_actions'] = [];
    $GLOBALS['pq_scheduled'] = [];
    $GLOBALS['pq_posts'] = [];

    function add_action(string $hook, $callback, int $priority = 10, int $accepted_args = 1): void
    {
        $GLOBALS['pq_actions'][$hook] = $accepted_args;
    }

    function as_schedule_single_action(int $timestamp, string $hook, array $args = [], string $group = '')
    {
        $GLOBALS['pq_scheduled'][] = [$timestamp, $hook, $args, $group];
        return 42;
    }

    function get_option(string $name, $default = false)
    {
        return [
            'praktiqu_endpoint_jobs_webhook_url'    => 'https://next.test/api/v1/webhooks/wordpress-jobs',
            'praktiqu_endpoint_jobs_webhook_secret' => 'rahasia',
        ][$name] ?? $default;
    }

    function wp_remote_post(string $url, array $args = [])
    {
        $GLOBALS['pq_posts'][] = ['url' => $url, 'args' => $args];
        return ['response' => ['code' => 200]];
    }

    function is_wp_error($thing): bool
    {
        return false;
    }
}

namespace PraktiQU\Endpoint {
    // Only type hints in Jobs::__construct refer to these; the real classes need WordPress.
    final class Service {}
    final class Payments {}
}

namespace {
    use PraktiQU\Endpoint\Jobs;
    use PraktiQU\Endpoint\Jobs_Webhook;
    use PraktiQU\Endpoint\Payments;
    use PraktiQU\Endpoint\Service;

    require_once __DIR__ . '/../includes/class-praktiqu-endpoint-jobs-webhook.php';
    require_once __DIR__ . '/../includes/class-praktiqu-endpoint-jobs.php';

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

    $jobs = new Jobs(new Service(), new Payments(), new Jobs_Webhook());

    echo "Jobs::register\n";
    $jobs->register();
    check('wires praktiqu_approval_reminder with one argument', $GLOBALS['pq_actions']['praktiqu_approval_reminder'] ?? null, 1);
    check('keeps the existing unpaid-cancel hook', $GLOBALS['pq_actions']['praktiqu_booking_unpaid_cancel'] ?? null, 1);

    echo "Jobs::enqueue\n";
    check('accepts praktiqu_approval_reminder', $jobs->enqueue('praktiqu_approval_reminder', 1761000000, ['appointmentId' => 7]), 42);
    check('schedules it in the praktiqu-jobs group', $GLOBALS['pq_scheduled'][0] ?? null, [1761000000, 'praktiqu_approval_reminder', ['appointmentId' => 7], 'praktiqu-jobs']);
    check('still refuses an unknown hook', $jobs->enqueue('praktiqu_tidak_dikenal', 1761000000, []), false);

    echo "Jobs::handle_approval_reminder\n";
    $jobs->handle_approval_reminder(7);
    $post = $GLOBALS['pq_posts'][0] ?? null;
    check('calls the jobs webhook once', count($GLOBALS['pq_posts']), 1);
    check('posts to the configured URL', $post['url'] ?? null, 'https://next.test/api/v1/webhooks/wordpress-jobs');
    check('body is { event, data }', json_decode((string) ($post['args']['body'] ?? ''), true), ['event' => 'approval.reminder', 'data' => ['appointmentId' => 7]]);
    check('event header names approval.reminder', $post['args']['headers']['X-PraktiQU-Webhook-Event'] ?? null, 'approval.reminder');

    if ($failures > 0) {
        echo "{$failures} FAILURE(S)\n";
        exit(1);
    }
    echo "ALL PASS\n";
}
