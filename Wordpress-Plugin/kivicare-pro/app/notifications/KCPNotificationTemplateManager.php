<?php

namespace KCProApp\notifications;

use App\baseClasses\KCNotificationDynamicKeys;
use App\baseClasses\KCErrorLogger;
use WP_Post;
use WP_Query;


defined('ABSPATH') or die('Something went wrong');

/**
 * Notification Template Manager - Handles template creation, retrieval, and management
 */
class KCPNotificationTemplateManager
{

    private string $prefix;
    private string $notificationTemplatePostType;
    private static $instance = null;
    private KCNotificationDynamicKeys $dynamicKeys;


    public function __construct()
    {

        $this->prefix = KIVI_CARE_PREFIX;

        $this->notificationTemplatePostType = $this->prefix . 'sms_tmp';
        $this->dynamicKeys = new KCNotificationDynamicKeys();
        $this->init();
    }


    public static function getInstance(): self
    {
        if (self::$instance === null) {
            self::$instance = new self();
        }
        return self::$instance;
    }

    /**
     * Initialize hooks and actions
     */
    private function init(): void
    {
        add_action('init', [$this, 'registerPostTypes']);
    }

    /**
     * Register custom post types for notification templates
     */
    public function registerPostTypes(): void
    {
        // Notification Templates
        register_post_type($this->notificationTemplatePostType, [
            'labels' => [
                'name' => 'KiviCare Notification Templates',
                'singular_name' => 'Notification Template',
                'add_new' => 'Add New Notification Template',
                'add_new_item' => 'Add New Notification Template',
                'edit_item' => 'Edit Notification Template',
                'new_item' => 'New Notification Template',
                'view_item' => 'View Notification Template',
                'search_items' => 'Search Notification Templates',
                'not_found' => 'No Notification templates found',
                'not_found_in_trash' => 'No Notification templates found in trash'
            ],
            'public' => true,
            'has_archive' => false,
            'rewrite' => ['slug' => 'kivicarenotification'],
            'supports' => ['title', 'editor', 'thumbnail', 'excerpt', 'author'],
            'description' => esc_html__('Custom KiviCare Notification Templates', 'kivicare-pro'),
            'show_ui' => false,
            'show_in_menu' => false,
            'map_meta_cap' => true,
            'capability_type' => 'post',
        ]);
    }

