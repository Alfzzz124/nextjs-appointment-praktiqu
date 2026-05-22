<?php

namespace KCProApp\controllers\api;

use App\baseClasses\KCBaseController;
use App\models\KCEncounter;
use App\models\KCPatientEncounter;
use App\models\KCMedicalHistory;
use App\models\KCPrescription;
use App\models\KCOption;
use App\models\KCCustomFieldData;
use App\models\KCCustomField;
use WP_REST_Request;
use WP_REST_Response;
use App\utils\KCPdfGenerator;

defined('ABSPATH') or die('Something went wrong');

class KCProPrintEncounterController extends KCBaseController
{
    protected $route = 'encounters';

    /**
     * Register routes for this controller
     */
    public function registerRoutes()
    {
        // Print encounter route
        $this->registerRoute('/' . $this->route . '/(?P<id>\d+)/print', [
            'methods' => 'GET',
            'callback' => [$this, 'print'],
            'permission_callback' => [$this, 'checkPermission'],
            'args' => [
                'id' => [
                    'description' => __('Encounter ID', 'kivicare-pro'),
                    'type' => 'integer',
                    'required' => true,
                ],
            ]
        ]);

    }

    /**
     * Generate PDF for encounter and return as file
     *
     * @param WP_REST_Request $request
     * @return void|WP_REST_Response
     */
    public function print(WP_REST_Request $request)
    {
        try {
            // Get encounter ID from request
            $encounter_id = $request->get_param('id');

            if (empty($encounter_id)) {
                return $this->response(
                    false,
                    __('Encounter ID is required', 'kivicare-pro'),
                    400
                );
            }

            // Fetch encounter data
            $encounter = KCPatientEncounter::find($encounter_id);

            if (!$encounter) {
                return $this->response(
                    false,
                    __('Encounter not found', 'kivicare-pro'),
                    404
                );
            }

            // Prepare encounter data for printing
            $encounter_data = $this->prepare_printable_encounter($encounter);

            // Generate HTML from template
            $html = $this->render_print_template($encounter_data);

            // Generate username and then PDF using KCPdfGenerator
            $filename = 'encounter_' . $encounter_id . '_' . current_time('timestamp') . '.pdf';
            return KCPdfGenerator::generate($html, $filename);

        } catch (\Exception $e) {
            return $this->response(
                false,
                $e->getMessage(),
                500
            );
        }
    }



    /**
     * Prepare encounter data for printing
     *
     * @param KCPatientEncounter $encounter
     * @return array
     */
    private function prepare_printable_encounter(KCPatientEncounter $encounter): array
    {
        // Get related data
        $patient = $encounter->getPatient();
        $patient_meta = json_decode($patient->getMeta('basic_data'));
        $doctor = $encounter->getDoctor();
        $doctor_meta = $doctor ? json_decode($doctor->getMeta('basic_data')) : null;
        $clinic = $encounter->getClinic();
        $clinicLogo = [
            'id'  => $clinic->clinicLogo,
            'url' => $clinic->clinicLogo ? wp_get_attachment_url($clinic->clinicLogo) : '',
        ];
        return [
            'encounter' => [
                'id' => $encounter->id,
                'encounter_date' => $encounter->encounterDate,
                'status' => $encounter->status,
                'status_text' => $this->get_status_text($encounter->status),
                'created_at' => $encounter->createdAt,
                'updated_at' => $encounter->updated_at,
            ],
            'patient' => $patient ? [
                'id' => $patient->id,
                'name' => $patient->display_name,
                'email' => $patient->email,
                'phone' => $patient_meta->mobile_number,
                'gender' => $patient_meta->gender,
                'dob' => $patient_meta->dob,
                'address' => $patient_meta->address,
                'city' => $patient_meta->city,
                'country' => $patient_meta->country,
                'postal_code' => $patient_meta->postal_code,
                'profile_image' => $patient->profile_image,
            ] : null,
            'doctor' => $doctor ? [
                'id' => $doctor->id,
                'name' => $doctor->display_name,
                'email' => $doctor->email,
                'signature' => $doctor->getMeta('doctor_signature'),
                'specialization' => $doctor_meta && !empty($doctor_meta->specialties) ? implode(', ', array_map(function($s) { return $s->label; }, $doctor_meta->specialties)) : '',
            ] : null,
            'clinic' => $clinic ? [
                'id' => $clinic->id,
                'name' => $clinic->name,
                'address' => $clinic->address,
                'city' => $clinic->city,
                'country' => $clinic->country,
                'postal_code' => $clinic->postalCode,
                'phone' => $clinic->telephoneNo,
                'email' => $clinic->email,
            ] : null,
            'clinic_logo' => $clinicLogo,
            // Medical history entries for this encounter
            'medical_history' => $this->get_medical_history_for_encounter($encounter->id),
            // Prescriptions for this encounter
            'prescriptions' => $this->get_prescriptions_for_encounter($encounter->id),
            // Custom fields for this encounter
            'custom_fields' => $this->get_custom_fields_for_encounter($encounter->id),
        ];
    }

