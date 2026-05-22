<?php
namespace KCProApp\email;
use App\emails\KCEmailSender;
use App\models\KCClinic;
use App\baseClasses\KCErrorLogger;
class KCClinicAdminNotificationListener
{
    private KCEmailSender $emailSender;
    private static ?KCClinicAdminNotificationListener $instance = null;
    public function __construct()
    {
        $this->emailSender = KCEmailSender::get_instance();
        $this->initializeHooks();
    }
    public static function get_instance(): KCClinicAdminNotificationListener
    {
        if (self::$instance === null) {
            self::$instance = new self();
        }
        return self::$instance;
    }
    private function initializeHooks(): void
    {
        // Hook into clinic creation/registration
        // Assuming a similar hook exists for clinic save, adjust if the actual hook name differs
        add_action('kcpro_clinic_save', [$this, 'handleClinicRegistered'], 10, 1);
    }
    public function handleClinicRegistered(array $clinicData): void
    {
        try {
            // Send notifications using the data directly from API
            $this->sendNotifications($clinicData);
        } catch (\Exception $e) {
            KCErrorLogger::instance()->error("Error in clinic admin notification handler: " . $e->getMessage());
        }
    }
    private function sendNotifications(array $clinicData): void
    {
        try {
            $adminResult = $this->sendAdminNotification($clinicData);
            KCErrorLogger::instance()->error("Admin notification result: " . ($adminResult ? 'Success' : 'Failed'));
        } catch (\Exception $e) {
            KCErrorLogger::instance()->error("Error sending notifications: " . $e->getMessage());
        }
    }

    private function sendAdminNotification(array $clinicData): bool
    {
        // Extract clinic admin user ID
        $userId = $clinicData['ID'] ?? $clinicData['id'] ?? null;
        $adminPassword = $clinicData['password'] ?? '';

        if (empty($userId)) {
            KCErrorLogger::instance()->error('Clinic Admin user ID missing for admin notification');
            return false;
        }

        // Use context-based email sending
        return $this->emailSender->sendEmailWithContext(
            KIVI_CARE_PREFIX . 'admin_new_user_register',
            'user',
            (int) $userId,
            'patient', // Default recipient type
            [
                'to_override' => get_option('admin_email'), // Send to admin
                'custom_data' => [
                    'user_name'    => $clinicData['username'] ?? '',
                    'user_email'   => $clinicData['user_email'] ?? '',
                    'user_contact' => $clinicData['mobile_number'] ?? '',
                    'user_role' => 'Clinic Admin',
                    'site_url' => get_site_url(),
                    'current_date' => current_time('mysql'),
                ]
            ]
        );
    }
}