<?php


namespace KCProApp\abstracts;

use KCProApp\notifications\KCPNotificationManager;
use KCProApp\notifications\KCPNotificationSender;

defined('ABSPATH') or die('Something went wrong');

abstract class KCAbstractNotificationListener
{
    protected KCPNotificationManager $notificationManager;
    protected KCPNotificationSender $notificationSender;

    public function __construct()
    {
        $this->notificationManager = KCPNotificationManager::get_instance();
        $this->notificationSender = KCPNotificationSender::get_instance();
        $this->initializeHooks();
    }

    /**
     * Initialize hooks for the listener
     */
    abstract protected function initializeHooks(): void;

    /**
     * Schedule a notification
     * 
     * @param string $templateName
     * @param array $context
     * @param array $options
     */
    protected function scheduleNotification(string $templateName, array $context, array $options = []): void
    {
        $this->notificationManager->schedule_notification($templateName, $context, $options);
    }

    /**
     * Send notification to all admins
     * 
     * @param array $userData Data of the user who registered/triggered the event
     * @param string $userRole Role of the user (e.g., 'doctor', 'patient')
     * @param string $templateName Template name for admin notification
     */
    protected function sendAdminNotification(array $userData, string $userRole, string $templateName = ''): void
    {
        if (empty($templateName)) {
            $templateName = KIVI_CARE_PREFIX . 'admin_new_user_register';
        }

        // Get all admin users
        $admins = get_users([
            'role' => 'administrator',
            'fields' => ['ID', 'user_email', 'display_name']
        ]);

        if (empty($admins)) {
            return;
        }

        foreach ($admins as $admin) {
            $context = [
                'target' => 'admin',
                'admin_email' => $admin->user_email,
                'admin_name' => $admin->display_name,
                'admin_id' => $admin->ID,
                'extra_data' => [
                    'site_url' => get_site_url(),
                    'current_date' => current_time('Y-m-d'),
                    'current_date_time' => current_time('Y-m-d H:i:s'),
                    'user_name' => $userData['first_name'] . ' ' . $userData['last_name'],
                    'user_email' => $userData['user_email'] ?? '',
                    'user_contact' => $userData['contact_number'] ?? $userData['mobile_number'] ?? '',
                    'user_role' => $userRole
                ]
            ];
            
            // Add doctor_id if available (for re-hydration context if needed)
            if (isset($userData['id']) && $userRole === 'doctor') {
                $context['doctor_id'] = $userData['id'];
            }

            $this->scheduleNotification($templateName, $context);
        }
    }
}
