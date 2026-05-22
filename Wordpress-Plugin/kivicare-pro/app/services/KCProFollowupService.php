<?php

namespace KCProApp\services;

use DateTimeImmutable;
use DateTimeZone;
use Exception;
use KCProApp\baseClasses\KCProChainAuditService;
use KCProApp\baseClasses\KCProFollowupSettings;
use KCProApp\baseClasses\KCProStateTransitionValidator;
use RuntimeException;
use App\models\KCUser;
use KCProApp\models\KCProFollowup;
use KCProApp\models\KCProFollowupChain;
use KCProApp\models\KCProFollowupActivityLog;
use KCProApp\models\KCProFollowupReminder;
use KCProApp\services\KCProReminderService;

defined('ABSPATH') or die('Something went wrong');

class KCProFollowupService
{
    /**
     * @var KCProFollowupService|null
     */
    private static $instance = null;

    /**
     * @return KCProFollowupService
     */
    public static function get_instance(): KCProFollowupService
    {
        if (self::$instance === null) {
            self::$instance = new self();
        }

        return self::$instance;
    }

    /**
     * Calculates the UTC boundaries for the targeted date in the Doctor's timezone.
     *
     * @param string $doctorTimezone
     * @param string $timeframeOrDate
     * @return array ['suggested_date_utc' => string, 'suggested_deadline_utc' => string]
     * @throws Exception
     */
    public function calculateFollowupUtcBoundaries(string $doctorTimezone, string $timeframeOrDate): array
    {
        $tzObj = new DateTimeZone($doctorTimezone);
        $nowLocal = new DateTimeImmutable('now', $tzObj);

        if (in_array($timeframeOrDate, ['1_week', '2_week', '1_month'])) {
            $interval = str_replace('_', ' ', $timeframeOrDate) . 's'; // simple pluralization: 1 weeks (acceptable for modify), 2 weeks, 1 months
            if ($timeframeOrDate === '1_month') {
                $interval = '1 month';
            } elseif ($timeframeOrDate === '1_week') {
                $interval = '1 week';
            } elseif ($timeframeOrDate === '2_week') {
                $interval = '2 weeks';
            }

            $targetLocal = $nowLocal->modify("+" . $interval);
        } else {
            // Assume custom date like "Y-m-d"
            $targetLocal = DateTimeImmutable::createFromFormat('Y-m-d', $timeframeOrDate, $tzObj);
            $startOfToday = $nowLocal->setTime(0, 0, 0);
            if (!$targetLocal || $targetLocal < $startOfToday) {
                // If it's earlier than today, we could throw an exception,
                // But typically for demo or quick inputs, we might just allow it.
                // Keeping it strict for now.
                throw new Exception("Invalid or past date provided: {$timeframeOrDate}");
            }
        }

        $startOfDayLocal = $targetLocal->setTime(0, 0, 0);
        $endOfDayLocal = $targetLocal->setTime(23, 59, 59);

        $utcTz = new DateTimeZone('UTC');
        return [
            'suggested_date_utc' => $startOfDayLocal->setTimezone($utcTz)->format('Y-m-d H:i:s'),
            'suggested_deadline_utc' => $endOfDayLocal->setTimezone($utcTz)->format('Y-m-d H:i:s')
        ];
    }

