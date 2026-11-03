<?php
/**
 * Safe schedule write seam for wp_kc_appointments.
 *
 * One per-doctor advisory lock + one InnoDB transaction around: re-read the row,
 * compare it with what the caller saw, check the target window, update, and queue
 * the external-sync outbox row. Status, bills and payments are never touched.
 *
 * Every statement fails closed. wpdb does not throw: a failed query sets last_error and
 * returns null/false, so an unchecked conflict query would read as "slot is free".
 *
 * COVERAGE LIMIT: internal foundation only, NOT wired into any production writer or
 * REST route yet. The lock only protects cooperating writers. KiviCare has no universal
 * pre-save hook.
 *
 * @package PraktiQU\Endpoint
 */

declare(strict_types=1);

namespace PraktiQU\Endpoint;

defined('ABSPATH') || exit;

final class Schedule_Write
{
    private const LOCK_WAIT_SECONDS = 5;
    /** BOOKED, PENDING, CHECK_IN occupy a slot (KCAppointment.php:493). */
    public const ACTIVE_STATUSES = [1, 2, 4];

    /** @param object $db wpdb-compatible: prefix, last_error, insert_id, prepare, query, get_var, get_row */
    public function __construct(private object $db)
    {
    }

    /**
     * Run $fn while holding the doctor's schedule lock. Every writer of that doctor's
     * appointments must use this same key.
     */
    public function locked(int $doctorId, callable $fn): mixed
    {
        $key = 'praktiqu_doc_schedule_' . $doctorId;
        $got = $this->db->get_var($this->db->prepare('SELECT GET_LOCK(%s, %d)', $key, self::LOCK_WAIT_SECONDS));
        if ((int) $got !== 1) {
            throw new \RuntimeException('schedule_busy');
        }
        try {
            return $fn();
        } finally {
            $this->db->get_var($this->db->prepare('SELECT RELEASE_LOCK(%s)', $key));
        }
    }

