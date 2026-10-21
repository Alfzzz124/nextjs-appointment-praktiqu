<?php
/**
 * Processes wp_praktiqu_schedule_outbox rows.
 *
 * Runs after the schedule write has committed. Calls the existing KiviCare/Pro hooks
 * to sync calendar and reminders. If an external call fails, the row stays pending
 * with an incremented attempt count, visible for retry; it is never silently dropped.
 *
 * Every timestamp is the database clock (NOW()), matching the table's CURRENT_TIMESTAMP
 * defaults. WordPress's current_time('mysql') is the site timezone (UTC+7) while the
 * Hostinger server runs UTC, so mixing the two would put every retry 7 hours off.
 *
 * @package PraktiQU\Endpoint
 */

declare(strict_types=1);

namespace PraktiQU\Endpoint;

defined('ABSPATH') || exit;

final class Schedule_Outbox_Processor
{
    private const MAX_ATTEMPTS = 5;

    /**
     * Both steps are REQUIRED closures. There is deliberately no default: KiviCare Pro's
     * public GoogleCalendarIntegration::updateAppointmentToGoogleCalendars() catches and
     * logs its own exceptions and returns void, so calling it bare would mark a failed
     * calendar sync "done". The adapter that wraps it must report failure by throwing.
     *
     * Both must be idempotent: a retry after the reminder step failed runs the calendar
     * step again.
     */
    public function __construct(
        private object $db,
        private \Closure $calendarSync,
        private \Closure $reminderSync
    ) {
    }

    /**
     * Process one outbox row, if it is pending and due.
     *
     * The row is claimed with a per-row advisory lock, so a cron run and a manual retry
     * cannot both call the providers for it (KiviCare Pro's calendar facade can create a
     * duplicate event). MySQL drops the lock with the connection, so a worker that dies
     * mid-sync leaves the row pending, not stuck. A failed row is retried only after an
     * operator sets it back to pending.
     *
     * @return array{ok:bool,error?:string} ok = the row is synced
     */
    public function process(int $outboxId): array
    {
        $key = 'praktiqu_schedule_outbox_' . $outboxId;
        if ((int) $this->db->get_var($this->db->prepare('SELECT GET_LOCK(%s, 0)', $key)) !== 1) {
            return ['ok' => false, 'error' => 'outbox_busy'];
        }
        try {
            return $this->run($outboxId);
        } finally {
            $this->db->get_var($this->db->prepare('SELECT RELEASE_LOCK(%s)', $key));
        }
    }

    /** @return array{ok:bool,error?:string} */
    private function run(int $outboxId): array
    {
        $t = $this->db->prefix . 'praktiqu_schedule_outbox';
        // Read under the lock: another worker may have finished the row a moment ago.
        $row = $this->db->get_row($this->db->prepare(
            "SELECT *, next_attempt_at <= NOW() AS due FROM {$t} WHERE id = %d",
            $outboxId
        ), 'ARRAY_A');
        if ((string) $this->db->last_error !== '') {
            return ['ok' => false, 'error' => 'outbox_db_error'];
        }
        if (!$row || $row['status'] === 'done') {
            return ['ok' => true];
        }
        if ($row['status'] !== 'pending') {
            return ['ok' => false, 'error' => 'outbox_failed'];
        }
        if ((int) $row['due'] !== 1) {
            return ['ok' => false, 'error' => 'outbox_not_due'];
        }

        $attempts = (int) $row['attempts'] + 1;
        if ($attempts > self::MAX_ATTEMPTS) {
            // Only reachable when earlier attempts died before recording their outcome.
            $this->db->query($this->db->prepare("UPDATE {$t} SET status = 'failed' WHERE id = %d", $outboxId));

            return ['ok' => false, 'error' => 'outbox_failed'];
        }

        // Count the attempt before calling out. A provider call that kills the PHP process
        // (timeout, fatal) must still use up an attempt and its backoff, or the next run
        // would call it again at once, forever.
        $this->db->query($this->db->prepare(
            "UPDATE {$t} SET attempts = %d, next_attempt_at = NOW() + INTERVAL %d MINUTE WHERE id = %d",
            $attempts,
            $attempts * 5,
            $outboxId
        ));
        if ((string) $this->db->last_error !== '') {
            return ['ok' => false, 'error' => 'outbox_db_error'];
        }

        try {
            ($this->calendarSync)((int) $row['appointment_id'], json_decode((string) $row['payload'], true, 8, JSON_THROW_ON_ERROR));
            ($this->reminderSync)((int) $row['appointment_id']);
        } catch (\Throwable $e) {
            $this->db->query($this->db->prepare(
                "UPDATE {$t} SET status = %s, last_error = %s WHERE id = %d",
                $attempts >= self::MAX_ATTEMPTS ? 'failed' : 'pending',
                // Characters, not bytes: a byte cut can split a UTF-8 sequence, and
                // the invalid string would fail this very UPDATE under strict mode.
                mb_substr($e->getMessage(), 0, 500),
                $outboxId
            ));

            return ['ok' => false, 'error' => $e->getMessage()];
        }

        $this->db->query($this->db->prepare(
            "UPDATE {$t} SET status = 'done', done_at = NOW(), last_error = NULL WHERE id = %d",
            $outboxId
        ));
        if ((string) $this->db->last_error !== '') {
            return ['ok' => false, 'error' => 'outbox_db_error'];
        }

        return ['ok' => true];
    }
}