    /**
     * Get default notification templates data
     */
    public function getDefaultTemplatesData(): array
    {

        $templatePostType = $this->notificationTemplatePostType;

        $data = [
            [
                'post_name' => $this->prefix . 'patient_register',
                'post_content' => '<p>Welcome to KiviCare,</p><p>Your registration process with {{user_email}} is successfully completed, and your password is {{user_password}}</p><p>Thank you.</p>',
                'post_title' => 'Patient Registration Template',
                'post_type' => $templatePostType,
                'post_status' => 'publish',
            ],
            [
                'post_name' => $this->prefix . 'receptionist_register',
                'post_content' => '<p>Welcome to KiviCare,</p><p>Your registration process with {{user_email}} is successfully completed, and your password is {{user_password}}</p><p>Thank you.</p>',
                'post_title' => 'Receptionist Registration Template',
                'post_type' => $templatePostType,
                'post_status' => 'publish',
            ],
            [
                'post_name' => $this->prefix . 'doctor_registration',
                'post_content' => '<p>Welcome to KiviCare,</p><p>You are successfully registered</p><p>Your email: {{user_email}}, username: {{user_name}} and password: {{user_password}}</p><p>Thank you.</p>',
                'post_title' => 'Doctor Registration Template',
                'post_type' => $templatePostType,
                'post_status' => 'publish',
            ],
            [
                'post_name' => $this->prefix . 'doctor_book_appointment',
                'post_content' => '<p>New appointment</p><p>You have new appointment on</p><p>Date: {{appointment_date}}, Time: {{appointment_time}}, Patient: {{patient_name}}</p><p>Thank you.</p>',
                'post_title' => 'Doctor Booked Appointment Template',
                'post_type' => $templatePostType,
                'post_status' => 'publish',
            ],
            [
                'post_name' => $this->prefix . 'resend_user_credential',
                'post_content' => '<p>Welcome to KiviCare,</p><p>Your KiviCare account user credentials</p><p>Your email: {{user_email}}, username: {{user_name}} and password: {{user_password}}</p><p>Thank you.</p>',
                'post_title' => 'Resend User Credentials',
                'post_type' => $templatePostType,
                'post_status' => 'publish',
            ],
            [
                'post_name' => $this->prefix . 'cancel_appointment',
                'post_content' => '<p>Welcome to KiviCare,</p><p>Your appointment booking is cancelled.</p><p>Date: {{appointment_date}}, Time: {{appointment_time}}</p><p>Clinic: {{clinic_name}} Doctor: {{doctor_name}}</p><p>Thank you.</p>',
                'post_title' => 'Cancel Appointment',
                'post_type' => $templatePostType,
                'post_status' => 'publish',
            ],
            [
                'post_name' => $this->prefix . 'zoom_link',
                'post_content' => '<p>Zoom video conference</p><p>Your have new appointment on</p><p>Date: {{appointment_date}}, Time: {{appointment_time}}, Doctor: {{doctor_name}}, Zoom Link: {{zoom_link}}</p><p>Thank you.</p>',
                'post_title' => 'Video Conference Appointment Template',
                'post_type' => $templatePostType,
                'post_status' => 'publish',
            ],
            [
                'post_name' => $this->prefix . 'add_doctor_zoom_link',
                'post_content' => '<p>Zoom video conference</p><p>Your have new appointment on</p><p>Date: {{appointment_date}}, Time: {{appointment_time}}, Patient: {{patient_name}}, Zoom Link: {{add_doctor_zoom_link}}</p><p>Thank you.</p>',
                'post_title' => 'Doctor Zoom Video Conference Appointment Template',
                'post_type' => $templatePostType,
                'post_status' => 'publish',
            ],
            [
                'post_name' => $this->prefix . 'clinic_admin_registration',
                'post_content' => '<p>Welcome to Clinic,</p><p>You are successfully registered as clinic admin</p><p>Your email: {{user_email}}, username: {{user_name}} and password: {{user_password}}</p><p>Thank you.</p>',
                'post_title' => 'Clinic Admin Registration',
                'post_type' => $templatePostType,
                'post_status' => 'publish',
            ],
            [
                'post_name' => $this->prefix . 'clinic_book_appointment',
                'post_content' => '<p>New appointment</p><p>New appointment booked on {{current_date}}</p><p>For Date: {{appointment_date}}, Time: {{appointment_time}}, Patient: {{patient_name}}, Doctor: {{doctor_name}}</p><p>Thank you.</p>',
                'post_title' => 'Clinic Booked Appointment Template',
                'post_type' => $templatePostType,
                'post_status' => 'publish'
            ],
            [
                'post_name' => $this->prefix . 'book_appointment_reminder',
                'post_content' => '<p>Welcome to KiviCare,</p><p>You have appointment on</p><p>{{appointment_date}}, Time: {{appointment_time}}</p><p>Thank you.</p>',
                'post_title' => 'Patient Appointment Reminder',
                'post_type' => $templatePostType,
                'post_status' => 'publish',
            ],
            [
                'post_name' => $this->prefix . 'book_appointment_reminder_for_doctor',
                'post_content' => '<p>Appointment reminder</p><p>You have appointment on</p><p>Date: {{appointment_date}}, Time: {{appointment_time}}, Patient: {{patient_name}}</p><p>Thank you.</p>',
                'post_title' => 'Doctor Appointment Reminder',
                'post_type' => $templatePostType,
                'post_status' => 'publish',
            ],
            [
                'post_name' => $this->prefix . 'user_verified',
                'post_content' => '<p>Your Account Has been Verified By admin On Date: {{current_date}}</p><p>Login Page: {{login_url}}</p><p>Thank you.</p>',
                'post_title' => 'User Verified By Admin',
                'post_type' => $templatePostType,
                'post_status' => 'publish',
            ],
            [
                'post_name' => $this->prefix . 'admin_new_user_register',
                'post_content' => '<p>New User Register On site {{site_url}} On Date: {{current_date}}</p><p>Name: {{user_name}}</p><p>Email: {{user_email}}</p><p>Contact No: {{user_contact}}</p><p>User Role: {{user_role}}</p><p>Thank you.</p>',
                'post_title' => 'New User Register On Site',
                'post_type' => $templatePostType,
                'post_status' => 'publish',
            ],
            [
                'post_name' => $this->prefix . 'meet_link',
                'post_content' => '<p>Google Meet conference</p><p>Your have new appointment on</p><p>Date: {{appointment_date}}, Time: {{appointment_time}}, Doctor: {{doctor_name}}, Google Meet Link: {{meet_link}}</p><p>Event Link {{meet_event_link}}</p><p>Thank you.</p>',
                'post_title' => 'Google Meet Video Conference Appointment Template',
                'post_type' => $templatePostType,
                'post_status' => 'publish',
            ],
            [
                'post_name' => $this->prefix . 'add_doctor_meet_link',
                'post_content' => '<p>Google Meet conference</p><p>Your have new appointment on</p><p>Date: {{appointment_date}}, Time: {{appointment_time}}, Patient: {{patient_name}}, Google Meet Link: {{meet_link}}</p><p>Event Link {{meet_event_link}}</p><p>Thank you.</p>',
                'post_title' => 'Doctor Google Meet Video Conference Appointment Template',
                'post_type' => $templatePostType,
                'post_status' => 'publish',
            ],
            [
                'post_name' => $this->prefix . 'patient_clinic_check_in_check_out',
                'post_content' => '<p>Welcome to KiviCare,</p><p>New Patient Check In to Clinic</p><p>Patient: {{patient_name}}</p><p>Patient Email: {{patient_email}}</p><p>Check In Date: {{current_date}}</p><p>Thank you.</p>',
                'post_title' => 'Patient Clinic In',
                'post_type' => $templatePostType,
                'post_status' => 'publish',
            ],
            [
                'post_name' => $this->prefix . 'add_appointment',
                'post_content' => '<p>Welcome to KiviCare,</p><p>Your appointment has been booked successfully on</p><p>{{appointment_date}}, Time: {{appointment_time}}</p><p>Thank you.</p>',
                'post_title' => 'Patient Appointment Booking Template',
                'post_type' => $templatePostType,
                'post_status' => 'publish',
            ],
            [
                'post_name' => $this->prefix . 'payment_pending',
                'post_content' => '<p>Appointment Payment,</p><p>Your Appointment is cancelled due to pending payment</p><p>Thank you.</p>',
                'post_title' => 'Appointment Payment Pending Template',
                'post_type' => $templatePostType,
                'post_status' => 'publish',
            ],
            [
                'post_name' => $this->prefix . 'patient_invoice',
                'post_content' => '<p>Welcome to KiviCare,</p><p>Find your Invoice in attachment</p><p>Thank you.</p>',
                'post_title' => 'Patient Invoice',
                'post_type' => $templatePostType,
                'post_status' => 'publish'
            ],
            [
                'post_name' => $this->prefix . 'followup_reminder',
                'post_content' => '<p>Dear {{patient_name}},</p><p>This is a reminder for your upcoming follow-up at <strong>{{clinic_name}}</strong>.</p><p><strong>Reason:</strong> {{followup_reason}}</p><p><strong>Suggested Date:</strong> {{suggested_date}}</p><p>Thank you.</p>',
                'post_title' => 'Follow-up Reminder Template',
                'post_type' => $templatePostType,
                'post_status' => 'publish',
            ],
            [
                'post_name' => $this->prefix . 'follow_up_appointment_for_staff',
                'post_content' => '<p>New follow-up recommended</p><p>A new follow-up has been created for</p><p>Patient: {{patient_name}}, Date: {{suggested_date}}, Reason: {{reason}}</p><p>Thank you.</p>',
                'post_title' => 'Follow-up Appointment Staff Template',
                'post_type' => $templatePostType,
                'post_status' => 'publish',
            ],
            [
                'post_name'    => $this->prefix . 'appointment_rescheduled_by_gcal',
                'post_content' => '<p>Dear {{patient_name}},</p><p>Your appointment #{{appointment_id}} has been updated via Google Calendar.</p><p>New Time: <strong>{{appointment_date}} at {{appointment_time}}</strong></p><p>Clinic: {{clinic_name}}</p><p>Thank you.</p>',
                'post_title'   => 'Appointment Rescheduled via Google Calendar (Patient)',
                'post_type'    => $templatePostType,
                'post_status'  => 'publish',
            ],
            [
                'post_name'    => $this->prefix . 'doctor_appointment_rescheduled_by_gcal',
                'post_content' => '<p>New update via Google Calendar</p><p>Appointment #{{appointment_id}} has been rescheduled.</p><p>New Time: <strong>{{appointment_date}} at {{appointment_time}}</strong></p><p>Patient: {{patient_name}}</p><p>Thank you.</p>',
                'post_title'   => 'Appointment Rescheduled via Google Calendar (Doctor)',
                'post_type'    => $templatePostType,
                'post_status'  => 'publish',
            ],
            [
                'post_name'    => $this->prefix . 'appointment_gcal_revert',
                'post_content' => '<p>Google Calendar Sync Conflict</p><p>The event change for appointment #{{appointment_id}} was <strong>reverted</strong> because the selected slot ({{appointment_date}} at {{appointment_time}}) is already booked.</p><p>Thank you.</p>',
                'post_title'   => 'Google Calendar Sync Reverted (Conflict)',
                'post_type'    => $templatePostType,
                'post_status'  => 'publish',
            ],
        ];

        return apply_filters('kivicare_pro_notification_template_post_array', $data, $templatePostType, $this->prefix);
    }


