<?php
namespace KCProApp\controllers\filters;

use KCProApp\baseClasses\KCProAvailableChannels;

defined('ABSPATH') or die('Something went wrong');

class KCProSettingsFilters
{
    private static ?KCProSettingsFilters $instance = null;

    public function __construct()
    {
        //Encounter Module Setting
        add_filter('kcpro_save_encounter_setting', [$this, 'saveEncounterModule']);
        add_filter('kcpro_get_encounter_list', [$this, 'getEncounterModule']);

        //Prescription Module Setting
        add_filter('kcpro_save_prescription_setting', [$this, 'savePrescriptionModule']);
        add_filter('kcpro_get_prescription_list', [$this, 'getPrescriptionModule']);

        //Follow-up Setting
        add_filter('kcpro_get_followup_settings', [$this, 'getFollowupSettings']);
        add_filter('kcpro_save_followup_settings', [$this, 'saveFollowupSettings']);

        //Treatment Chain Setting
        add_filter('kcpro_get_treatment_chain_settings', [$this, 'getTreatmentChainSettings']);
        add_filter('kcpro_save_treatment_chain_settings', [$this, 'saveTreatmentChainSettings']);

        // Inject followup + treatment chain feature flags into the shared module_config
        // so the frontend can read them from useAuth() without a separate API call.
        add_filter('kivicare_module_config', [$this, 'appendFollowupModuleConfig']);

        // Hide the Follow-ups sidebar item when the module is disabled
        add_filter('kivicare_sidebar_data', [$this, 'filterFollowupSidebarItem'], 10, 2);

        // Add dynamic keys for the follow-up reminder template
        add_filter('kivicare_template_dynamic_keys', [$this, 'appendFollowupDynamicKeys']);

        // Register default Follow-up Reminder templates for Email and Push
        add_filter('kivicare_notification_template_post_array', [$this, 'appendFollowupEmailTemplate'], 10, 2);
        add_filter('kivicare_push_notification_templates', [$this, 'appendFollowupPushTemplate']);
    }

    public static function get_instance(): KCProSettingsFilters|null
    {
        if (!isset(self::$instance)) {
            self::$instance = new self();
        }
        return self::$instance;
    }

    /**
     * Save encounter module settings.
     *
     * @param array $settings Encounter settings array.
     * @return array Response with status and message.
     */
    public function saveEncounterModule(array $settings): array
    {
        if (empty($settings) || !is_array($settings)) {
            return [
                'status' => false,
                'message' => esc_html__('Invalid or missing encounter module settings.', 'kivicare-pro'),
            ];
        }
          
        // spellling mistake in 'enocunter_modules' is intentional to maintain backward compatibility
        $option_name = KIVI_CARE_PRO_PREFIX . 'enocunter_modules';
        $updated = update_option($option_name, wp_json_encode($settings));
        return [
            'status' => (bool) $updated,
            'message' => $updated
                ? esc_html__('Settings updated successfully.', 'kivicare-pro')
                : esc_html__('No changes made or failed to update settings.', 'kivicare-pro'),
        ];
    }

    /**
     * Save prescription module settings.
     *
     * @param array $settings Prescription settings array.
     * @return array Response with status and message.
     */
    public function savePrescriptionModule(array $settings): array
    {
        if (empty($settings) || !is_array($settings)) {
            return [
                'status' => false,
                'message' => esc_html__('Invalid or missing prescription module settings.', 'kivicare-pro'),
            ];
        }

        $option_name = KIVI_CARE_PRO_PREFIX . 'prescription_module';
        $updated = update_option($option_name, wp_json_encode($settings));

        return [
            'status' => (bool) $updated,
            'message' => $updated
                ? esc_html__('Settings updated successfully.', 'kivicare-pro')
                : esc_html__('No changes made or failed to update settings.', 'kivicare-pro'),
        ];
    }

    /**
     * Retrieve encounter module settings.
     *
     * @return array Response with status and decoded data.
     */
    public function getEncounterModule(): array
    {
        // spellling mistake in 'enocunter_modules' is intentional to maintain backward compatibility
        $option = get_option(KIVI_CARE_PRO_PREFIX . 'enocunter_modules', []);

        if (is_string($option)) {
            $data = json_decode($option, true);
        } else {
            $data = $option;
        }

        return isset($data['encounter_module_config']) ? $data['encounter_module_config'] : [];
    }

