<?php

namespace KCProApp\controllers\api;

use App\baseClasses\KCBaseController;
use App\models\KCEncounter;
use App\models\KCPatientEncounter;
use App\models\KCPrescription;
use App\models\KCMedicalHistory;
use App\models\KCCustomFieldData;
use App\models\KCCustomField;
use App\models\KCOption;
use App\baseClasses\KCErrorLogger;
use WP_REST_Request;
use WP_REST_Response;
use App\utils\KCPdfGenerator;

defined('ABSPATH') or die('Something went wrong');

class KCProPrintPrescriptionController extends KCBaseController
{
    protected $route = 'prescriptions';

    public function registerRoutes()
    {
        $this->registerRoute('/prescriptions/encounter/(?P<encounter_id>\d+)/print', [
            'methods' => 'GET',
            'callback' => [$this, 'print'],
            'permission_callback' => [$this, 'checkPrescriptionPrintPermission'],
            'args' => [
                'encounter_id' => [
                    'description' => __('Encounter ID', 'kivicare-pro'),
                    'type' => 'integer',
                    'required' => true,
                ],
            ]
        ]);
    }

    public function print(WP_REST_Request $request)
    {
        try {
            $encounter_id = $request->get_param('encounter_id');

            if (empty($encounter_id)) {
                return $this->response(false, __('Encounter ID is required', 'kivicare-pro'), 400);
            }

            $encounter = KCPatientEncounter::find($encounter_id);
            if (!$encounter) {
                return $this->response(false, __('Encounter not found', 'kivicare-pro'), 404);
            }

            $prescription_data = $this->prepare_printable_prescriptions($encounter);
            $html = $this->render_print_template($prescription_data);
            $filename = 'prescriptions_' . $encounter_id . '_' . current_time('timestamp') . '.pdf';
            return KCPdfGenerator::generate($html, $filename);

        } catch (\Exception $e) {
            return $this->response(false, $e->getMessage(), 500);
        }
    }



    private function prepare_printable_prescriptions(KCPatientEncounter $encounter): array
    {
        $patient = $encounter->getPatient();
        $patient_meta = json_decode($patient->getMeta('basic_data'));
        $doctor = $encounter->getDoctor();
        $clinic = $encounter->getClinic();
        $doctor_meta = $doctor ? json_decode($doctor->getMeta('basic_data')) : null;
        $clinicLogo = [
            'id'  => $clinic->clinicLogo,
            'url' => $clinic->clinicLogo ? wp_get_attachment_url($clinic->clinicLogo) : '',
        ];
        return [
            'encounter' => [
                'id' => $encounter->id,
                'encounter_date' => $encounter->encounterDate,
                'status' => $encounter->status,
            ],
            'patient' => $patient ? [
                'name' => $patient->display_name,
                'email' => $patient->email,
                'phone' => $patient_meta->mobile_number,
                'blood_group' => $patient_meta->blood_group,
                'gender' => $patient_meta->gender,
                'address' => $patient_meta->address,
            ] : null,
            'doctor' => $doctor ? [
                'name' => $doctor->display_name,
                'email' => $doctor->email,
                'signature' => $doctor->getMeta('doctor_signature'),
                'specialization' => $doctor_meta && !empty($doctor_meta->specialties) ? implode(', ', array_map(function($s) { return $s->label; }, $doctor_meta->specialties)) : '',
            ] : null,
            'clinic' => $clinic ? [
                'name' => $clinic->name,
                'address' => $clinic->address,
                'city' => $clinic->city,
                'country' => $clinic->country,
                'postal_code' => $clinic->postalCode,
                'phone' => $clinic->telephoneNo,
                'email' => $clinic->email,
                'profile_image' => $clinic->profileImage ? wp_get_attachment_url($clinic->profileImage) : '',
            ] : null,
            'prescriptions' => $this->get_prescriptions_for_encounter($encounter->id),
            'clinic_logo' => $clinicLogo,
            'clinical_details' => $this->get_clinical_details_for_encounter($encounter->id),
            'custom_fields' => $this->get_custom_fields_for_encounter($encounter->id),
        ];
    }

    private function get_prescriptions_for_encounter($encounterId): array
    {
        $prescriptions = KCPrescription::query()
            ->where('encounterId', '=', $encounterId)
            ->get();

        $result = [];
        foreach ($prescriptions as $prescription) {
            $result[] = [
                'name' => $prescription->name,
                'frequency' => $prescription->frequency,
                'duration' => $prescription->duration,
                'instruction' => $prescription->instruction,
            ];
        }

        return $result;
    }

