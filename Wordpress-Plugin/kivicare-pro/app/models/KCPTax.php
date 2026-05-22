<?php

namespace KCProApp\models;

use App\baseClasses\KCBaseModel;

defined('ABSPATH') or die('Something went wrong');

/**
 * Class KCPTax
 * 
 * @property int $id
 * @property string|null $module_type
 * @property int|null $module_id
 * @property string|null $name
 * @property string|null $charges
 * @property string|null $tax_value
 * @property string|null $tax_type
 */
class KCPTax extends KCBaseModel
{
    /**
     * Define table structure and properties
     */
    protected static function initSchema(): array
    {
        return [
            'table_name' => 'kc_taxes',
            'primary_key' => 'id',
            'columns' => [
                'id' => [
                    'column' => 'id',
                    'type' => 'bigint',
                    'nullable' => false,
                    'auto_increment' => true,
                ],
                'name' => [
                    'column' => 'name',
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
                'taxValue' => [
                    'column' => 'tax_value',
                    'type' => 'varchar',
                    'nullable' => true,
                    'sanitizers' => ['sanitize_text_field'],
                ],
                'clinicId' => [
                    'column' => 'clinic_id',
                    'type' => 'bigint',
                    'nullable' => true,
                ],
                'doctorId' => [
                    'column' => 'doctor_id',
                    'type' => 'bigint',
                    'nullable' => true,
                ],
                'serviceId' => [
                    'column' => 'service_id',
                    'type' => 'bigint',
                    'nullable' => true,
                ],
                'addedBy' => [
                    'column' => 'added_by',
                    'type' => 'bigint',
                    'nullable' => true,
                ],
                'status' => [
                    'column' => 'status',
                    'type' => 'tinyint',
                    'nullable' => true,
                ],
                'createdAt' => [
                    'column' => 'created_at',
                    'type' => 'datetime',
                    'nullable' => false,
                ],
            ],
            'timestamps' => false,
            'soft_deletes' => false,
        ];
    }
    public static function getTaxes($args): Object
    {
        $clinic_id = isset($args['clinicId']) ? (int)$args['clinicId'] : -1;
        $doctor_id = isset($args['doctorId']) ? (int)$args['doctorId'] : -1;
        $services = $args['services'] ?? [];

        // Normalize service ids
        $serviceIds = [];
        if (is_array($services) && !empty($services)) {
            foreach ($services as $s) {
                $serviceIds[] = (int)$s;
            }
            // ensure -1 is present to match generic taxes
            $serviceIds = array_unique(array_merge($serviceIds, [-1]));
        } else {
            $serviceIds = [-1];
        }

        // Query 1: clinic-level taxes
        $clinicTaxes = static::query()
            ->whereIn('clinic_id', [-1, $clinic_id])
            ->whereIn('doctor_id', [-1, $doctor_id])
            ->whereIn('service_id', $serviceIds)
            ->where('status', 1)
            ->get()
            ->toArray();

        // Query 2: doctor-level taxes (either global clinic or specific clinic+doctor)
        $doctorTaxes = static::query()
            ->where(function ($q) use ($clinic_id, $doctor_id) {
                $q->where(function ($q1) use ($doctor_id) {
                    $q1->where('clinic_id', -1)
                        ->whereIn('doctor_id', [-1, $doctor_id]);
                })
                ->orWhere(function ($q2) use ($clinic_id, $doctor_id) {
                    $q2->where('clinic_id', $clinic_id)
                        ->where('doctor_id', $doctor_id);
                });
            })
            ->whereIn('service_id', $serviceIds)
            ->where('status', 1)
            ->get()
            ->toArray();

        // Query 3: service-specific taxes
        $serviceTaxes = static::query()
            ->where(function ($q) use ($clinic_id, $doctor_id, $serviceIds) {
                $q->where(function ($q1) use ($clinic_id, $doctor_id, $serviceIds) {
                    $q1->whereIn('clinic_id', [-1, $clinic_id])
                        ->where('doctor_id', $doctor_id)
                        ->whereIn('service_id', $serviceIds);
                })
                ->orWhere(function ($q2) use ($serviceIds) {
                    $q2->where('clinic_id', -1)
                        ->where('doctor_id', -1)
                        ->whereIn('service_id', $serviceIds);
                });
            })
            ->where('status', 1)
            ->get()
            ->toArray();

        // Merge unique by id
        $all = collect(array_merge($clinicTaxes, $doctorTaxes, $serviceTaxes))->unique('id')->values();

        // Compute charges where possible
        $result = $all->map(function ($v) use ($args, $clinic_id, $doctor_id) {
            $v = (object) $v; // ensure object
            $v->tax_value = round((float)($v->tax_value ?? 0), 2);
            $v->charges = 0.0;

            $serviceId = isset($v->service_id) ? $v->service_id : -1;

            // If service-specific tax
            if (!in_array($serviceId, [-1, '-1'])) {
                // Encounter type: service_count expected
                if (isset($args['type']) && $args['type'] === 'encounter' && !empty($args['service_count'][$serviceId])) {
                    $v->charges = 0;
                    foreach ($args['service_count'][$serviceId] as $count_service) {
                        $price = floatval($count_service['price'] ?? 0);
                        if ($v->tax_type === 'percentage') {
                            $v->charges += ($v->tax_value / 100) * $price;
                        } else {
                            $v->charges += $v->tax_value;
                        }
                    }
                    if ($v->tax_type === 'percentage') {
                        $v->name .= "({$v->tax_value}%)";
                    }
                } else {
                    // Non-encounter: get service charge from mapping
                    $serviceCharge = 0;
                    $mapping = \App\models\KCServiceDoctorMapping::query()
                        ->where('id', (int)$serviceId)
                        ->where('doctor_id', $doctor_id)
                        ->where('clinic_id', $clinic_id)
                        ->first();
                    if ($mapping) {
                        $serviceCharge = floatval($mapping->charges ?? 0);
                    }
                    if ($v->tax_type === 'percentage') {
                        $v->name .= "({$v->tax_value}%)";
                        $v->charges = ($v->tax_value / 100) * $serviceCharge;
                    } else {
                        $v->charges = (float)$v->tax_value;
                    }
                }
            } else {
                // Generic tax (applies to total charge)
                $totalCharge = floatval($args['total_charge'] ?? 0);
                if ($v->tax_type === 'percentage') {
                    $v->name .= "({$v->tax_value}%)";
                    $v->charges = ($v->tax_value / 100) * $totalCharge;
                } else {
                    $v->charges = (float)$v->tax_value;
                }
            }

            $v->charges = round($v->charges, 2);
            return $v;
        })->toArray();

        // Combine taxes by name summing charges
        $grouped = collect($result)->groupBy('name')->map(function ($taxes) {
            $first = (object) $taxes->first();
            if ($taxes->count() > 1) {
                $first->charges = $taxes->sum('charges');
            }
            return $first;
        })->values();

        return $grouped;
    }
}