    /**
     * Create a new follow-up.
     */
    public function createFollowup(array $data): KCProFollowup
    {
        global $wpdb;

        $doctor = KCUser::query()->where('ID', $data['doctor_id'])->first();
        if (!$doctor) {
            throw new Exception("Doctor not found.");
        }

        // You should resolve doctor timezone via your system's standardized method
        // Using WP default or a custom meta field for doctor's timezone
        $doctorTimezone = get_user_meta($doctor->ID, 'kivicare_timezone', true) ?: wp_timezone_string();

        $boundaries = $this->calculateFollowupUtcBoundaries($doctorTimezone, $data['timeframe_or_date']);

        $utcNow = gmdate('Y-m-d H:i:s');

        $wpdb->query('START TRANSACTION');

        try {
            if (!empty($data['force_new_chain'])) {
                // If explicitly requested to create a new chain, force it
                $utcNow = gmdate('Y-m-d H:i:s');
                $chainData = [
                    'clinic_id' => $data['clinic_id'],
                    'patient_id' => $data['patient_id'],
                    'doctor_id' => $data['doctor_id'],
                    'diagnosis_id' => $data['diagnosis_id'] ?? null,
                    'name' => $data['chain_name'] ?? null,
                    'status' => 'active',
                    'created_at_utc' => $utcNow,
                ];

                $chainId = KCProFollowupChain::create($chainData);
                if (is_wp_error($chainId) || !$chainId) {
                    throw new Exception("Failed to generate forced new follow-up chain.");
                }

                KCProChainAuditService::get_instance()->log(
                    (int) $chainId,
                    null,
                    'chain_created',
                    null,
                    $chainData
                );
            } elseif (!empty($data['chain_id'])) {
                $chainId = (int) $data['chain_id'];
                $existingChain = KCProFollowupChain::find($chainId);
                if (!$existingChain) {
                    throw new Exception("Provided Follow-Up Chain does not exist.");
                }
                if ($existingChain->status === 'closed') {
                    throw new Exception("Cannot create Follow-Up within a closed Chain.");
                }
            } else {
                $chainId = KCProChainService::get_instance()
                    ->getOrCreateActiveChain(
                        (int) $data['clinic_id'],
                        (int) $data['patient_id'],
                        (int) $data['doctor_id'],
                        $data['diagnosis_id'] ?? null,
                        $data['chain_name'] ?? null
                    );
            }
            
            $followupData = [
                'clinic_id' => $data['clinic_id'],
                'doctor_id' => $data['doctor_id'],
                'patient_id' => $data['patient_id'],
                'encounter_id' => $data['encounter_id'] ?? null,
                'chain_id' => $chainId,
                'parent_followup_id' => $data['parent_followup_id'] ?? null,
                'reason' => $data['reason'],
                'priority' => $data['priority'] ?? 'routine',
                'status' => 'pending',
                'created_at_utc' => $utcNow,
                'created_by' => get_current_user_id() ?: $data['doctor_id'],
                'updated_at_utc' => $utcNow,
                'updated_by' => get_current_user_id() ?: $data['doctor_id'],
                'suggested_date_utc' => $boundaries['suggested_date_utc'],
                'suggested_deadline_utc' => $boundaries['suggested_deadline_utc'],
            ];

            $metadata = [];
            if (isset($data['decision'])) {
                $metadata['decision'] = $data['decision'];
            }
            if (!empty($data['service_id']) && is_array($data['service_id'])) {
                $metadata['service_id'] = $data['service_id'];
            }

            if (!empty($metadata)) {
                $followupData['metadata'] = wp_json_encode($metadata);
            }

            $followupId = KCProFollowup::create($followupData);
            
            if (is_wp_error($followupId) || !$followupId) {
                throw new Exception("Failed to insert follow-up record.");
            }

            // Log activity
            KCProFollowupActivityLog::create([
                'followup_id' => $followupId,
                'user_id' => get_current_user_id() ?: $data['doctor_id'],
                'action' => 'created',
                'new_status' => 'pending',
                'created_at_utc' => $utcNow,
            ]);

            // Queue Reminders — only when globally enabled and days > 0
            $reminderDays = KCProFollowupSettings::reminderDaysBefore();
            if (KCProFollowupSettings::isReminderEnabled() && $reminderDays > 0) {
                $reminderService  = KCProReminderService::get_instance();
                $reminderChannels = KCProFollowupSettings::reminderChannels();
                foreach ($reminderChannels as $channel) {
                    $label = "{$reminderDays}_days_before_{$channel}";
                    $reminderService->createReminder((int) $followupId, $label, -$reminderDays, $channel);
                }
            }

            $wpdb->query('COMMIT');
            
            do_action('kc_pro_after_create_followup', $followupId, $data);

            return KCProFollowup::find($followupId);
        } catch (Exception $e) {
            $wpdb->query('ROLLBACK');
            throw new RuntimeException("Failed to create follow-up: " . $e->getMessage());
        }
    }

