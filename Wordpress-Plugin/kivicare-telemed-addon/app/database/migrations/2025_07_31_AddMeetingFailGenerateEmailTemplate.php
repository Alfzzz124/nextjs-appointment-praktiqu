<?php

namespace KiviCare\Migrations;

use App\database\classes\KCAbstractMigration;
use App\emails\KCEmailTemplateManager;
use App\baseClasses\KCErrorLogger;

defined('ABSPATH') or die('Something went wrong');
class AddMeetingFailGenerateEmailTemplate extends KCAbstractMigration
{
    public function run()
    {
        $emailTemplateManager = KCEmailTemplateManager::getInstance();
        $templates = [
            [
                'post_name' => KIVICARE_TELEMED_PREFIX . 'doctor_meeting_fail_notify',
                'post_content' => '<p>Dear {{doctor_name}},</p><p>We were unable to generate a meeting link for the appointment with {{patient_name}} scheduled on {{appointment_date}}.</p><p>Please notify the admin or try again. If the issue persists, contact support.</p><p>Thank you.</p>',
                'post_title' => 'Meeting Link Generation Failed Notification',
                'post_type' => KIVICARE_TELEMED_PREFIX . 'mail_tmp',
                'post_status' => 'publish',
            ],
            [
                'post_name' => KIVICARE_TELEMED_PREFIX . 'admin_meeting_fail_notify',
                'post_content' => '<p>Dear Admin,</p><p>The system was unable to generate a meeting link for the appointment between Dr. {{doctor_name}} and {{patient_name}} scheduled on {{appointment_date}}.</p><p>Please investigate the issue or contact support if needed.</p><p>Thank you.</p>',
                'post_title' => 'Admin Meeting Link Generation Failed Notification',
                'post_type' => KIVICARE_TELEMED_PREFIX . 'mail_tmp',
                'post_status' => 'publish',
            ]
        ];

        foreach ($templates as $template) {
            // Check if template already exists
            if (!$emailTemplateManager->templateExists($template['post_name'])) {
                $post_id = wp_insert_post($template);
                if (is_wp_error($post_id)) {
                    KCErrorLogger::instance()->error('Failed to create template: ' . $template['post_name']);
                    return false;
                }
            }
        }

    }
    public function rollback()
    {
        $template_slugs = [
            KIVICARE_TELEMED_PREFIX . 'doctor_meeting_fail_notify',
            KIVICARE_TELEMED_PREFIX . 'admin_meeting_fail_notify'
        ];

        foreach ($template_slugs as $slug) {
            $args = [
                'name'        => $slug,
                'post_type'   => KIVICARE_TELEMED_PREFIX . 'mail_tmp',
                'post_status' => 'any',
                'numberposts' => -1
            ];
            $posts = get_posts($args);
            foreach ($posts as $post) {
                wp_delete_post($post->ID, true);
            }
        }
    }
}
