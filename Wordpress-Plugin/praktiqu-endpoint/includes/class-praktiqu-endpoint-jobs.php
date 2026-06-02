<?php
/**
 * Jobs — enqueue background tasks from PraktiQU and run them via
 * WooCommerce Action Scheduler.
 *
 * Pattern (per audit C8):
 *   1. PraktiQU POSTs to /wp-json/praktiqu/v1/jobs
 *   2. We call as_schedule_single_action($runAt, $hook, $args, $group)
 *   3. WP-Cron fires the hook at $runAt
 *   4. The hook handler runs the job and (if needed) calls back to PraktiQU
 *      via the configured webhook URL.
 *
 * Supported hooks (registered in Jobs::register_handlers):
 *   - praktiqu_session_auto_complete   — session CHECK_OUT → COMPLETED after 24h
 *   - praktiqu_session_send_reminder   — T-24h or T-1h reminder trigger
 *   - praktiqu_log_purge              — daily log retention purge
 *
 * Action Scheduler is a soft dependency. If WooCommerce / Action Scheduler
 * is not active, the enqueue endpoint returns 503 and the job is dropped
 * (PraktiQU should treat this as a fatal error during the handshake).
 *
 * @package PraktiQU\Endpoint
 */

declare(strict_types=1);

namespace PraktiQU\Endpoint;

defined('ABSPATH') || exit;

final class Jobs
{
    public const GROUP = 'praktiqu-jobs';

    private Service $service;

    public function __construct(Service $service)
    {
        $this->service = $service;
    }

    /**
     * Register the WP hooks (action_scheduler callbacks + the REST routes are
     * in REST_Controller; this class only handles dispatch + handlers).
     */
    public function register(): void
    {
        add_action('praktiqu_session_auto_complete', [$this, 'handle_session_auto_complete'], 10, 1);
        add_action('praktiqu_session_send_reminder', [$this, 'handle_session_send_reminder'], 10, 2);
        add_action('praktiqu_log_purge', [$this, 'handle_log_purge'], 10, 0);

        // Daily purge schedule (registers a recurring AS event on activation).
        // The actual schedule registration lives in Plugin::on_activation.
    }

    /**
     * Enqueue a job. Called by REST_Controller::handle_enqueue_job().
     *
     * @param string $hook One of the supported hook names (see register()).
     * @param int    $runAt Unix timestamp.
     * @param array  $args  Args to pass to the handler.
     * @return int|false   Action Scheduler action ID, or false on failure.
     */
    public function enqueue(string $hook, int $runAt, array $args = [])
    {
        if (!function_exists('as_schedule_single_action')) {
            return false;
        }
        $allowed = [
            'praktiqu_session_auto_complete',
            'praktiqu_session_send_reminder',
            'praktiqu_log_purge',
        ];
        if (!in_array($hook, $allowed, true)) {
            return false;
        }
        return as_schedule_single_action($runAt, $hook, $args, self::GROUP);
    }

    /**
     * Cancel a previously-enqueued job by (hook, args) tuple. Best-effort.
     * Used when a session is cancelled and we need to drop its reminders.
     */
    public function cancel(string $hook, array $argsMatcher): bool
    {
        if (!function_exists('as_unschedule_all_actions')) {
            return false;
        }
        // Action Scheduler's unschedule is by exact args; we approximate by
        // unscheduling all actions with this hook + group and rely on the
        // handler being idempotent.
        as_unschedule_all_actions($hook, $argsMatcher, self::GROUP);
        return true;
    }

    // -------------------------------------------------------------------
    // Handlers
    // -------------------------------------------------------------------

    /**
     * Auto-complete a session 24h after its scheduled end time.
     * Called by Action Scheduler. We just call the PraktiQU webhook to
     * perform the actual state transition (so PraktiQU stays in control).
     */
    public function handle_session_auto_complete(int $session_id): void
    {
        $this->service->send_webhook('session.auto_complete', [
            'sessionId' => $session_id,
        ]);
    }

    /**
     * Send a session reminder. We notify PraktiQU (which actually composes
     * and sends the email via its own SMTP path).
     *
     * Args: [sessionId (int), channel (string: 'email'|'sms'|'whatsapp')]
     */
    public function handle_session_send_reminder(int $session_id, string $channel = 'email'): void
    {
        $this->service->send_webhook('session.reminder', [
            'sessionId' => $session_id,
            'channel'   => $channel,
        ]);
    }

    /**
     * Daily log retention purge. WordPress queries the shared MySQL
     * directly (we have the connection anyway) — no webhook needed.
     *
     * Retention rules (per docs/architecture/logging.md and constitution):
     *   - DEBUG, TRACE: 7 days
     *   - INFO, WARN, ERROR: 30 days
     *   - AUDIT: 90 days
     *   - PERF: 7 days
     */
    public function handle_log_purge(): void
    {
        global $wpdb;

        $levels = [
            'DEBUG' => 7,
            'TRACE' => 7,
            'INFO'  => 30,
            'WARN'  => 30,
            'ERROR' => 30,
            'AUDIT' => 90,
            'PERF'  => 7,
        ];

        $purged = 0;
        foreach ($levels as $level => $days) {
            $cutoff = gmdate('Y-m-d H:i:s', time() - ($days * DAY_IN_SECONDS));
            // phpcs:ignore WordPress.DB.DirectDatabaseQuery
            $rows = $wpdb->query(
                $wpdb->prepare(
                    "DELETE FROM `praktiqu_log_entries` WHERE `level` = %s AND `occurredAt` < %s",
                    $level,
                    $cutoff
                )
            );
            $purged += (int) $rows;
        }

        if (defined('WP_DEBUG') && WP_DEBUG) {
            error_log("[praktiqu-endpoint] log purge: removed {$purged} rows");
        }
    }
}