    /**
     * Update the status of a follow-up.
     *
     * @param int $followupId
     * @param string $status
     * @param int $userId
     * @return array
     * @throws Exception
     */
    public function updateStatus(int $followupId, string $status, int $userId): array
    {
        global $wpdb;
        $wpdb->query('START TRANSACTION');

        try {
            $followup = KCProFollowup::find($followupId);
            if (!$followup) {
                throw new Exception("Follow-up not found.");
            }

            // Reject invalid transitions
            KCProStateTransitionValidator::validateFollowupTransition($followup->status, $status);

            $oldStatus = $followup->status;
            $followup->status = $status;
            $followup->updated_at_utc = gmdate('Y-m-d H:i:s');
            $followup->updated_by = $userId;
            $followup->save();

            // Log activity
            KCProFollowupActivityLog::create([
                'followup_id' => $followupId,
                'user_id' => $userId,
                'action' => 'status_changed',
                'old_status' => $oldStatus,
                'new_status' => $status,
                'created_at_utc' => gmdate('Y-m-d H:i:s'),
            ]);

            $wpdb->query('COMMIT');

            do_action('kc_pro_after_update_followup_status', $followupId, $status, $oldStatus);

            return ['success' => true, 'message' => "Follow-up status updated to {$status}."];
        } catch (Exception $e) {
            $wpdb->query('ROLLBACK');
            throw new RuntimeException("Failed to update follow-up status: " . $e->getMessage());
        }
    }

    /**
     * Schedule a followup (Link to appointment)
     */
    public function scheduleFollowup(int $followupId, int $appointmentId, int $userId): void
    {
        global $wpdb;

        $wpdb->query('START TRANSACTION');

        try {
            // Pessimistic lock equivalent or select
            $followupRow = KCProFollowup::find($followupId);

            if (!$followupRow) {
                throw new Exception("Followup not found.");
            }

            if (!in_array($followupRow->status, ['pending', 'missed'])) {
                throw new Exception("Follow-up is not in a schedulable state.");
            }
            $oldStatus = $followupRow->status;

            // Update entity properties
            $followupRow->status = 'scheduled';
            $followupRow->scheduled_appointment_id = $appointmentId;
            $followupRow->updated_at_utc = gmdate('Y-m-d H:i:s');
            $followupRow->updated_by = $userId;
            $followupRow->save();

            // Log Activity
            KCProFollowupActivityLog::create([
                'followup_id' => $followupId,
                'user_id' => $userId,
                'action' => 'scheduled',
                'old_status' => $oldStatus,
                'new_status' => 'scheduled',
                'note' => "Linked to appointment #{$appointmentId}",
                'created_at_utc' => gmdate('Y-m-d H:i:s'),
            ]);

            $wpdb->query('COMMIT');

            do_action('kc_pro_after_update_followup_status', $followupId, 'scheduled', $oldStatus);

            // Optionally clean up reminders or trigger notifications

        } catch (Exception $e) {
            $wpdb->query('ROLLBACK');
            throw clone $e;
        }
    }

    /**
     * Handle appointment cancellation/deletion by reverting linked Follow-up status to pending.
     */
    public function handleAppointmentCancellation($appointmentId): void
    {
        global $wpdb;

        if (empty($appointmentId)) {
            return;
        }

        // Find follow-up(s) linked to this appointment
        $followups = KCProFollowup::query()->where('scheduled_appointment_id', $appointmentId)->get();

        if (empty($followups)) {
            return;
        }

        foreach ($followups as $followup) {
            $wpdb->query('START TRANSACTION');
            try {
                // Determine if it was scheduled or completed based on the current status
                if (in_array($followup->status, ['scheduled', 'completed'])) {
                    
                    // Revert to pending
                    $followup->status = 'pending';
                    $followup->scheduled_appointment_id = null;
                    $followup->updated_at_utc = gmdate('Y-m-d H:i:s');
                    $followup->updated_by = get_current_user_id() ?: 0;
                    $result = $followup->save();

                    if ($result !== false) {
                        KCProFollowupActivityLog::create([
                            'followup_id' => $followup->id,
                            'user_id' => get_current_user_id() ?: 0,
                            'action' => 'status_changed',
                            'old_status' => $followup->status,
                            'new_status' => 'pending',
                            'note' => "Linked appointment #{$appointmentId} was cancelled/deleted.",
                            'created_at_utc' => gmdate('Y-m-d H:i:s'),
                        ]);
                    }
                }
                $wpdb->query('COMMIT');
            } catch (Exception $e) {
                $wpdb->query('ROLLBACK');
                error_log("Failed to revert follow-up {$followup->id} on appointment cancellation: " . $e->getMessage());
            }
        }
    }
}
