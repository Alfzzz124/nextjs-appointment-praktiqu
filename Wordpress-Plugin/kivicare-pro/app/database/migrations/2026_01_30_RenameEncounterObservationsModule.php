<?php

namespace KiviCare\Migrations;

use App\database\classes\KCAbstractMigration;

defined('ABSPATH') or die('Something went wrong');

/**
 * Migration to rename encounter observations module to observation
 */
class RenameEncounterObservationsModule extends KCAbstractMigration
{
    /**
     * Run the migration
     */
    public function run()
    {
        $key = 'kiviCare_enocunter_modules';
        $config_data = get_option($key);

        if (empty($config_data)) {
            return;
        }

        $is_json = false;
        $data = $config_data;

        if (is_string($config_data)) {
            $decoded = json_decode($config_data, true);
            if (json_last_error() === JSON_ERROR_NONE) {
                $data = $decoded;
                $is_json = true;
            }
        }

        if (is_array($data) && isset($data['encounter_module_config'])) {
            $changed = false;
            foreach ($data['encounter_module_config'] as &$module) {
                if (isset($module['name']) && $module['name'] === 'observations') {
                    $module['name'] = 'observation';
                    $changed = true;
                }
            }

            if ($changed) {
                $final_data = $is_json ? json_encode($data) : $data;
                update_option($key, $final_data);
            }
        }
    }
}
