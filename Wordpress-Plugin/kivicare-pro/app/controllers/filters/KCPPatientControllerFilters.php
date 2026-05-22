<?php

namespace KCProApp\controllers\filters;

use App\controllers\api\PatientController;
use KCProApp\models\KCCustomFormData;
use WP_REST_Request;

if (!defined('ABSPATH')) {
    exit; // Exit if accessed directly
}

class KCPPatientControllerFilters
{
    /**
     * Override the parent method to add custom functionality
     */
    private static ?KCPPatientControllerFilters $instance = null;

    public function __construct()
    {
        // Add custom form data to patient create/update endpoint args
        add_filter('kc_patient_create_endpoint_args', [$this, 'addCustomFormArgs'], 10, 1);
        add_filter('kc_patient_update_endpoint_args', [$this, 'addCustomFormArgs'], 10, 1);

        // Save custom form data on patient create/update
        add_action('kc_patient_save', [$this, 'saveCustomFormData'], 10, 2);
        add_action('kc_patient_update', [$this, 'saveCustomFormData'], 10, 2);
    }

    public static function get_instance(): KCPPatientControllerFilters|null {
        if (!isset(self::$instance)) {
            self::$instance = new self();
        }
        return self::$instance;
    }

    /**
     * Add custom form data argument to patient create/update endpoints
     *
     * @param array $args The current endpoint arguments
     * @return array Modified arguments with customForm support
     */
    public function addCustomFormArgs($args)
    {
        $args['customForm'] = [
            'description' => 'Custom form data for patient',
            'type' => 'object',
            'validate_callback' => function ($param) {
                // Validate that customForm is an object with form IDs as keys
                if (!is_array($param) && !is_object($param)) {
                    return false;
                }

                // Convert to array if it's an object
                $formData = is_object($param) ? (array) $param : $param;

                // Validate each form entry
                foreach ($formData as $formId => $formFields) {
                    // Form ID should be numeric
                    if (!is_numeric($formId)) {
                        return false;
                    }

                    // Form fields should be an array/object
                    if (!is_array($formFields) && !is_object($formFields)) {
                        return false;
                    }
                }

                return true;
            },
                'sanitize_callback' => function ($param) {
                    // Ensure the data is properly sanitized
                    if (!is_array($param) && !is_object($param)) {
                        return [];
                    }

                    $sanitize_recursive = function ($data) use (&$sanitize_recursive) {
                        $sanitized = [];
                        foreach ($data as $key => $value) {
                            // Sanitize field keys
                            $sanitizedKey = sanitize_text_field($key);

                            if (is_array($value) || is_object($value)) {
                                // Recursively sanitize arrays/objects
                                $sanitized[$sanitizedKey] = $sanitize_recursive((array) $value);
                            } elseif (is_string($value)) {
                                // Sanitize strings
                                if($key === 'url' || $key === 'link'){
                                    $sanitized[$sanitizedKey] = esc_url_raw($value);
                                }else{
                                    $sanitized[$sanitizedKey] = sanitize_text_field($value);
                                }
                            } elseif (is_bool($value) || is_numeric($value) || is_null($value)) {
                                // Keep booleans, numbers, and nulls as is
                                $sanitized[$sanitizedKey] = $value;
                            } else {
                                // For other types, convert to string and sanitize
                                $sanitized[$sanitizedKey] = sanitize_text_field((string) $value);
                            }
                        }
                        return $sanitized;
                    };

                    $formData = is_object($param) ? (array) $param : $param;
                    $sanitized = [];
                    foreach ($formData as $formId => $formFields) {
                        $sanitized[$formId] = $sanitize_recursive((array) $formFields);
                    }

                    return $sanitized;
                },
        ];

        return $args;
    }

    /**
     * Save custom form data for patient
     *
     * @param array $patientData The patient data
     * @param WP_REST_Request $request The request object
     */
    public function saveCustomFormData($patientData, WP_REST_Request $request)
    {
        // Check if custom form data exists in the request
        $customFormData = $request->get_param('customForm');
        if (empty($customFormData)) {
            return;
        }

        // Ensure it's an array
        if (!is_array($customFormData)) {
            return;
        }

        // Save each form's data
        foreach ($customFormData as $formId => $formFields) {
            // Validate form ID is numeric
            if (!is_numeric($formId)) {
                continue;
            }

            // Ensure form fields is an array
            if (!is_array($formFields)) {
                continue;
            }

            // Check if record already exists for this form and patient
            $existingRecord = KCCustomFormData::query()
                ->where('form_id', (int) $formId)
                ->where('module_id', (int) $patientData['id'])
                ->first();

            if ($existingRecord) {
                // Update existing record
                $existingRecord->formData = wp_json_encode($formFields);
                $existingRecord->save();
            } else {
                // Create new record
                $customFormEntry = new KCCustomFormData();
                $customFormEntry->formId = (int) $formId;
                $customFormEntry->formData = wp_json_encode($formFields);
                $customFormEntry->moduleId = (int) $patientData['id'];
                $customFormEntry->save();
            }
        }
    }
}
