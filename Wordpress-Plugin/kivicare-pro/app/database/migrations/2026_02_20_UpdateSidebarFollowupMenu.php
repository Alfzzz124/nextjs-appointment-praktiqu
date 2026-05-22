<?php

namespace KiviCare\Migrations;

use App\database\classes\KCAbstractMigration;

defined('ABSPATH') or die('Something went wrong');

/**
 * Migration to add Follow-ups to the sidebar menu for existing installations
 */
class UpdateSidebarFollowupMenu extends KCAbstractMigration
{
    /**
     * Run the migration
     */
    public function run()
    {
        $prefix = KIVI_CARE_PREFIX;
        $roles = ['administrator', 'clinic_admin', 'receptionist', 'doctor'];

        foreach ($roles as $role) {
            $option_key = $prefix . "{$role}_dashboard_sidebar_data_4.0";
            $sidebar_data = get_option($option_key);

            if (empty($sidebar_data) || !is_array($sidebar_data)) {
                continue;
            }

            $changed = false;
            foreach ($sidebar_data as &$item) {
                // Find Appointments parent
                if (isset($item['label']) && $item['label'] === 'Appointments' && $item['type'] === 'parent') {
                    if (!isset($item['childrens']) || !is_array($item['childrens'])) {
                        $item['childrens'] = [];
                    }

                    // Check if Follow-ups already exists in children
                    $has_followup = false;
                    foreach ($item['childrens'] as $child) {
                        if (isset($child['routeClass']) && $child['routeClass'] === 'followup_list') {
                            $has_followup = true;
                            break;
                        }
                    }

                    if (!$has_followup) {
                        $item['childrens'][] = [
                            'label'      => 'Follow-ups',
                            'type'       => 'route',
                            'link'       => '/followup',
                            'iconClass'  => 'ph ph-calendar-check',
                            'routeClass' => 'followup_list',
                            'childrens'  => []
                        ];
                        $changed = true;
                    }
                }
            }

            if ($changed) {
                update_option($option_key, $sidebar_data);
                
                // Clear sidebar cache
                $sidebar_manager = \App\baseClasses\KCSidebarManager::getInstance();
                $actual_role = $role === 'administrator' ? $role : $prefix . $role;
                $sidebar_manager->clearCache($actual_role);
            }
        }
    }
}