    /**
     * Create default templates
     */
    public function createDefaultTemplates(): bool
    {

        $templates = $this->getDefaultTemplatesData();
        foreach ($templates as $template) {
            // Check if template already exists
            if (!$this->templateExists($template['post_name'])) {
                $post_id = wp_insert_post($template);
                if (is_wp_error($post_id)) {
                    KCErrorLogger::instance()->error('Failed to create template: ' . $template['post_name']);
                    return false;
                }
            }
        }

        return true;
    }

    /**
     * Check if template exists
     */
    private function templateExists(string $postName): bool
    {
        $args = [
            'name'           => $postName,
            'post_type'      => $this->notificationTemplatePostType,
            'post_status'    => 'any',
            'posts_per_page' => 1,
            'fields'         => 'ids'
        ];
        $posts = get_posts($args);
        return !empty($posts);
    }

    /**
     * Get template by name
     */
    public function getTemplate(string $templateName, string $type = 'notification'): ?WP_Post
    {
        $postType = $this->notificationTemplatePostType;

        $query = new WP_Query([
            'post_type' => $postType,
            'name' => $templateName,
            'post_status' => 'publish',
            'posts_per_page' => 1
        ]);

         if ($query->have_posts()) {
            $post = $query->posts[0];
            $post->content_sid = get_post_meta($post->ID, 'content_sid', true);
            return $post;
        }

        return null;
    }


