<?php

namespace KCProApp\notifications;

use KCProApp\notifications\channels\KCTwilioChannel;
use KCProApp\notifications\channels\KCCustomChannel;
use KCProApp\notifications\listeners\KCAppointmentNotificationListener;
use KCProApp\notifications\listeners\KCPatientSmsNotificationListener;
use KCProApp\notifications\listeners\KCDoctorSmsNotificationListener;
use KCProApp\notifications\listeners\KCReceptionistSmsNotificationListener;
use KCProApp\notifications\listeners\KCClinicSmsNotificationListener;
use KCProApp\notifications\listeners\KCFollowupNotificationListener;


defined('ABSPATH') or die('Something went wrong');

class KCPNotificationInit
{
    private static ?KCPNotificationInit $instance = null;
    public function __construct()
    {
        $this->init();
    }

    private function init(): void
    {
        $this->registerChannels();
        $this->setupHooks();
        $this->initializeListeners();
    }
    public static function get_instance(): KCPNotificationInit
    {
        if (self::$instance === null) {
            self::$instance = new self();
        }
        return self::$instance;
    }

    /**
     * Initialize the notification system with proper channel registration
     */
    private function registerChannels(): void
    {
        $notificationSender = KCPNotificationSender::get_instance();
        $notificationSender->registerChannel('twilio', new KCTwilioChannel());
        $notificationSender->registerChannel('sms', new KCTwilioChannel());
        $notificationSender->registerChannel('whatsapp', new KCTwilioChannel());
        $notificationSender->registerChannel('custom', new KCCustomChannel());
        $notificationSender->registerChannel('push', new \KCProApp\notifications\channels\KCPushChannel());
        $notificationSender->registerChannel('email', new \KCProApp\notifications\channels\KCEmailChannel());
    }

    private function setupHooks(): void
    {
        // Action Scheduler will fire the hook with ($templateName, $context, $options)
        // so we must allow 3 accepted args.
        add_action(
            'kivicare_pro_execute_notification',
            [KCPNotificationManager::get_instance(), 'execute_scheduled_notification'],
            10,
            3
        );
    }

    private function initializeListeners(): void
    {
        if (class_exists(KCAppointmentNotificationListener::class)) {
            new KCAppointmentNotificationListener();
        }
        if (class_exists(KCPatientSmsNotificationListener::class)) {
            new KCPatientSmsNotificationListener();
        }
        if (class_exists(KCDoctorSmsNotificationListener::class)) {
            new KCDoctorSmsNotificationListener();
        }
        if (class_exists(KCReceptionistSmsNotificationListener::class)) {
            new KCReceptionistSmsNotificationListener();
        }
        if (class_exists(KCClinicSmsNotificationListener::class)) {
            new KCClinicSmsNotificationListener();
        }
        if (class_exists(KCFollowupNotificationListener::class)) {
            new KCFollowupNotificationListener();
        }
    }

    /**
     * Entry point to trigger a notification immediately.
     */
    public function notify(string $templateName, array $context, array $options = []): void
    {
        KCPNotificationManager::get_instance()->execute_scheduled_notification($templateName, $context, $options);
    }
}
