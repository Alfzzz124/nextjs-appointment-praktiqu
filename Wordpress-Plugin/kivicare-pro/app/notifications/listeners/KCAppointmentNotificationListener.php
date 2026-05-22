<?php

namespace KCProApp\notifications\listeners;

use App\emails\listeners\KCAppointmentNotificationListener AS KCEmailAppointmentNotificationListener;
use App\models\KCAppointment;
use App\models\KCOption;
use KCProApp\abstracts\KCAbstractNotificationListener;
use App\baseClasses\KCErrorLogger;
use DateTime;


defined('ABSPATH') or die('Something went wrong');

class KCAppointmentNotificationListener extends KCAbstractNotificationListener
{
    private KCEmailAppointmentNotificationListener $appointmentListener;

    private const REMINDER_HOOK = 'kivicare_pro_appointment_reminder';
    private const REMINDER_GROUP = 'kivicare-pro-reminders';

    public function __construct()
    {
        parent::__construct();
        $this->appointmentListener = KCEmailAppointmentNotificationListener::get_instance();
    }

    protected function initializeHooks(): void
    {
        add_filter('kivicare_pro_handle_reminder', '__return_true');
        add_action('kc_after_create_appointment', [$this, 'handleAppointmentBooked'], 10, 1);
        add_action('kivicare_appointment_cancelled', [$this, 'handleAppointmentCancelled'], 10, 1);

        // Ensure Pro notifications (SMS/WhatsApp) also fire after payment success
        add_action('kc_appointment_payment_completed', [$this, 'handleAppointmentBooked'], 10, 1);

        // SMS reminder execution hook (scheduled via Action Scheduler)
        add_action(self::REMINDER_HOOK, [$this, 'handleAppointmentReminder'], 10, 1);
    }

    public function handleAppointmentBooked(int $appointmentId): void
    {
        // Skip SMS/WhatsApp notifications if appointment is still pending payment or cancelled.
        // Pending appointments are created when a patient opens Razorpay/Stripe popup but hasn't
        // paid yet. Notifications must only fire once payment succeeds (kc_appointment_payment_completed)
        // or when the appointment is directly booked without an online payment gateway.
        $appointment = KCAppointment::find($appointmentId);
        if (!$appointment || in_array((string) $appointment->status, [
            (string) KCAppointment::STATUS_PENDING,
            (string) KCAppointment::STATUS_CANCELLED,
        ], true)) {
            return;
        }

        $appointmentData = $this->appointmentListener->getAppointmentDataForEmail($appointmentId);
        if (!$appointmentData) {
            return;
        }

        if (!$this->isTelemedAppointment($appointmentData)) {
            $this->scheduleAppointmentNotification('add_appointment', $appointmentData, 'patient');
            $this->scheduleAppointmentNotification('doctor_book_appointment', $appointmentData, 'doctor');
        }
        
        $this->scheduleAppointmentNotification('clinic_book_appointment', $appointmentData, 'clinic');

        // Send video conference links if applicable
        $this->sendVideoConferenceLinks($appointmentData);

        // Schedule SMS reminders based on appointment reminder settings
        $this->scheduleReminder($appointmentId, $appointmentData);
    }

    public function handleAppointmentCancelled(array $appointmentData): void
    {
        $appointmentId = (int) (
            $appointmentData['id'] ??
            $appointmentData['appointment_id'] ??
            ($appointmentData['appointment']['id'] ?? 0)
        );

        $this->scheduleAppointmentNotification('cancel_appointment', $appointmentData, 'patient');
        $this->scheduleAppointmentNotification('cancel_appointment', $appointmentData, 'doctor');

        if ($appointmentId > 0) {
            $this->unscheduleReminder($appointmentId);
        }
    }