    /**
     * Retrieve prescription module settings.
     *
     * @return array Response with status and decoded data.
     */
    public function getPrescriptionModule(): array
    {
        $option = get_option(KIVI_CARE_PRO_PREFIX . 'prescription_module', []);

        if (is_string($option)) {
            $data = json_decode($option, true);
        } else {
            $data = $option;
        }

        return isset($data['prescription_module_config']) ? $data['prescription_module_config'] : [];
    }

    /**
     * Get Follow-up settings.
     */
    public function getFollowupSettings(): array
    {
        $settings = get_option(KIVI_CARE_PRO_PREFIX . 'followup_settings', []);
        if (is_string($settings)) {
            $settings = json_decode($settings, true) ?: [];
        }

        // Ensure reminder_channels is always a clean array of strings
        $rawChannels = $settings['reminder_channels'] ?? ['email'];
        if (!is_array($rawChannels) || empty($rawChannels)) {
            $rawChannels = ['email'];
        }
        $allowedChannels = ['email', 'sms', 'whatsapp', 'push', 'custom', 'twilio'];
        $rawChannels = array_values(array_intersect($rawChannels, $allowedChannels)) ?: ['email'];

        return [
            'enable_followup'           => (bool) ($settings['enable_followup']           ?? true),
            'overdue_threshold'         => (int)  ($settings['overdue_threshold']         ?? 14),
            'receptionist_can_schedule' => (bool) ($settings['receptionist_can_schedule'] ?? true),
            'enable_reminder'           => (bool) ($settings['enable_reminder']           ?? true),
            'reminder_days_before'      => (int)  ($settings['reminder_days_before']      ?? 7),
            'reminder_channels'         => $rawChannels,
        ];
    }

    /**
     * Save Follow-up settings.
     */
    public function saveFollowupSettings($settings): array
    {
        $updated = update_option(KIVI_CARE_PRO_PREFIX . 'followup_settings', wp_json_encode($settings));
        // Flush channel availability cache so next page load re-detects
        KCProAvailableChannels::flush();
        return [
            'status'  => (bool) $updated,
            'message' => $updated
                ? esc_html__('Follow-up settings updated successfully.', 'kivicare-pro')
                : esc_html__('No changes made or failed to update settings.', 'kivicare-pro'),
        ];
    }

    /**
     * Get Treatment Chain settings.
     */
    public function getTreatmentChainSettings(): array
    {
        $settings = get_option(KIVI_CARE_PRO_PREFIX . 'treatment_chain_settings', []);
        if (is_string($settings)) {
            $settings = json_decode($settings, true) ?: [];
        }

        return [
            'enable_chains' => (bool) ($settings['enable_chains'] ?? true),
            'allow_multiple_active' => (bool) ($settings['allow_multiple_active'] ?? false),
            'closure_policy' => $settings['closure_policy'] ?? 'manual',
            'management_permission' => $settings['management_permission'] ?? 'administrator',
        ];
    }

    /**
     * Save Treatment Chain settings.
     */
    public function saveTreatmentChainSettings($settings): array
    {
        $updated = update_option(KIVI_CARE_PRO_PREFIX . 'treatment_chain_settings', wp_json_encode($settings));
        return [
            'status' => (bool) $updated,
            'message' => $updated
                ? esc_html__('Treatment chain settings updated successfully.', 'kivicare-pro')
                : esc_html__('No changes made or failed to update settings.', 'kivicare-pro'),
        ];
    }

    /**
     * Append followup + treatment chain feature flags to the shared module_config
     * that Lite exposes via the `kivicare_module_config` filter.
     *
     * Keys added (read by the frontend via useAuth().module_config):
     *   followup_enabled               → '1'|'0'
     *   followup_chains_enabled        → '1'|'0'
     *   followup_receptionist_schedule → '1'|'0'
     *   followup_management_permission → 'doctor'|'clinic_admin'|'administrator'
     *
     * @param array $module_config Existing module_config key-value map from Lite.
     * @return array Extended module_config.
     */
    public function appendFollowupModuleConfig(array $module_config): array
    {
        $fup   = $this->getFollowupSettings();
        $chain = $this->getTreatmentChainSettings();

        $module_config['followup_enabled']               = $fup['enable_followup']          ? '1' : '0';
        $module_config['followup_chains_enabled']        = $chain['enable_chains']           ? '1' : '0';
        $module_config['followup_receptionist_schedule'] = $fup['receptionist_can_schedule'] ? '1' : '0';
        $module_config['followup_management_permission'] = $chain['management_permission'];   // string
        $module_config['followup_reminder_days_before']  = (string) $fup['reminder_days_before']; // numeric string
        $module_config['followup_reminder_channels']     = implode(',', $fup['reminder_channels']); // comma-separated saved channels

        // Inject full channel catalogue (with availability flags) so React renders only real options.
        // Format: JSON array of {key, label, icon, available} objects.
        $module_config['followup_notification_channels'] = KCProAvailableChannels::all();

        return $module_config;
    }
     /**
     * Remove the Follow-ups item from the sidebar when the module is disabled.
     *
     * The Follow-ups link lives as a child inside the Appointments parent item
     * (routeClass = 'followup_list'). This method recursively removes it from
     * all children arrays so it disappears regardless of nesting depth.
     *
     * @param array  $sidebar Sidebar items array from Lite.
     * @param string $role    Current user role.
     * @return array Filtered sidebar.
     */
    public function filterFollowupSidebarItem(array $sidebar, string $role): array
    {
        // Only filter when Pro is active AND follow-up module is disabled
        if ($this->getFollowupSettings()['enable_followup']) {
            return $sidebar; // module is on — nothing to hide
        }

        return $this->removeSidebarItemByRouteClass($sidebar, 'followup_list');
    }