    private function get_clinical_details_for_encounter($encounterId): array
    {
        $includeClinicalDetails = KCOption::get('include_clinical_detail_in_print', 'false');

        if ($includeClinicalDetails !== 'true') {
            return [];
        }

        $hideClinicalDetailsForPatient = KCOption::get('hide_clinical_detail_in_patient', 'false');
        $currentUser = wp_get_current_user();
        $isPatient = in_array('kiviCare_patient', $currentUser->roles);

        if ($hideClinicalDetailsForPatient === 'true' && $isPatient) {
            return [];
        }

        $clinicalDetails = [
            'problems'     => [],
            'observations' => [],
            'notes'        => []
        ];

        $problems = KCMedicalHistory::query()
            ->where('encounterId', '=', $encounterId)
            ->where('type', '=', 'problem')
            ->get();

        foreach ($problems as $problem) {
            $clinicalDetails['problems'][] = ['title' => $problem->title];
        }

        $observations = KCMedicalHistory::query()
            ->where('encounterId', '=', $encounterId)
            ->where('type', '=', 'observation')
            ->get();

        foreach ($observations as $observation) {
            $clinicalDetails['observations'][] = ['title' => $observation->title];
        }

        $notes = KCMedicalHistory::query()
            ->where('encounterId', '=', $encounterId)
            ->where('type', '=', 'note')
            ->get();

        foreach ($notes as $note) {
            $clinicalDetails['notes'][] = ['title' => $note->title];
        }

        return $clinicalDetails;
    }

    private function get_custom_fields_for_encounter($encounterId): array
    {
        $includeCustomFields = KCOption::get('include_encounter_custom_field_in_print', 'false');

        if ($includeCustomFields !== 'true') {
            return [];
        }

        $customFieldsData = KCCustomFieldData::query()
            ->where('moduleType', '=', 'patient_encounter_module')
            ->where('moduleId', '=', $encounterId)
            ->get();

        $fields = [];
        foreach ($customFieldsData as $fieldData) {
            $fieldsDataDecoded = json_decode($fieldData->fieldsData, true);

            if (is_array($fieldsDataDecoded)) {
                foreach ($fieldsDataDecoded as $field) {
                    if (isset($field['label']) && isset($field['value'])) {
                        $fields[] = [
                            'label' => $field['label'],
                            'value' => is_array($field['value']) ? implode(', ', $field['value']) : $field['value']
                        ];
                    }
                }
            } else {
                $customField = KCCustomField::find($fieldData->fieldId);
                if ($customField) {
                    $fieldConfig = is_string($customField->fields) ? json_decode($customField->fields, true) : $customField->fields;

                    if (isset($fieldConfig['label'])) {
                        $fields[] = [
                            'label' => $fieldConfig['label'],
                            'value' => $fieldData->fieldsData
                        ];
                    } elseif (is_array($fieldConfig) && !empty($fieldConfig)) {
                        $firstField = reset($fieldConfig);
                        if (isset($firstField['label'])) {
                            $fields[] = [
                                'label' => $firstField['label'],
                                'value' => $fieldData->fieldsData
                            ];
                        }
                    }
                }
            }
        }

        return $fields;
    }

    private function render_print_template($data): string
    {
        KCErrorLogger::instance()->error('prescription_data: ' . json_encode($data));
        $template_file = $this->get_template_file();

        if (!file_exists($template_file)) {
            throw new \Exception(__('Print template not found', 'kivicare-pro'));
        }

        ob_start();
        extract($data);
        include $template_file;
        return ob_get_clean();
    }

    private function get_template_file(): string
    {
        $child_theme_path = get_stylesheet_directory() . '/kivicare/KCPrescriptionPrintTemplate.php';
        if (file_exists($child_theme_path)) {
            return $child_theme_path;
        }

        $parent_theme_path = get_template_directory() . '/kivicare/KCPrescriptionPrintTemplate.php';
        if (file_exists($parent_theme_path)) {
            return $parent_theme_path;
        }

        return KIVI_CARE_PRO_DIR . '/templates/KCPrescriptionPrintTemplate.php';
    }

    public function checkPrescriptionPrintPermission(): bool
    {
        return $this->checkResourceAccess('prescription','view');
    }

}