<?php

namespace KiviCare\Migrations;

use App\database\classes\KCAbstractMigration;

defined('ABSPATH') or die('Something went wrong');

/**
 * Migration: Add followup and chain capabilities to roles
 */
class AddFollowupChainCapabilitiesToRoles extends KCAbstractMigration {
    /**
     * Run the migration
     */
    public function run() {
        $prefix = defined('KIVI_CARE_PREFIX') ? KIVI_CARE_PREFIX : 'kiviCare_';
        $role_caps = [
            KIVI_CARE_PREFIX . 'patient' => [
                'followup_list', 'followup_view'
            ],
            KIVI_CARE_PREFIX . 'doctor' => [
                'followup_cancel', 'followup_schedule', 'chain_manage_clinical', 'followup_create_clinical', 'followup_update_clinical'
            ],
            KIVI_CARE_PREFIX . 'receptionist' => [
                'followup_cancel', 'followup_schedule', 'chain_read_all'
            ],
            KIVI_CARE_PREFIX . 'clinic_admin' => [
                'followup_cancel', 'followup_schedule', 'chain_admin_override', 'chain_read_all'
            ],
            'administrator' => [
                'followup_cancel', 'followup_schedule', 'chain_manage_clinical', 'chain_admin_override', 'chain_read_all',
                'chain_configure', 'followup_create_clinical', 'followup_update_clinical'
            ],
        ];
        foreach ($role_caps as $role_key => $caps) {
            $role = get_role($role_key);
            if ($role) {
                foreach ($caps as $cap) {
                    $role->add_cap($prefix . $cap);
                }
            }
        }
    }

    /**
     * Rollback the migration
     */
    public function rollback() {
        $prefix = defined('KIVI_CARE_PREFIX') ? KIVI_CARE_PREFIX : 'kiviCare_';
        $role_caps = [
            KIVI_CARE_PREFIX . 'patient' => [
                'followup_list', 'followup_view'
            ],
            KIVI_CARE_PREFIX . 'doctor' => [
                'followup_cancel', 'followup_schedule', 'chain_manage_clinical', 'followup_create_clinical', 'followup_update_clinical'
            ],
            KIVI_CARE_PREFIX . 'receptionist' => [
                'followup_cancel', 'followup_schedule', 'chain_read_all'
            ],
            KIVI_CARE_PREFIX . 'clinic_admin' => [
                'followup_cancel', 'followup_schedule', 'chain_admin_override', 'chain_read_all'
            ],
            'administrator' => [
                'followup_cancel', 'followup_schedule', 'chain_manage_clinical', 'chain_admin_override', 'chain_read_all',
                'chain_configure', 'followup_create_clinical', 'followup_update_clinical'
            ],
        ];
        foreach ($role_caps as $role_key => $caps) {
            $role = get_role($role_key);
            if ($role) {
                foreach ($caps as $cap) {
                    $role->remove_cap($prefix . $cap);
                }
            }
        }
    }
}