    /**
     * Recursively remove all sidebar items (including nested children) that
     * match the given routeClass.
     *
     * @param array  $items       Sidebar items array.
     * @param string $routeClass  The routeClass to remove.
     * @return array
     */
    private function removeSidebarItemByRouteClass(array $items, string $routeClass): array
    {
        $filtered = [];

        foreach ($items as $item) {
            // Recursively filter children first
            if (!empty($item['childrens']) && is_array($item['childrens'])) {
                $item['childrens'] = $this->removeSidebarItemByRouteClass($item['childrens'], $routeClass);
            }

            // Keep the item unless it matches the target routeClass
            if (($item['routeClass'] ?? '') !== $routeClass) {
                $filtered[] = $item;
            }
        }

        return array_values($filtered);
    }
    /**
     * Add dynamic keys for the follow-up reminder template.
     * These placeholders can be inserted when editing the 'followup_reminder' template.
     *
     * @param array $dynamicKeys Map of template_name => keys array.
     * @return array
     */
    public function appendFollowupDynamicKeys(array $dynamicKeys): array
    {
        $prefix = KIVI_CARE_PREFIX;
        $dynamicKeys[$prefix . 'followup_reminder'] = [
            '{{patient_name}}',
            '{{doctor_name}}',
            '{{clinic_name}}',
            '{{followup_reason}}',
            '{{followup_priority}}',
            '{{suggested_date}}',
            '{{current_date}}',
            '{{current_date_time}}',
        ];

        return $dynamicKeys;
    }

    /**
     * Add the standard 'followup_reminder' template to the Email template manager.
     */
    public function appendFollowupEmailTemplate(array $templates, string $postType): array
    {
        $prefix = KIVI_CARE_PREFIX;
        // Only append if it's the mail template post type
        if ($postType !== $prefix . 'mail_tmp') {
            return $templates;
        }

        $templates[] = [
            'post_name'    => $prefix . 'followup_reminder',
            'post_title'   => 'Follow-up Reminder Template (Email)',
            'post_content' => '
<p>Dear {{patient_name}},</p>
<p>This is a reminder for your upcoming follow-up at <strong>{{clinic_name}}</strong>.</p>
<hr/>
<p><strong>Follow-up Details:</strong></p>
<ul>
    <li><strong>Reason:</strong> {{followup_reason}}</li>
    <li><strong>Priority:</strong> {{followup_priority}}</li>
    <li><strong>Suggested Date:</strong> {{suggested_date}}</li>
</ul>
<p>Please contact us at {{clinic_contact_number}} if you have any questions.</p>
<p>Thank you,<br/>{{clinic_name}}</p>',
            'post_type'    => $postType,
            'post_status'  => 'publish',
        ];

        return $templates;
    }

    /**
     * Add the standard 'followup_reminder' template to the Push notification manager.
     */
    public function appendFollowupPushTemplate(array $templates): array
    {
        $prefix = KIVI_CARE_PREFIX;
        $name   = $prefix . 'followup_reminder';

        $templates[$name] = [
            'name'       => $name,
            'title'      => 'Follow-up Reminder',
            'body'       => 'Hi {{patient_name}}, a quick reminder for your follow-up regarding: {{followup_reason}}',
            'data'       => [
                'type'         => 'followup',
                'action'       => 'view_followup',
                'followup_id'  => '{{followup_id}}',
            ],
            'recipients' => ['patient'],
            'enabled'    => 'on',
        ];

        return $templates;
    }
}
