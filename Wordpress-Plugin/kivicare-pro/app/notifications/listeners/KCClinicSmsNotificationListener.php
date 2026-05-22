<?php

namespace KCProApp\notifications\listeners;

use KCProApp\abstracts\KCAbstractNotificationListener;


defined('ABSPATH') or die('Something went wrong');

class KCClinicSmsNotificationListener extends KCAbstractNotificationListener
{
    protected function initializeHooks(): void
    {
        add_action('kivicare_clinic_admin_registered', [$this, 'handleClinicAdminRegistered'], 10, 1);
    }

    public function handleClinicAdminRegistered(array $adminNotificationData): void
    {
        $this->sendClinicAdminWelcomeNotification($adminNotificationData);
        $this->sendAdminNotification($adminNotificationData, 'clinic admin');
    }

    private function sendClinicAdminWelcomeNotification(array $adminNotificationData): void
    {
        $templateName = KIVI_CARE_PREFIX . 'clinic_admin_registration';
        
        $phone = $adminNotificationData['mobile_number'] ?? '';
        $context = [
            'target' => 'clinic_admin',
            'clinic_admin_id' => $adminNotificationData['user_id'],
            'extra_data' => [
                'user_email' => $adminNotificationData['user_email'],
                'user_name' => $adminNotificationData['username'],
                'user_password' => $adminNotificationData['password'],
                'clinic_name' => $adminNotificationData['clinic_name'] ?? get_bloginfo('name'),
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