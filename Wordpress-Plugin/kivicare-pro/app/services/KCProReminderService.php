<?php

namespace KCProApp\services;

use Exception;
use DateTime;
use DateTimeZone;
use KCProApp\models\KCProFollowup;
use KCProApp\models\KCProFollowupReminder;
use App\baseClasses\KCErrorLogger;
use KCProApp\notifications\KCPNotificationInit;

defined('ABSPATH') or die('Something went wrong');

class KCProReminderService
{
    private const REMINDER_HOOK = 'kivicare_pro_followup_reminder';
    private const REMINDER_GROUP = 'kivicare-pro-followups';

    /**
     * @var KCProReminderService|null
     */
    private static $instance = null;

    public static function get_instance(): KCProReminderService
    {
        if (self::$instance === null) {
            self::$instance = new self();
        }
        return self::$instance;
    }

    private function __construct()
    {
        add_action(self::REMINDER_HOOK, [$this, 'handleFollowupReminder'], 10, 2);
    }

    /**
     * Create a new reminder for a follow-up.
     * 
     * @param int $followupId
     * @param string $reminderType (e.g. '3_days_before', '14_days_after')
     * @param int $offsetDays
     * @param string $channel (sms, email, push)
     * @return void
     * @throws Exception
     */
    public function createReminder(int $followupId, string $reminderType, int $offsetDays, string $channel = 'email'): void
    {
        $followup = KCProFollowup::find($followupId);
        if (!$followup) {
            throw new Exception("Follow-up not found.");
        }

        // Rule: Reminders cannot be added to completed or cancelled follow-ups.
        if (in_array($followup->status, ['completed', 'cancelled'])) {
            throw new Exception("Cannot add reminder to a {$followup->status} follow-up.");
        }

        $allowedChannels = apply_filters('kivicare_pro_reminder_channels', ['email', 'sms', 'whatsapp', 'push', 'custom', 'twilio']);
        if (!in_array($channel, $allowedChannels, true)) {
            throw new Exception("Invalid reminder channel specified: '{$channel}'.");
        }

        // Determine if reminder already exists
        $existing = KCProFollowupReminder::query()
            ->where('followup_id', $followupId)
            ->where('reminder_type', $reminderType)
            ->first();

        if ($existing) {
            throw new Exception("Reminder of type '{$reminderType}' already exists for this follow-up.");
        }

        $reminderId = KCProFollowupReminder::create([
            'followup_id' => $followupId,
            'reminder_type' => $reminderType,
            'offset_days' => $offsetDays,
            'channel' => $channel,
            'processed_at' => null // Not yet processed
        ]);

        $reminder = KCProFollowupReminder::find($reminderId);
        if (!$reminder) {
            throw new Exception("Failed to retrieve newly created reminder.");
        }

        $this->scheduleReminder($reminder);
    }

    /**
     * Remove a reminder.
     * 
     * @param int $followupId
     * @param string $reminderType
     * @return void
     * @throws Exception
     */
    public function deleteReminder(int $followupId, string $reminderType): void
    {
        $reminder = KCProFollowupReminder::query()
            ->where('followup_id', $followupId)
            ->where('reminder_type', $reminderType)
            ->first();
            
        if (!$reminder) {
            throw new Exception("Reminder not found.");
        }

        $this->unscheduleReminder($followupId, $reminderType);
        $reminder->delete();
    }

    /**
     * Schedule a single reminder action in the future via Action Scheduler.
     * 
     * @param KCProFollowupReminder $reminder
     * @return void
     */
    private function scheduleReminder(KCProFollowupReminder $reminder): void
    {
        if (!function_exists('as_schedule_single_action')) {
            return;
        }

        try {
            $followup = KCProFollowup::find($reminder->followup_id);
            if (!$followup || empty($followup->suggested_date_utc)) {
                return;
            }

            $wpTimezone = wp_timezone();
            $dateTime = new DateTime($followup->suggested_date_utc, new \DateTimeZone('UTC'));
            $dateTime->setTimezone($wpTimezone);

            if ($reminder->offset_days !== 0) {
                $modifier = $reminder->offset_days > 0 ? "+{$reminder->offset_days} days" : "{$reminder->offset_days} days";
                $dateTime->modify($modifier);
            }

            $reminderTimestamp = $dateTime->getTimestamp();

            // Only schedule if the calculated time is in the future
            if ($reminderTimestamp <= time()) {
                return;
            }

            // Ensure no duplicate action for the same followup and type
            $this->unscheduleReminder($reminder->followup_id, $reminder->reminder_type);

            $actionId = as_schedule_single_action(
                $reminderTimestamp,
                self::REMINDER_HOOK,
                ['followup_id' => $reminder->followup_id, 'reminder_type' => $reminder->reminder_type],
                self::REMINDER_GROUP
            );

            if ($actionId > 0) {
                $reminder->action_id = $actionId;
                $reminder->save();
            }

        } catch (\Exception $e) {
            KCErrorLogger::instance()->error('KCPro: Error scheduling followup reminder for ID ' . $reminder->followup_id . ': ' . $e->getMessage());
        }
    }

    /**
     * Unschedule a reminder from Action Scheduler.
     * 
     * @param int $followupId
     * @param string $reminderType
     * @return void
     */
    private function unscheduleReminder(int $followupId, string $reminderType): void
    {
        if (!function_exists('as_unschedule_action')) {
            return;
        }

        try {
            as_unschedule_action(self::REMINDER_HOOK, ['followup_id' => $followupId, 'reminder_type' => $reminderType], self::REMINDER_GROUP);
        } catch (\Exception $e) {
            KCErrorLogger::instance()->error('KCPro: Error unscheduling followup reminder for ID ' . $followupId . ': ' . $e->getMessage());
        }
    }

    /**
     * Action Scheduler callback to execute the follow-up reminder.
     * 
     * @param int $followupId
     * @param string $reminderType
     * @return void
     */
    public function handleFollowupReminder(int $followupId, string $reminderType): void
    {
        try {
            $reminder = KCProFollowupReminder::query()
                ->where('followup_id', $followupId)
                ->where('reminder_type', $reminderType)
                ->first();

            if (!$reminder || $reminder->processed_at) {
                return;
            }

            $followup = KCProFollowup::find($followupId);
            if (!$followup || in_array($followup->status, ['completed', 'cancelled'])) {
                return;
            }

            // Trigger notification via KiviCare Pro Notification system
            $context = [
                'followup_id' => $followupId,
                'reminder_type' => $reminderType,
            ];
            $options = [
                'channels' => [$reminder->channel]
            ];
            
            KCPNotificationInit::get_instance()->notify(KIVI_CARE_PREFIX . 'followup_reminder', $context, $options);

            // Mark as processed
            $reminder->processed_at = current_time('mysql', true);
            $reminder->action_id = null; // Action completed
            $reminder->save();

        } catch (\Exception $e) {
            KCErrorLogger::instance()->error('KCPro: Error processing followup reminder for ID ' . $followupId . ': ' . $e->getMessage());
        }
    }
}
