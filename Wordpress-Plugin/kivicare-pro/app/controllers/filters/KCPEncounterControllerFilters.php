<?php

namespace KCProApp\controllers\filters;

use KCProApp\models\KCPTaxData;
use App\models\KCPatientEncounter;
use App\models\KCDoctor;
use KCProApp\models\KCProFollowup;

if (!defined('ABSPATH')) {
    exit; // Exit if accessed directly
}

class KCPEncounterControllerFilters
{
    private static ?KCPEncounterControllerFilters $instance = null;

    public function __construct()
    {
        // Hook to delete tax data before deleting encounter
        add_action('kc_before_delete_encounter', [$this, 'deleteTaxData'], 10, 1);
        add_filter('kc_encounter_data', [$this, 'addPreviousEncounterData'], 10, 2);
    }

    public static function get_instance(): KCPEncounterControllerFilters|null
    {
        if (!isset(self::$instance)) {
            self::$instance = new self();
        }
        return self::$instance;
    }

    /**
     * Delete tax data related to the encounter
     *
     * @param int $encounterId The encounter ID
     * @return void
     */
    public function deleteTaxData($encounterId)
    {
        // Delete tax data where module_type is 'encounter' and module_id is the encounter ID
        KCPTaxData::query()
            ->where('moduleType', 'encounter')
            ->where('moduleId', $encounterId)
            ->delete();
    }

    /**
     * Add previous encounter data to encounter response.
     *
     * @param array $result
     * @param object $encounter
     * @return array
     */
    public function addPreviousEncounterData($result, $encounter)
    {
        $prevEncounter = null;

        if (!empty($encounter->appointmentId) && class_exists(KCProFollowup::class)) {
            // Try chain-based lookup first
            $prevEncounter = KCPatientEncounter::table('pe')
                ->select([
                    'pe.id',
                    'pe.encounter_date',
                    'd2.display_name as doctor_name',
                    'pe.status',
                ])
                ->leftJoin(KCDoctor::class, 'pe.doctor_id', '=', 'd2.id', 'd2')
                ->join(KCProFollowup::class, 'pe.id', '=', 'f.encounter_id', 'f')
                ->where('f.scheduled_appointment_id', $encounter->appointmentId)
                ->orderBy('pe.id', 'DESC')
                ->first();
        }

        if (!$prevEncounter) {
            // Fallback: most recent earlier encounter for the same patient
            $prevEncounter = KCPatientEncounter::table('pe')
                ->select([
                    'pe.id',
                    'pe.encounter_date',
                    'd2.display_name as doctor_name',
                    'pe.status',
                ])
                ->leftJoin(KCDoctor::class, 'pe.doctor_id', '=', 'd2.id', 'd2')
                ->where('pe.patient_id', $encounter->patientId)
                ->where('pe.id', '<', $encounter->id)
                ->orderBy('pe.id', 'DESC')
                ->first();
        }

        $result['previousEncounter'] = $prevEncounter ? [
            'id'             => (int) $prevEncounter->id,
            'encounterDate'  => kcGetFormatedDate($prevEncounter->encounterDate),
            'doctorName'     => $prevEncounter->doctor_name ?? '',
            'status'         => (int) $prevEncounter->status,
            'viaChain'       => !empty($encounter->appointmentId),
        ] : null;

        return $result;
    }
}