    /**
     * Fetch medical history entries for an encounter, map to array, and group by type
     *
     * @param int $encounterId
     * @return array Grouped medical history by type
     */
    private function get_medical_history_for_encounter($encounterId): array
    {
        $histories = KCMedicalHistory::query()
            ->where('encounterId', '=', $encounterId)
            ->get();

        $grouped_history = [];
        foreach ($histories as $h) {
            $type = $h->type ?? 'Other';

            if (!isset($grouped_history[$type])) {
                $grouped_history[$type] = [];
            }

            $grouped_history[$type][] = [
                'id' => $h->id ?? '-',
                'type' => $h->type ?: '-',
                'title' => $h->title ?: '-',
                'added_by' => $h->addedBy ?: '-',
                'created_at' => $h->createdAt ?: '-',
                'is_from_template' => isset($h->isFromTemplate) ? $h->isFromTemplate : '-',
            ];
        }

        return $grouped_history;
    }

    /**
     * Fetch prescriptions for an encounter and map to array
     *
     * @param int $encounterId
     * @return array Prescriptions data
     */
    private function get_prescriptions_for_encounter($encounterId): array
    {
        $prescriptions = KCPrescription::query()
            ->where('encounterId', '=', $encounterId)
            ->get();

        $result = [];
        foreach ($prescriptions as $p) {
            $result[] = [
                'id'               => $p->id ?? '-',
                'name'             => $p->name ?: '-',
                'frequency'        => $p->frequency ?: '-',
                'duration'         => $p->duration ?: '-',
                'instruction'      => $p->instruction ?: '-',
                'added_by'         => $p->addedBy ?: '-',
                'created_at'       => $p->createdAt ?: '-',
                'is_from_template' => isset($p->isFromTemplate) ? $p->isFromTemplate : '-',
            ];
        }

        return $result;
    }

    /**
     * Render print template with encounter data
     *
     * @param array $data
     * @return string
     */
    private function render_print_template($data): string
    {
        // Check for child theme template first, then fall back to plugin template
        $template_file = $this->get_template_file();

        if (!file_exists($template_file)) {
            throw new \Exception(__('Print template not found', 'kivicare-pro'));
        }

        // Start output buffering
        ob_start();

        // Extract data into variables for template
        extract($data);

        // Include template
        include $template_file;

        // Get output and clean buffer
        $html = ob_get_clean();

        return $html;
    }

    /**
     * Get template file path - check child theme first
     *
     * @return string
     */
    private function get_template_file(): string
    {
        // Check child theme first
        $child_theme_path = get_stylesheet_directory() . '/kivicare/KCEncounterPrintTemplate.php';
        if (file_exists($child_theme_path)) {
            return $child_theme_path;
        }

        // Fall back to parent theme
        $parent_theme_path = get_template_directory() . '/kivicare/KCEncounterPrintTemplate.php';
        if (file_exists($parent_theme_path)) {
            return $parent_theme_path;
        }

        // Fall back to plugin template
        $plugin_path = KIVI_CARE_PRO_DIR . '/templates/KCEncounterPrintTemplate.php';
        return $plugin_path;
    }

    /**
     * Generate PDF from HTML
     *
     * @param string $html
     * @param int $encounter_id
     * @return string PDF file path
     */
    private function generate_pdf($html, $encounter_id): string
    {
        // Create uploads directory if not exists
        $upload_dir = wp_upload_dir();
        $pdf_dir = $upload_dir['basedir'] . '/kivicare-encounters/';

        if (!is_dir($pdf_dir)) {
            wp_mkdir_p($pdf_dir);
        }

        // Generate PDF file name
        $timestamp = current_time('timestamp');
        $pdf_filename = 'encounter_' . $encounter_id . '_' . $timestamp . '.pdf';
        $pdf_path = $pdf_dir . $pdf_filename;

        // Generate and save PDF
        KCPdfGenerator::generate($html, $pdf_path, 'F');

        return $pdf_path;
    }

    /**
     * Get PDF URL from file path
     *
     * @param string $pdf_path
     * @return string PDF URL
     */
    private function get_pdf_url($pdf_path): string
    {
        $upload_dir = wp_upload_dir();
        $pdf_filename = basename($pdf_path);

        return $upload_dir['baseurl'] . '/kivicare-encounters/' . $pdf_filename;
    }

    /**
     * Convert status code to readable text
     *
     * @param int $status Status code (1 = Open, 0 = Closed)
     * @return string Status text
     */
    private function get_status_text($status): string
    {
        return $status == 1 ? __('Open', 'kivicare-pro') : __('Closed', 'kivicare-pro');
    }

    /**
     * Fetch custom fields for an encounter
     *
     * @param int $encounterId
     * @return array Custom fields data
     */
    private function get_custom_fields_for_encounter($encounterId): array
    {
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
}