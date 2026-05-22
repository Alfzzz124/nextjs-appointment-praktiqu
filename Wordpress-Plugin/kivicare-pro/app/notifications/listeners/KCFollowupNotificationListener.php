<?php

namespace KCProApp\notifications\listeners;

use App\models\KCDoctor;
use App\models\KCPatient;
use App\models\KCClinic;
use App\models\KCService;
use KCProApp\abstracts\KCAbstractNotificationListener;
use App\baseClasses\KCErrorLogger;
use KCProApp\models\KCProFollowup;
use KCProApp\baseClasses\KCProFollowupSettings;
use KCProApp\services\KCProReminderService;

defined('ABSPATH') or die('Something went wrong');

class KCFollowupNotificationListener extends KCAbstractNotificationListener
{
    protected function initializeHooks(): void
    {
        // Follow-up Creation Hook (when a recommendation is made during encounter)
        add_action('kc_pro_after_create_followup', [$this, 'handleFollowupCreated'], 10, 2);

        // Follow-up Reminder Hook
        add_action('kivicare_followup_reminder', [$this, 'handleFollowupReminder'], 10, 1);
    }

    /**
     * Handle follow-up creation notification (when a recommendation is made during encounter)
     */
    public function handleFollowupCreated(int $followupId, array $data): void
    {
        try {
            $followup = KCProFollowup::find($followupId);
            if (!$followup) return;

            $patient = KCPatient::find($followup->patient_id);
            if (!$patient) return;

            $doctor = KCDoctor::find($followup->doctor_id);
            $clinic = KCClinic::find($followup->clinic_id);
            $creator = get_userdata($followup->created_by);

            $serviceName = $this->getServiceNameFromFollowup($followup);

            // Prepare notification data
            $notificationData = [
                'followup_id' => $followup->id,
                'patient_name' => $patient->displayName,
                'patient_email' => $patient->email,
                'doctor_name' => $doctor ? $doctor->displayName : '',
                'clinic_name' => $clinic ? $clinic->name : '',
                'service_name' => $serviceName ?: __('Service not selected', 'kivicare-pro'),
                'reason' => $followup->reason,
                'priority' => ucfirst($followup->priority),
                'suggested_date' => date_i18n(get_option('date_format'), strtotime($followup->suggested_date_utc)),
                'created_by' => $creator ? $creator->display_name : '',
                'site_name' => get_bloginfo('name'),
                'current_date' => date_i18n(get_option('date_format')),
                'isFollowUp' => true,
            ];

            // Specific template keys
            $notificationData['appointment_date'] = $notificationData['suggested_date'];
            $notificationData['appointment_time'] = __('To be scheduled', 'kivicare-pro');

            // Send to Patient
            $this->scheduleNotification(
                KIVI_CARE_PREFIX . 'follow_up_appointment_for_staff',
                ['followup_id' => $followupId, 'recipient_type' => 'patient', 'extra_data' => $notificationData],
                ['channels' => ['email']]
            );

            // Send to Doctor
            if ($doctor) {
                $this->scheduleNotification(
                    KIVI_CARE_PREFIX . 'follow_up_appointment_for_staff',
                    ['followup_id' => $followupId, 'recipient_type' => 'doctor', 'extra_data' => $notificationData],
                    ['channels' => ['email']]
                );
            }

            // Note: Admin and Receptionist sending usually handled by hydrator or custom logic in Pro
            // Lite used a simple loop, for Pro we should ideally have a 'staff' recipient type or manual sends.
            // For now, let's keep the manual staff emails if needed, but the Goal is Pro system.
            
            // Schedule follow-up recommendation reminder if enabled
            $this->scheduleFollowupReminder($followupId);

        } catch (\Exception $e) {
            KCErrorLogger::instance()->error("Error handling follow-up creation notification: " . $e->getMessage());
        }
    }

    /**
     * Handle follow-up recommendation reminder - Processes reminders for non-booked follow-ups
     */
    public function handleFollowupReminder(int $followupId): void
    {
        try {
            $followup = KCProFollowup::find($followupId);
            if (!$followup || $followup->status !== 'pending') {
                return;
            }

            if (!KCProFollowupSettings::isReminderEnabled()) {
                return;
            }

            $patient = KCPatient::find($followup->patient_id);
            if (!$patient) return;

            // Trigger notification via Pro Notification manager
            $this->scheduleNotification(
                KIVI_CARE_PREFIX . 'followup_reminder',
                ['followup_id' => $followupId, 'recipient_type' => 'patient'],
                ['channels' => ['email', 'sms', 'whatsapp']]
            );

        } catch (\Exception $e) {
            KCErrorLogger::instance()->error("Error handling follow-up reminder for ID {$followupId}: " . $e->getMessage());
        }
    }

    /**
     * Schedule a follow-up recommendation reminder
     */
    private function scheduleFollowupReminder(int $followupId): void
    {
        try {
            if (!KCProFollowupSettings::isReminderEnabled()) {
                return;
            }

            $followup = KCProFollowup::find($followupId);
            if (!$followup) return;

            $reminderDaysBefore = KCProFollowupSettings::reminderDaysBefore();
            if ($reminderDaysBefore <= 0) return;

            $suggestedDate = new \DateTime($followup->suggested_date_utc, new \DateTimeZone('UTC'));
            $suggestedDate->modify("-{$reminderDaysBefore} days");
            $reminderTimestamp = $suggestedDate->getTimestamp();

            if ($reminderTimestamp > time()) {
                if (!as_next_scheduled_action('kivicare_followup_reminder', [$followupId], 'kivicare-reminders')) {
                    as_schedule_single_action(
                        $reminderTimestamp,
                        'kivicare_followup_reminder',
                        [$followupId],
                        'kivicare-reminders'
                    );
                }
            }

        } catch (\Exception $e) {
            KCErrorLogger::instance()->error("Error scheduling follow-up reminder: " . $e->getMessage());
        }
    }

    /**
     * Get service name from followup
     */
    private function getServiceNameFromFollowup($followup): string
    {
        $serviceName = '';
        $metadata = $followup->metadata;

        if (!empty($metadata['service_id']) && is_array($metadata['service_id'])) {
            $serviceId = $metadata['service_id'][0];
            $service = KCService::find($serviceId);
            if ($service) {
                $serviceName = $service->name;
            }
        }

        return $serviceName;
    }
}
