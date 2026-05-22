<?php

namespace KCProApp\notifications\listeners;

use KCProApp\abstracts\KCAbstractNotificationListener;


defined('ABSPATH') or die('Something went wrong');

class KCPatientSmsNotificationListener extends KCAbstractNotificationListener
{
    protected function initializeHooks(): void
    {
        // Patient registration event
        add_action('kivicare_patient_registered', [$this, 'handlePatientRegistered'], 10, 1);
    }

    public function handlePatientRegistered(array $patientData): void
    {
        $this->sendPatientWelcomeNotification($patientData);
        $this->sendAdminNotification($patientData, 'patient');
    }

    private function sendPatientWelcomeNotification(array $patientData): void
    {
        $templateName = KIVI_CARE_PREFIX . 'patient_register';
        
        $phone = $patientData['contact_number'] ?? '';
        $context = [
            'target' => 'patient',
            'patient_id' => $patientData['id'],
            'extra_data' => [
                'patient_name' => $patientData['first_name'] . ' ' . $patientData['last_name'],
                'user_email' => $patientData['email'],
                'patient_phone' => $phone,
                'user_password' => $patientData['temp_password'],
                'login_url' => wp_login_url(),
                'clinic_name' => get_bloginfo('name')
            ]
        ];

        $this->scheduleNotification(
            $templateName,
            $context,
            []
        );
    }
}