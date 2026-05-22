<?php

namespace KCProApp\models;

use App\baseClasses\KCBaseModel;
use App\models\KCPatientEncounter;

defined('ABSPATH') or die('Something went wrong');

/**
 * Class KCPTaxData
 *
 * @property int $id
 * @property string|null $module_type
 * @property int|null $module_id
 * @property string|null $name
 * @property string|null $charges
 * @property string|null $tax_value
 * @property string|null $tax_type
 */
class KCPTaxData extends KCBaseModel
{
    /**
     * Define table structure and properties
     */
    protected static function initSchema(): array
    {
        return [
            'table_name' => 'kc_tax_data',
            'primary_key' => 'id',
            'columns' => [
                'id' => [
                    'column' => 'id',
                    'type' => 'bigint',
                    'nullable' => false,
                    'auto_increment' => true,
                ],
                'moduleType' => [
                    'column' => 'module_type',
                    'type' => 'varchar',
                    'nullable' => true,
                    'sanitizers' => ['sanitize_text_field'],
                ],
                'moduleId' => [
                    'column' => 'module_id',
                    'type' => 'bigint',
                    'nullable' => true,
                ],
                'name' => [
                    'column' => 'name',
                    'type' => 'varchar',
                    'nullable' => true,
                    'sanitizers' => ['sanitize_text_field'],
                ],
                'charges' => [
                    'column' => 'charges',
                    'type' => 'varchar',
                    'nullable' => true,
                    'sanitizers' => ['sanitize_text_field'],
                ],
                'taxValue' => [
                    'column' => 'tax_value',
                    'type' => 'varchar',
                    'nullable' => true,
                    'sanitizers' => ['sanitize_text_field'],
                ],
                'taxType' => [
                    'column' => 'tax_type',
                    'type' => 'varchar',
                    'nullable' => true,
                    'sanitizers' => ['sanitize_text_field'],
                ],
            ],
            'timestamps'   => false,
            'soft_deletes' => false,
        ];
    } 

    public static function get_tax($data){
        if ($data['module_type'] == 'encounter') {

            // Get the appointment_id as a scalar value
            $appointment = KCPatientEncounter::query()
                ->where('id', $data['module_id'])
                ->select(['appointment_id'])
                ->first();
            $appointment_id = $appointment ? $appointment->appointmentId : null;

            // Get taxes for encounter
            $encounterTaxes = self::get_by([
                'module_id' => $data['module_id'],
                'module_type' => $data['module_type']
            ]);

            // Get taxes for appointment if appointment_id exists
            $appointmentTaxes = [];
            if ($appointment_id) {
                $appointmentTaxes = self::get_by([
                    'module_id' => $appointment_id,
                    'module_type' => 'appointment'
                ]);
            }
            if(count($encounterTaxes) > 0 && count($appointmentTaxes) > 0){
                $appointmentTaxes = [];
            }

            // Merge both collections and return unique by 'name'
            return collect($encounterTaxes)
                ->merge($appointmentTaxes)
                ->values()
                ->toArray();
        }

        return self::get_by([
            'module_id' => $data['module_id'],
            'module_type' => $data['module_type']
        ]);
    }

    public static function get_by($data){
        // Corrected the where clauses
        return static::query()
            ->where('module_id', $data['module_id'])
            ->where('module_type', $data['module_type'])
            ->get();
    }
}