    /**
     * Action Scheduler callback to send SMS reminders.
     */
    public function handleAppointmentReminder(int $appointmentId): void
    {
        try {
            $appointment = KCAppointment::find($appointmentId);
            if (!$appointment) {
                return;
            }

            if ($appointment->status === KCAppointment::STATUS_CANCELLED) {
                return;
            }

            $reminderSettings = KCOption::get('email_appointment_reminder', []);
            if (!is_array($reminderSettings)) {
                return;
            }

            $smsEnabled = $this->isSwitchOn($reminderSettings['sms_status'] ?? false);
            $whatsappEnabled = $this->isSwitchOn($reminderSettings['whatsapp_status'] ?? ($reminderSettings['whatapp_status'] ?? false));
            $emailEnabled = $this->isSwitchOn($reminderSettings['status'] ?? false);

            // For Pro reminder notifications, we care about Email, SMS, or WhatsApp.
            if (!$smsEnabled && !$whatsappEnabled && !$emailEnabled) {
                return;
            }

            // Send reminders directly via notification manager (no re-scheduling)
            if ($smsEnabled) {
                $smsOptions = ['channels' => ['sms']];
                $this->sendAppointmentNotificationDirect('book_appointment_reminder', $appointmentId, 'patient', $smsOptions);
                $this->sendAppointmentNotificationDirect('book_appointment_reminder_for_doctor', $appointmentId, 'doctor', $smsOptions);
            }

            if ($whatsappEnabled) {
                $waOptions = ['channels' => ['whatsapp']];
                $this->sendAppointmentNotificationDirect('book_appointment_reminder', $appointmentId, 'patient', $waOptions);
                $this->sendAppointmentNotificationDirect('book_appointment_reminder_for_doctor', $appointmentId, 'doctor', $waOptions);
            }

            if ($emailEnabled) {
                $emailOptions = ['channels' => ['email']];
                $this->sendAppointmentNotificationDirect('book_appointment_reminder', $appointmentId, 'patient', $emailOptions);
                $this->sendAppointmentNotificationDirect('book_appointment_reminder_for_doctor', $appointmentId, 'doctor', $emailOptions);
            }

        } catch (\Exception $e) {
            KCErrorLogger::instance()->error('KCPro Appointment SMS Reminder Error for ID ' . $appointmentId . ': ' . $e->getMessage());
        }
    }

    private function sendAppointmentNotificationDirect(string $templateSlug, int $appointmentId, string $recipientType, array $options = []): void
    {
        if ($appointmentId <= 0) {
            return;
        }

        $context = [
            'appointment_id' => $appointmentId,
            'recipient_type' => $recipientType,
        ];

        $templateName = KIVI_CARE_PREFIX . $templateSlug;
        $this->notificationManager->execute_scheduled_notification($templateName, $context, $options);
    }

    private function scheduleAppointmentNotification(string $templateSlug, array $appointmentData, string $recipientType, array $options = []): void
    {
        $appointmentId = $appointmentData['id'] ?? $appointmentData['appointment_id'] ?? $appointmentData['appointment']['id'] ?? null;
        
        if (!$appointmentId) {
            return;
        }

        // We only need appointment ID and recipient type for the context
        $context = [
            'appointment_id' => $appointmentId,
            'recipient_type' => $recipientType
        ];

        $templateName = KIVI_CARE_PREFIX . $templateSlug;
        $this->scheduleNotification($templateName, $context, $options);
    }

    /**
     * Schedule a single SMS reminder action in the future (mirrors Lite email reminder logic).
     */
    private function scheduleReminder(int $appointmentId, array $appointmentData): void
    {
        if (!function_exists('as_schedule_single_action')) {
            return;
        }

        try {
            $reminderSettings = KCOption::get('email_appointment_reminder', []);
            if (!is_array($reminderSettings)) {
                return;
            }

            $smsEnabled = $this->isSwitchOn($reminderSettings['sms_status'] ?? false);
            $whatsappEnabled = $this->isSwitchOn($reminderSettings['whatsapp_status'] ?? ($reminderSettings['whatapp_status'] ?? false));
            $emailEnabled = $this->isSwitchOn($reminderSettings['status'] ?? false);

            // Schedule if any reminder type is enabled (mirrors legacy behavior)
            if (!$smsEnabled && !$whatsappEnabled && !$emailEnabled) {
                return;
            }

            $reminderHours = isset($reminderSettings['time']) ? intval($reminderSettings['time']) : 24;

            $appointmentStartDate = $appointmentData['appointment']['appointment_start_date'] ?? '';
            $appointmentStartTime = $appointmentData['appointment']['appointment_time'] ?? '';
            if (empty($appointmentStartDate) || empty($appointmentStartTime)) {
                return;
            }

            $appointmentStart = $appointmentStartDate . ' ' . $appointmentStartTime;
            $wpTimezone = wp_timezone();
            $appointmentDateTime = new DateTime($appointmentStart, $wpTimezone);
            $appointmentDateTime->modify("-{$reminderHours} hours");
            $reminderTimestamp = $appointmentDateTime->getTimestamp();

            if ($reminderTimestamp <= time()) {
                return;
            }

            // Avoid duplicate scheduling
            if (function_exists('as_next_scheduled_action')) {
                $next = as_next_scheduled_action(self::REMINDER_HOOK, [$appointmentId], self::REMINDER_GROUP);
                if (!empty($next)) {
                    return;
                }
            }

            as_schedule_single_action(
                $reminderTimestamp,
                self::REMINDER_HOOK,
                [$appointmentId],
                self::REMINDER_GROUP
            );
        } catch (\Exception $e) {
            KCErrorLogger::instance()->error('KCPro: Error scheduling SMS reminder for appointment ' . $appointmentId . ': ' . $e->getMessage());
        }
    }

