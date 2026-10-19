<?php
/**
 * Processes wp_praktiqu_schedule_outbox rows.
 *
 * Runs after the schedule write has committed. Calls the existing KiviCare/Pro hooks
 * to sync calendar and reminders. If an external call fails, the row stays pending
 * with an incremented attempt count, visible for retry; it is never silently dropped.
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
     */
    public function __construct(
        private object $db,
        private \Closure $calendarSync,
        private \Closure $reminderSync
    ) {
    }

    /**
     * Process one outbox row.
     *
     * @return array{ok:bool,error?:string}
     */
    public function process(int $outboxId): array
    {
        $t = $this->db->prefix . 'praktiqu_schedule_outbox';
        $row = $this->db->get_row($this->db->prepare("SELECT * FROM {$t} WHERE id = %d", $outboxId), 'ARRAY_A');
        if (!$row || $row['status'] === 'done') {
            return ['ok' => true];
        }

        $appointmentId = (int) $row['appointment_id'];
        $attempts = (int) $row['attempts'] + 1;

        try {
            ($this->calendarSync)($appointmentId, json_decode((string) $row['payload'], true, 8, JSON_THROW_ON_ERROR));
            ($this->reminderSync)($appointmentId);

            $this->db->query($this->db->prepare(
                "UPDATE {$t} SET status = 'done', attempts = %d, done_at = %s, last_error = NULL WHERE id = %d",
                $attempts,
                current_time_compat(),
                $outboxId
            ));

            return ['ok' => true];
        } catch (\Throwable $e) {
            $status = $attempts >= self::MAX_ATTEMPTS ? 'failed' : 'pending';
            $this->db->query($this->db->prepare(
                "UPDATE {$t} SET status = %s, attempts = %d, last_error = %s, next_attempt_at = DATE_ADD(%s, INTERVAL %d MINUTE) WHERE id = %d",
                $status,
                $attempts,
                substr($e->getMessage(), 0, 500),
                current_time_compat(),
                $attempts * 5,
                $outboxId
            ));

            return ['ok' => false, 'error' => $e->getMessage()];
        }
    }
}

if (!function_exists('PraktiQU\Endpoint\current_time_compat')) {
    function current_time_compat(): string
    {
        return function_exists('current_time') ? (string) current_time('mysql') : (new \DateTimeImmutable('now', new \DateTimeZone('UTC')))->format('Y-m-d H:i:s');
    }
}