    /**
     * Get template by ID
     */
    public function getTemplateById(int $templateId, string $type = 'notification'): ?WP_Post
    {
        $postType = $this->notificationTemplatePostType;

        $query = new WP_Query([
            'post_type' => $postType,
            'p' => $templateId,
            'post_status' => 'any',
            'posts_per_page' => 1
        ]);

        if ($query->have_posts()) {
            $post = $query->posts[0];
            $post->content_sid = get_post_meta($post->ID, 'content_sid', true);
            return $post;
        }

        return null;
    }
    /**
     * Get template data along with dynamic keys by template ID
     */
    public function getTemplateWithKeysById(int $templateId, string $type = 'notification'): ?array
    {
        $templatePost = $this->getTemplateById($templateId, $type);

        if (!$templatePost instanceof \WP_Post) {
            return null;
        }


        $templateName = $templatePost->post_name;

        $dynamicKeys = $this->dynamicKeys->getDynamicKeys($templateName);

        return [
            'templatePost'    => $templatePost,
            'dynamic_keys' => $dynamicKeys,
        ];
    }

    /**
     * Get all templates by type
     */
    public function getTemplatesList(string $templateType = 'mail'): array
    {
        $postType = strtolower($this->prefix . $templateType . '_tmp');

        $args = [
            'post_type' => $postType,
            'numberposts' => -1,
            'post_status' => 'any',
        ];

        $templateResult = get_posts($args);

        $userWiseTemplate = $this->getUserWiseTemplateMapping();

        $templateResult = collect($templateResult)->sortBy('ID')->map(function ($value) {
            $value->base_post_name = preg_replace('/-\d+$/', '', $value->post_name);
            $value->content_sid = get_post_meta($value->ID, 'content_sid', true);
            return $value;
        })->unique('base_post_name')->map(function ($value) use ($userWiseTemplate) {
            foreach ($userWiseTemplate as $userType => $templates) {
                if (in_array($value->base_post_name, $templates)) {
                    $value->user_type = $userType;
                    break;
                }
            }

            if (empty($value->user_type)) {
                $value->user_type = 'common';
            }

            $value->post_content = wp_kses($value->post_content, $this->getAllowedHtml());
            return $value;
        });

        return $templateResult->groupBy('user_type')->sortKeys()->toArray();
    }

