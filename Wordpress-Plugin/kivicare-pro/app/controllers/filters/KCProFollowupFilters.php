<?php
namespace KCProApp\controllers\filters;

use KCProApp\services\KCProFollowupService;



defined('ABSPATH') or die('Something went wrong');

class KCProFollowupFilters
{
    private static ?KCProFollowupFilters $instance = null;

    public function __construct()
    {
        // Register hooks for reverting Follow-up status on Appointment cancellation/deletion
        add_action('kc_appointment_cancelled', [KCProFollowupService::get_instance(), 'handleAppointmentCancellation']);
        add_action('kc_appointment_deleted', [KCProFollowupService::get_instance(), 'handleAppointmentCancellation']);

        // Register filter to show follow-up treatment notice
        add_filter('kivicare_followup_treatment_notice', [$this, 'addFollowupNotice']);
    }

    public function addFollowupNotice()
    {
        return [
            'id' => 'followup_treatment_feature',
            'type' => 'feature',
            'title' => __('New: Follow-up & Treatment Module', 'kivicare-clinic-management-system'),
            'message' => __('Introducing the new Follow-up and Treatment module! Manage patient treatment chains and automate follow-up scheduling with ease.', 'kivicare-clinic-management-system'),
            'dismissible' => true,
            'priority' => 'medium',
            'actions' => [
                [
                    'label' => __('Setup Wizard', 'kivicare-clinic-management-system'),
                    'action' => 'openSetupWizard',
                    'type' => 'primary'
                ]
            ]
        ];
    }

    public static function get_instance(): KCProFollowupFilters|null
    {
        if (!isset(self::$instance)) {
            self::$instance = new self();
        }
        return self::$instance;
    }
}
