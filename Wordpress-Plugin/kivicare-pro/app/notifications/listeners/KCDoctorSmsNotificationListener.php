<?php

namespace KCProApp\notifications\listeners;

use KCProApp\abstracts\KCAbstractNotificationListener;

defined('ABSPATH') or die('Something went wrong');

class KCDoctorSmsNotificationListener extends KCAbstractNotificationListener
{
    protected function initializeHooks(): void
    {
        add_action('kc_doctor_register', [$this, 'handleDoctorRegistered'], 10, 1);
    }

    public function handleDoctorRegistered(array $doctorData): void
    {
        $this->sendDoctorWelcomeNotification($doctorData);
        $this->sendAdminNotification($doctorData, 'doctor');
    }

    private function sendDoctorWelcomeNotification(array $doctorData): void
    {
        $templateName = KIVI_CARE_PREFIX . 'doctor_registration';
        
        $phone = $doctorData['contact_number'] ?? '';
        
        $context = [
            'doctor_id' => $doctorData['id'],
            'extra_data' => [
                'user_email' => $doctorData['email'],
                'user_name' => $doctorData['username'],
                'user_password' => $doctorData['temp_password'],
                'login_url' => wp_login_url(),
                'user_phone' => $phone
            ]
        ];

        $this->scheduleNotification(
            $templateName,
            $context,
            []
        );
    }
}