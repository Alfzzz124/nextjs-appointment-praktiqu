<?php

namespace KCProApp\notifications\listeners;

use App\models\KCClinic;
use KCProApp\abstracts\KCAbstractNotificationListener;
use App\baseClasses\KCErrorLogger;

defined('ABSPATH') or die('Something went wrong');

class KCReceptionistSmsNotificationListener extends KCAbstractNotificationListener
{
    protected function initializeHooks(): void
    {
        // Receptionist registration event
        add_action('kc_receptionist_created', [$this, 'handleReceptionistRegistered'], 10, 1);
    }

    public function handleReceptionistRegistered(array $receptionistData): void
    {
        $this->sendReceptionistWelcomeNotification($receptionistData);
        $this->sendAdminNotification($receptionistData, 'receptionist');
    }

    private function sendReceptionistWelcomeNotification(array $receptionistData): void
    {
        $templateName = KIVI_CARE_PREFIX . 'receptionist_register';
        
        $phone = $receptionistData['contact_number'] ?? '';
        
        $context = [
            'target' => 'receptionist',
            'receptionist_id' => $receptionistData['id'],
            'extra_data' => [
                'user_email' => $receptionistData['email'],
                'user_name' => $receptionistData['user_name'],
                'user_password' => $receptionistData['user_password'],
                'receptionist_name' => $receptionistData['first_name'] . ' ' . $receptionistData['last_name'],
                'receptionist_phone' => $phone,
                'clinic_name' => $this->getClinicName($receptionistData['clinic_id']),
                'login_url' => wp_login_url()
            ]
        ];

        $this->scheduleNotification(
            $templateName,
            $context,
            []
        );
    }

    private function getClinicName($clinic_id): string
    {
        if (!isKiviCareProActive()) {
            return get_bloginfo('name');
        }

        $clinic = KCClinic::find($clinic_id);
        return $clinic ? $clinic->name : get_bloginfo('name');
    }
}