    /**
     * Get user-wise template mapping
     */
    private function getUserWiseTemplateMapping(): array
    {
        $prefix = strtolower($this->prefix);
        $userWiseTemplate = [
            'patient' => [
                $prefix . 'patient_register',
                $prefix . 'book_appointment_reminder',
                $prefix . 'book_appointment',
                $prefix . 'add_appointment',
                $prefix . 'cancel_appointment',
                $prefix . 'encounter_close',
                $prefix . 'zoom_link',
                $prefix . 'meet_link',
                $prefix . 'patient_clinic_check_in_check_out',
                $prefix . 'followup_reminder',
                $prefix . 'appointment_rescheduled_by_gcal',
                $prefix . 'patient_invoice',
            ],
            'doctor' => [
                $prefix . 'doctor_registration',
                $prefix . 'doctor_book_appointment',
                $prefix . 'add_doctor_zoom_link',
                $prefix . 'add_doctor_meet_link',
                $prefix . 'book_appointment_reminder_for_doctor',
                $prefix . 'doctor_appointment_rescheduled_by_gcal',
                $prefix . 'follow_up_appointment_for_staff'
            ],
            'clinic' => [
                $prefix . 'clinic_admin_registration',
                $prefix . 'clinic_book_appointment',
                $prefix . 'follow_up_appointment_for_staff'
            ],
            'receptionist' => [
                $prefix . 'receptionist_register',
                $prefix . 'follow_up_appointment_for_staff'
            ],
            'common' => [
                $prefix . 'resend_user_credential',
                $prefix . 'user_verified',
                $prefix . 'admin_new_user_register'
            ]
        ];

        return apply_filters('kivicare_user_wise_notification_template', $userWiseTemplate);
    }

    /**
     * Get allowed HTML tags for template content
     */
    private function getAllowedHtml(): array
    {
        return [
            'p' => [],
            'br' => [],
            'strong' => [],
            'b' => [],
            'em' => [],
            'i' => [],
            'u' => [],
            'a' => [
                'href' => [],
                'title' => [],
                'target' => []
            ],
            'h1' => [],
            'h2' => [],
            'h3' => [],
            'h4' => [],
            'h5' => [],
            'h6' => [],
            'ul' => [],
            'ol' => [],
            'li' => [],
            'div' => [
                'class' => [],
                'style' => []
            ],
            'span' => [
                'class' => [],
                'style' => []
            ]
        ];
    }

    /**
     * Update template content
     */
    public function updateTemplate(string $templateName, string $content, string $type = 'notification'): bool
    {
        $template = $this->getTemplate($templateName, $type);

        if (!$template) {
            return false;
        }

        $result = wp_update_post([
            'ID' => $template->ID,
            'post_content' => $content
        ]);

        return !is_wp_error($result);
    }

    /**
     * Delete template
     */
    public function deleteTemplate(string $templateName, string $type = 'notification'): bool
    {
        $template = $this->getTemplate($templateName, $type);

        if (!$template) {
            return false;
        }

        $result = wp_delete_post($template->ID, true);
        return $result !== false;
    }
}