    /** Throws schedule_conflict when another active appointment of the doctor overlaps. */
    public function assertFree(int $doctorId, string $date, string $start, string $end, int $excludeId = 0): void
    {
        $t = $this->db->prefix . 'kc_appointments';
        $id = $this->checked($this->db->get_var($this->db->prepare(
            "SELECT id FROM {$t}
              WHERE doctor_id = %d AND appointment_start_date = %s AND status IN (" . implode(',', self::ACTIVE_STATUSES) . ')
                AND appointment_start_time < %s AND appointment_end_time > %s AND id <> %d
              LIMIT 1 FOR UPDATE',
            $doctorId,
            $date,
            $end,
            $start,
            $excludeId
        )));
        if ($id) {
            throw new \RuntimeException('schedule_conflict');
        }
    }

    /**
     * @param array<string,mixed> $expected row values the caller based its decision on
     * @param callable            $bounds   fn(array $row, \DateTimeImmutable $start, \DateTimeImmutable $end): bool
     *                                      clinic hours / off-days / service check supplied by the caller
     * @return array<string,mixed> the row after the move, plus outbox_id: the sync row it queued
     */
    public function move(
        int $appointmentId,
        array $expected,
        string $newDate,
        string $newStart,
        string $actor,
        string $requestId,
        callable $bounds
    ): array {
        if (!preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $newDate, $m) || !checkdate((int) $m[2], (int) $m[3], (int) $m[1])
            || !preg_match('/^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/', $newStart)) {
            throw new \RuntimeException('schedule_invalid');
        }
        $t = $this->db->prefix . 'kc_appointments';
        $doctorId = (int) ($expected['doctor_id'] ?? 0);
        if ($doctorId <= 0) {
            throw new \RuntimeException('schedule_invalid');
        }

        return $this->locked($doctorId, function () use ($appointmentId, $expected, $newDate, $newStart, $actor, $requestId, $bounds, $t, $doctorId) {
            foreach ([$t, $this->db->prefix . 'praktiqu_schedule_outbox'] as $table) {
                $engine = $this->checked($this->db->get_var($this->db->prepare(
                    'SELECT ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = %s', $table
                )));
                if (strtolower((string) $engine) !== 'innodb') {
                    throw new \RuntimeException('schedule_requires_innodb');
                }
            }
            if ($this->checked($this->db->query('START TRANSACTION')) === false) {
                throw new \RuntimeException('schedule_transaction_failed');
            }
            $done = false;
            try {
                $row = $this->checked($this->db->get_row($this->db->prepare("SELECT * FROM {$t} WHERE id = %d FOR UPDATE", $appointmentId), 'ARRAY_A'));
                if (!$row) {
                    throw new \RuntimeException('schedule_stale');
                }
                if (!in_array((int) $row['status'], [1, 2], true)) {
                    throw new \RuntimeException('schedule_terminal');
                }
                foreach (['doctor_id', 'clinic_id', 'status', 'appointment_start_date', 'appointment_start_time', 'appointment_end_date', 'appointment_end_time'] as $k) {
                    if ((string) ($row[$k] ?? '') !== (string) ($expected[$k] ?? '')) {
                        throw new \RuntimeException('schedule_stale');
                    }
                }
                $tz = (string) ($row['appointment_timezone'] ?: 'UTC');
                try {
                    $zone = new \DateTimeZone($tz);
                    $oldStart = new \DateTimeImmutable($row['appointment_start_date'] . ' ' . $row['appointment_start_time'], $zone);
                    $oldEnd = new \DateTimeImmutable($row['appointment_end_date'] . ' ' . $row['appointment_end_time'], $zone);
                    $start = new \DateTimeImmutable($newDate . ' ' . $newStart, $zone);
                } catch (\Exception $e) {
                    throw new \RuntimeException('schedule_invalid');
                }
                $seconds = $oldEnd->getTimestamp() - $oldStart->getTimestamp();
                if ($seconds <= 0) {
                    throw new \RuntimeException('schedule_invalid');
                }
                if ($newDate === $row['appointment_start_date'] && $start->format('H:i:s') === $row['appointment_start_time']) {
                    // The UPDATE would change no row and come back as 0 affected: "stale" would be the wrong answer.
                    throw new \RuntimeException('schedule_unchanged');
                }
                $end = $start->modify('+' . $seconds . ' seconds');
                if ($end->format('Y-m-d') !== $start->format('Y-m-d')) {
                    throw new \RuntimeException('schedule_unavailable'); // no cross-midnight slots
                }
                if ($start->getTimestamp() <= time() || !$bounds($row, $start, $end)) {
                    throw new \RuntimeException('schedule_unavailable');
                }
                $this->assertFree($doctorId, $newDate, $start->format('H:i:s'), $end->format('H:i:s'), $appointmentId);

                $utc = new \DateTimeZone('UTC');
                $new = [
                    'appointment_start_date' => $newDate,
                    'appointment_start_time' => $start->format('H:i:s'),
                    'appointment_end_date' => $newDate,
                    'appointment_end_time' => $end->format('H:i:s'),
                    'appointment_start_utc' => $start->setTimezone($utc)->format('Y-m-d H:i:s'),
                    'appointment_end_utc' => $end->setTimezone($utc)->format('Y-m-d H:i:s'),
                ];
                // Status is NOT in this statement: payment state must survive a move.
                $ok = $this->checked($this->db->query($this->db->prepare(
                    "UPDATE {$t} SET appointment_start_date = %s, appointment_start_time = %s, appointment_end_date = %s,
                            appointment_end_time = %s, appointment_start_utc = %s, appointment_end_utc = %s
                      WHERE id = %d AND status = %d",
                    $new['appointment_start_date'],
                    $new['appointment_start_time'],
                    $new['appointment_end_date'],
                    $new['appointment_end_time'],
                    $new['appointment_start_utc'],
                    $new['appointment_end_utc'],
                    $appointmentId,
                    (int) $row['status']
                )));
                if ($ok !== 1) {
                    throw new \RuntimeException('schedule_stale');
                }
                $payload = json_encode([
                    'from' => ['date' => $row['appointment_start_date'], 'start' => $row['appointment_start_time'], 'end' => $row['appointment_end_time']],
                    'to' => ['date' => $new['appointment_start_date'], 'start' => $new['appointment_start_time'], 'end' => $new['appointment_end_time']],
                    'timezone' => $tz,
                ], JSON_THROW_ON_ERROR);
                $inserted = $this->checked($this->db->query($this->db->prepare(
                    'INSERT INTO ' . $this->db->prefix . 'praktiqu_schedule_outbox (appointment_id, payload, actor, request_id) VALUES (%d, %s, %s, %s)',
                    $appointmentId,
                    $payload,
                    substr($actor, 0, 64),
                    substr($requestId, 0, 64)
                )));
                if ($inserted !== 1) {
                    throw new \RuntimeException('schedule_outbox_failed');
                }
                // The caller processes this row right after the commit (wpdb sets insert_id on INSERT).
                $outboxId = (int) $this->db->insert_id;
                $this->checked($this->db->query('COMMIT'));
                $done = true;

                return array_merge($row, $new, ['outbox_id' => $outboxId]);
            } finally {
                if (!$done) {
                    $this->db->query('ROLLBACK');
                }
            }
        });
    }

    /** Pass a wpdb result through, throwing when the statement that produced it failed. */
    private function checked(mixed $result): mixed
    {
        if ((string) $this->db->last_error !== '') {
            throw new \RuntimeException('schedule_db_error');
        }

        return $result;
    }
}