    private function isSwitchOn($value): bool
    {
        return $value === true || $value === 1 || $value === '1' || $value === 'on';
    }

    private function unscheduleReminder(int $appointmentId): void
    {
        if (!function_exists('as_unschedule_action')) {
            return;
        }

        try {
            as_unschedule_action(self::REMINDER_HOOK, [$appointmentId], self::REMINDER_GROUP);
        } catch (\Exception $e) {
            KCErrorLogger::instance()->error('KCPro: Error unscheduling SMS reminder for appointment ' . $appointmentId . ': ' . $e->getMessage());
        }
    }
    /**
     * Send video conference links
     */
    private function sendVideoConferenceLinks(array $appointmentData): void
    {
        // Check if this is a telemed appointment
        if (!$this->isTelemedAppointment($appointmentData)) {
            return;
        }

        // Get video links from appointment data or generate them
        $zoomLink = $this->getZoomLink($appointmentData['appointment']['id']);
        $meetLink = $this->getMeetLink($appointmentData['appointment']['id']);

        // Send Zoom link if available
        if ($zoomLink) {
            // To patient
            $this->scheduleAppointmentNotification(
                'zoom_link',
                $appointmentData,
                'patient'
            );

            // To doctor
            $this->scheduleAppointmentNotification(
                'add_doctor_zoom_link',
                $appointmentData,
                'doctor'
            );
        }

        // Send Meet link if available
        if ($meetLink) {
            $meetEventLink = $this->getMeetEventLink($appointmentData['appointment']['id']);
            if ($meetEventLink) {
                $appointmentData['meet_event_link'] = $meetEventLink;
            }

            // To patient
            $this->scheduleAppointmentNotification(
                'meet_link',
                $appointmentData,
                'patient'
            );

            // To doctor
            $this->scheduleAppointmentNotification(
                'add_doctor_meet_link',
                $appointmentData,
                'doctor'
            );
        }
    }

    /**
     * Check if this is a telemed appointment
     */
    private function isTelemedAppointment(array $appointmentData): bool
    {
        foreach ($appointmentData['services'] as $service) {
            // Check if any service is a telemed service
            $serviceDetails = \App\models\KCServiceDoctorMapping::find($service['id']);

            if ($serviceDetails && $serviceDetails->telemedService === 'yes') {
                return true;
            }
        }
        return false;
    }

    /**
     * Get Zoom link for appointment
     */
    private function getZoomLink(int $appointmentId): ?string
    {
        // Check if Zoom Telemed addon is active
        if (!class_exists('KCTApp\\models\\KCTAppointmentZoomMapping')) {
            return null;
        }

        try {
            $zoomMapping = \KCTApp\models\KCTAppointmentZoomMapping::query()
                ->where('appointmentId', $appointmentId)
                ->first();

            if ($zoomMapping && !empty($zoomMapping->joinUrl)) {
                return $zoomMapping->joinUrl;
            }
        } catch (\Exception $e) {
            KCErrorLogger::instance()->error("Error fetching Zoom link: " . $e->getMessage());
        }

        return null;
    }

    /**
     * Get Meet link for appointment
     */
    private function getMeetLink(int $appointmentId): ?string
    {
        // Check if Google Meet addon is active
        if (!class_exists('KCGMApp\\models\\KCGMAppointmentGoogleMeetMapping')) {
            return null;
        }

        try {
            $meetMapping = \KCGMApp\models\KCGMAppointmentGoogleMeetMapping::query()
                ->where('appointmentId', $appointmentId)
                ->first();

            if ($meetMapping && !empty($meetMapping->url)) {
                return $meetMapping->url;
            }
        } catch (\Exception $e) {
            KCErrorLogger::instance()->error("Error fetching Google Meet link: " . $e->getMessage());
        }

        return null;
    }


    /**
     * Get Meet event link for appointment
     */
    private function getMeetEventLink(int $appointmentId): ?string
    {
        // Check if Google Meet addon is active
        if (!class_exists('KCGMApp\\models\\KCGMAppointmentGoogleMeetMapping')) {
            return null;
        }

        try {
            $meetMapping = \KCGMApp\models\KCGMAppointmentGoogleMeetMapping::query()
                ->where('appointmentId', $appointmentId)
                ->first();

            if ($meetMapping && !empty($meetMapping->eventUrl)) {
                return $meetMapping->eventUrl;
            }
        } catch (\Exception $e) {
            KCErrorLogger::instance()->error("Error fetching Google Meet event link: " . $e->getMessage());
        }

        return null;
    }
}
