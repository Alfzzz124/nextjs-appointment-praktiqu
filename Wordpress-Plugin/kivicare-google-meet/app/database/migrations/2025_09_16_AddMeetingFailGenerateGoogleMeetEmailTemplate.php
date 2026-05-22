<?php

namespace KiviCare\Migrations;

use App\database\classes\KCAbstractMigration;
use App\emails\KCEmailTemplateManager;
use App\baseClasses\KCErrorLogger;

defined('ABSPATH') or die('Something went wrong');

class AddMeetingFailGenerateGoogleMeetEmailTemplate extends KCAbstractMigration
{
    public function run()
    {
        $emailTemplateManager = KCEmailTemplateManager::getInstance();
        $templates = [
            [
                'post_name'    => KIVICARE_GOOGLE_MEET_PREFIX . 'doctor_gmeet_fail_notify',
                'post_content' => '<p>Dear {{doctor_name}},</p><p>We were unable to generate a Google Meet link for the appointment with {{patient_name}} scheduled on {{appointment_date}} at {{appointment_time}}.</p><p>Please notify the admin or try again. If the issue persists, contact support.</p><p>Thank you.</p>',
                'post_title'   => 'Google Meet Link Generation Failed Notification (Doctor)',
                'post_type'    => KIVICARE_GOOGLE_MEET_PREFIX . 'mail_tmp',
                'post_status'  => 'publish',
            ],
            [
                'post_name'    => KIVICARE_GOOGLE_MEET_PREFIX . 'admin_gmeet_fail_notify',
                'post_content' => '<p>Dear Admin,</p><p>The system was unable to generate a Google Meet link for the appointment between Dr. {{doctor_name}} and {{patient_name}} scheduled on {{appointment_date}} at {{appointment_time}}.</p><p>Please investigate the issue or contact support if needed.</p><p>Thank you.</p>',
                'post_title'   => 'Google Meet Link Generation Failed Notification (Admin)',
                'post_type'    => KIVICARE_GOOGLE_MEET_PREFIX . 'mail_tmp',
                'post_status'  => 'publish',
            ]
        ];

        foreach ($templates as $template) {
            if (!$emailTemplateManager->templateExists($template['post_name'])) {
                $post_id = wp_insert_post($template);
                if (is_wp_error($post_id)) {
                    KCErrorLogger::instance()->error('Failed to create Google Meet failure template: ' . $template['post_name']);
                    return false;
                }
            }
        }
    }

    public function rollback()
    {
        $template_slugs = [
            KIVICARE_GOOGLE_MEET_PREFIX . 'doctor_gmeet_fail_notify',
            KIVICARE_GOOGLE_MEET_PREFIX . 'admin_gmeet_fail_notify'
        ];

        foreach ($template_slugs as $slug) {
            $args = [
                'name'        => $slug,
                'post_type'   => KIVICARE_GOOGLE_MEET_PREFIX . 'mail_tmp',
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