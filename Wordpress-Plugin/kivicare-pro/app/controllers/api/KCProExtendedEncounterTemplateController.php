<?php

namespace KCProApp\controllers\api;

use App\baseClasses\KCBase;
use App\baseClasses\KCBaseController;
use App\models\KCClinic;
use App\models\KCDoctorClinicMapping;
use App\models\KCPatientEncounter;
use App\models\KCMedicalHistory;
use App\models\KCPrescription;
use KCProApp\models\KCPatientEncountersTemplateMapping;
use KCProApp\models\KCPatientEncountersTemplate;
use KCProApp\models\KCPrescriptionEncounterTemplate;
use App\models\KCCustomFieldData;


defined('ABSPATH') or die('Something went wrong');

class KCProExtendedEncounterTemplateController extends KCBaseController
{
    /**
     * @var string The base route for this controller
     */
    protected $route = 'encounter-templates';

    /**
     * Register routes for this controller
     */
    public function registerRoutes()
    {
        // Get all encounter templates
        $this->registerRoute('/' . $this->route . '', [
            'methods' => 'GET',
            'callback' => [$this, 'getEncounterTemplates'],
            'permission_callback' => [$this, 'checkPermission'],
            'args' => [
                'search' => [
                    'description' => 'Search term for template name',
                    'type' => 'string',
                    'required' => false,
                    'sanitize_callback' => 'sanitize_text_field',
                ],
                'perPage' => [
                    'description' => 'Number of items per page',
                    'type' => 'integer',
                    'required' => false,
                    'default' => 10,
                    'sanitize_callback' => 'absint',
                    'validate_callback' => function ($param) {
                        return $param > 0;
                    },
                ],
                'page' => [
                    'description' => 'Page number',
                    'type' => 'integer',
                    'required' => false,
                    'default' => 1,
                    'sanitize_callback' => 'absint',
                    'validate_callback' => function ($param) {
                        return $param > 0;
                    },
                ],
                'columnFilters' => [
                    'description' => 'Column filters',
                    'type' => 'string',
                    'required' => false,
                    'sanitize_callback' => 'sanitize_text_field',
                ],
                'sort' => [
                    'description' => 'Sorting parameters',
                    'type' => 'array',
                    'required' => false,
                ],
                'encounter_id' => [
                    'description' => 'Encounter ID for default template',
                    'type' => 'integer',
                    'required' => false,
                    'sanitize_callback' => 'absint',
                ],
            ],
        ]);

        // Get single encounter template by ID
        $this->registerRoute('/' . $this->route . '/(?P<id>\d+)', [
            'methods' => 'GET',
            'callback' => [$this, 'getEncounterTemplate'],
            'permission_callback' => [$this, 'checkPermission'],
            'args' => [
                'id' => [
                    'description' => 'Encounter Template ID',
                    'type' => 'integer',
                    'required' => true,
                    'sanitize_callback' => 'absint',
                    'validate_callback' => function ($param) {
                        return is_numeric($param) && $param > 0;
                    },
                ],
            ],
        ]);

        // Create template
        $this->registerRoute('/' . $this->route, [
            'methods' => 'POST',
            'callback' => [$this, 'createEncounterTemplate'],
            'permission_callback' => [$this, 'checkCreatePermission'],
            'args' => [
                'name' => [
                    'description' => 'Encounter Template Name',
                    'type' => 'string',
                    'required' => true,
                    'sanitize_callback' => 'sanitize_text_field',
                    'validate_callback' => function ($param) {
                        return !empty($param);
                    },
                ],
                'status' => [
                    'description' => 'Template Status',
                    'type' => 'integer',
                    'required' => false,
                    'default' => 1,
                    'sanitize_callback' => 'absint',
                    'validate_callback' => function ($param) {
                        return in_array($param, [0, 1]);
                    },
                ],
            ],
        ]);

        // Update template
        $this->registerRoute('/' . $this->route . '/(?P<id>\d+)', [
            'methods' => 'PUT',
            'callback' => [$this, 'updateEncounterTemplate'],
            'permission_callback' => [$this, 'checkCreatePermission'],
            'args' => [
                'id' => [
                    'description' => 'Encounter Template ID',
                    'type' => 'integer',
                    'required' => true,
                    'sanitize_callback' => 'absint',
                    'validate_callback' => function ($param) {
                        return is_numeric($param) && $param > 0;
                    },
                ],
                'name' => [
                    'description' => 'Encounter Template Name',
                    'type' => 'string',
                    'required' => false,
                    'sanitize_callback' => 'sanitize_text_field',
                    'validate_callback' => function ($param) {
                        return !empty($param);
                    },
                ],
                'status' => [
                    'description' => 'Template Status',
                    'type' => 'integer',
                    'required' => false,
                    'sanitize_callback' => 'absint',
                    'validate_callback' => function ($param) {
                        return in_array($param, [0, 1]);
                    },
                ],
            ],
        ]);

        // Delete template
        $this->registerRoute('/' . $this->route . '/(?P<id>\d+)', [
            'methods' => 'DELETE',
            'callback' => [$this, 'deleteEncounterTemplate'],
            'permission_callback' => [$this, 'checkDeletePermission'],
        ]);

        $this->registerRoute('/' . $this->route . '/bulk/delete', [
            'methods' => 'POST',
            'callback' => [$this, 'deleteBulkEncounterTemplate'],
            'permission_callback' => [$this, 'checkDeletePermission'],
        ]);

        // Save encounter template medical history
        $this->registerRoute('/' . $this->route . '/(?P<id>\d+)/medical-history', [
            'methods' => 'POST',
            'callback' => [$this, 'saveEncounterTemplateMedicalHistory'],
            'permission_callback' => [$this, 'checkTemplateEditPermission'],
            'args' => [
                'id' => [
                    'description' => 'Encounter Template ID',
                    'type' => 'integer',
                    'required' => true,
                    'sanitize_callback' => 'absint',
                    'validate_callback' => function ($param) {
                        return is_numeric($param) && $param > 0;
                    },
                ],
                'template_id' => [
                    'description' => 'Template ID',
                    'type' => 'integer',
                    'required' => true,
                    'sanitize_callback' => 'absint',
                    'validate_callback' => function ($param) {
                        return is_numeric($param) && $param > 0;
                    },
                ],
                'type' => [
                    'description' => 'Clinical Detail Type',
                    'type' => 'string',
                    'required' => true,
                    'sanitize_callback' => 'sanitize_text_field',
                    'validate_callback' => function ($param) {
                        return !empty($param);
                    },
                ],
                'title' => [
                    'description' => 'Clinical Detail Title',
                    'type' => 'string',
                    'required' => true,
                    'sanitize_callback' => 'sanitize_text_field',
                    'validate_callback' => function ($param) {
                        return !empty($param);
                    },
                ],
            ],
        ]);

        // Get all medical history items for a template
        $this->registerRoute('/' . $this->route . '/(?P<id>\d+)/medical-history', [
            'methods' => 'GET',
            'callback' => [$this, 'getEncounterTemplateMedicalHistory'],
            'permission_callback' => [$this, 'checkPermission'],
            'args' => [
                'id' => [
                    'description' => 'Encounter Template ID',
                    'type' => 'integer',
                    'required' => true,
                    'sanitize_callback' => 'absint',
                    'validate_callback' => function ($param) {
                        return is_numeric($param) && $param > 0;
                    },
                ],
                'type' => [
                    'description' => 'Clinical Detail Type Filter',
                    'type' => 'string',
                    'required' => false,
                    'sanitize_callback' => 'sanitize_text_field',
                ],
            ],
        ]);


        // Delete medical history item
        $this->registerRoute('/' . $this->route . '/(?P<id>\d+)/medical-history/(?P<item_id>\d+)', [
            'methods' => 'DELETE',
            'callback' => [$this, 'deleteEncounterTemplateMedicalHistoryItem'],
            'permission_callback' => [$this, 'checkTemplateEditPermission'],
            'args' => [
                'id' => [
                    'description' => 'Encounter Template ID',
                    'type' => 'integer',
                    'required' => true,
                    'sanitize_callback' => 'absint',
                    'validate_callback' => function ($param) {
                        return is_numeric($param) && $param > 0;
                    },
                ],
                'item_id' => [
                    'description' => 'Medical History Item ID',
                    'type' => 'integer',
                    'required' => true,
                    'sanitize_callback' => 'absint',
                    'validate_callback' => function ($param) {
                        return is_numeric($param) && $param > 0;
                    },
                ],
            ],
        ]);

        // Save encounter template prescription
        $this->registerRoute('/' . $this->route . '/(?P<id>\d+)/prescriptions', [
            'methods' => 'POST',
            'callback' => [$this, 'saveEncounterTemplatePrescription'],
            'permission_callback' => [$this, 'checkTemplateEditPermission'],
            'args' => [
                'id' => [
                    'description' => 'Encounter Template ID',
                    'type' => 'integer',
                    'required' => true,
                    'sanitize_callback' => 'absint',
                    'validate_callback' => function ($param) {
                        return is_numeric($param) && $param > 0;
                    },
                ],
                'name' => [
                    'description' => 'Prescription Name',
                    'type' => 'string',
                    'required' => true,
                    'sanitize_callback' => 'sanitize_text_field',
                    'validate_callback' => function ($param) {
                        return !empty($param);
                    },
                ],
                'frequency' => [
                    'description' => 'Prescription Frequency',
                    'type' => 'string',
                    'required' => true,
                    'sanitize_callback' => 'sanitize_text_field',
                    'validate_callback' => function ($param) {
                        return !empty($param);
                    },
                ],
                'duration' => [
                    'description' => 'Prescription Duration',
                    'type' => 'string',
                    'required' => true,
                    'sanitize_callback' => 'sanitize_text_field',
                    'validate_callback' => function ($param) {
                        return !empty($param);
                    },
                ],
                'instruction' => [
                    'description' => 'Prescription Instruction',
                    'type' => 'string',
                    'required' => false,
                    'sanitize_callback' => 'sanitize_text_field',
                ],
            ],
        ]);

        // Get all prescriptions for an encounter template
        $this->registerRoute('/' . $this->route . '/(?P<id>\d+)/prescriptions', [
            'methods' => 'GET',
            'callback' => [$this, 'getEncounterTemplatePrescriptions'],
            'permission_callback' => [$this, 'checkPermission'],
            'args' => [
                'id' => [
                    'description' => 'Encounter Template ID',
                    'type' => 'integer',
                    'required' => true,
                    'sanitize_callback' => 'absint',
                    'validate_callback' => function ($param) {
                        return is_numeric($param) && $param > 0;
                    },
                ],
            ],
        ]);

        // Delete prescription item
        $this->registerRoute('/' . $this->route . '/(?P<id>\d+)/prescriptions/(?P<item_id>\d+)', [
            'methods' => 'DELETE',
            'callback' => [$this, 'deleteEncounterTemplatePrescriptionItem'],
            'permission_callback' => [$this, 'checkTemplateEditPermission'],
            'args' => [
                'id' => [
                    'description' => 'Encounter Template ID',
                    'type' => 'integer',
                    'required' => true,
                    'sanitize_callback' => 'absint',
                    'validate_callback' => function ($param) {
                        return is_numeric($param) && $param > 0;
                    },
                ],
                'item_id' => [
                    'description' => 'Prescription Item ID',
                    'type' => 'integer',
                    'required' => true,
                    'sanitize_callback' => 'absint',
                    'validate_callback' => function ($param) {
                        return is_numeric($param) && $param > 0;
                    },
                ],
            ],
        ]);

        // Apply template to encounter
        $this->registerRoute('/' . $this->route . '/(?P<id>\d+)/apply-to-encounter/(?P<encounter_id>\d+)', [
            'methods' => 'POST',
            'callback' => [$this, 'applyTemplateToEncounter'],
            'permission_callback' => [$this, 'checkApplyTemplatePermission'],
            'args' => [
                'id' => [
                    'description' => 'Encounter Template ID',
                    'type' => 'integer',
                    'required' => true,
                    'sanitize_callback' => 'absint',
                    'validate_callback' => function ($param) {
                        return is_numeric($param) && $param > 0;
                    },
                ],
                'encounter_id' => [
                    'description' => 'Encounter ID',
                    'type' => 'integer',
                    'required' => true,
                    'sanitize_callback' => 'absint',
                    'validate_callback' => function ($param) {
                        return is_numeric($param) && $param > 0;
                    },
                ],
            ],
        ]);


    }

    public function checkPermission($request)
    {
        if (!$this->checkCapability('read')) {
            return false;
        }

        return $this->checkResourceAccess('encounters_template', 'view');
    }

    public function checkCreatePermission($request)
    {
        if (!$this->checkCapability('read')) {
            return false;
        }

        return $this->checkResourceAccess('encounters_template', 'add');
    }

    public function checkDeletePermission($request)
    {

        if (!$this->checkCapability('read')) {
            return false;
        }

        // Basic resource access check
        if (!$this->checkResourceAccess('encounters_template', 'delete')) {
            return false;
        }

        // Advanced permission logic for specific template access
        $kcbase = KCBase::get_instance();
        $current_user_id = get_current_user_id();
        $current_user_role = $kcbase->getLoginUserRole();

        // Administrators can delete any template
        if ($current_user_role === 'administrator') {
            return true;
        }

        // Get template ID(s) to check
        $template_ids = [];

        // Single delete - get ID from URL parameter
        $single_id = $request->get_param('id');
        if (!empty($single_id)) {
            $template_ids[] = (int) $single_id;
        }

        // Bulk delete - get IDs from request body
        $bulk_ids = $request->get_param('ids');
        if (!empty($bulk_ids)) {
            if (is_string($bulk_ids)) {
                $bulk_ids = explode(',', $bulk_ids);
            }
            if (is_array($bulk_ids)) {
                $template_ids = array_merge($template_ids, array_map('intval', $bulk_ids));
            }
        }

        // If no template IDs to check, deny access
        if (empty($template_ids)) {
            return false;
        }

        // Check if user has permission to delete these specific templates
        $allowed_user_ids = $this->getAllowedUserIdsForDelete($current_user_role, $current_user_id);

        // Get templates and check if user can delete them
        $templates = KCPatientEncountersTemplateMapping::query()
            ->whereIn('id', $template_ids)
            ->get();

        foreach ($templates as $template) {
            if (!in_array($template->addedBy, $allowed_user_ids)) {
                return false; // User cannot delete this template
            }
        }

        return true;
    }

    public function checkMedicalHistoryPermission($request)
    {
        // Check permission to add medical records
        if (!$this->checkCapability('medical_records_add')) {
            return false;
        }

        $template_id = (int) $request->get_param('id');

        // Check if template exists
        $template = KCPatientEncountersTemplateMapping::find($template_id);
        if (!$template) {
            return new \WP_Error(
                'kc_template_not_found',
                __('Encounter template not found.', 'kivicare-pro'),
                ['status' => 404]
            );
        }

        // Check user permissions for this template
        $current_user_id = get_current_user_id();
        $kcbase = KCBase::get_instance();
        $is_admin = ($kcbase->getLoginUserRole() === 'administrator');

        if (!$is_admin && $template->addedBy != $current_user_id) {
            return false;
        }

        return true;
    }

    public function checkTemplateEditPermission($request)
    {
        return $this->checkResourceAccess('encounters_template', 'edit');
    }

    public function checkApplyTemplatePermission($request)
    {
        // Check basic permission to modify encounters
        if (!$this->checkCapability('patient_encounter_edit')) {
            return false;
        }

        $template_id = (int) $request->get_param('id');
        $encounter_id = (int) $request->get_param('encounter_id');

        // Check if template exists
        $template = KCPatientEncountersTemplateMapping::find($template_id);
        if (!$template) {
            return new \WP_Error(
                'kc_template_not_found',
                __('Encounter template not found.', 'kivicare-pro'),
                ['status' => 404]
            );
        }

        // Check if encounter exists
        $encounter = KCPatientEncounter::find($encounter_id);
        if (!$encounter) {
            return new \WP_Error(
                'kc_encounter_not_found',
                __('Encounter not found.', 'kivicare-pro'),
                ['status' => 404]
            );
        }

        // Check user permissions for this encounter
        $current_user_id = get_current_user_id();
        $kcbase = KCBase::get_instance();
        $current_user_role = $kcbase->getLoginUserRole();

        // Admin can apply templates to any encounter
        if ($current_user_role === 'administrator') {
            return true;
        }

        // Check if user has access to this encounter based on their role
        if (in_array($current_user_role, [$kcbase->getReceptionistRole(), $kcbase->getClinicAdminRole()])) {
            // Receptionist and Clinic Admin can modify encounters from their clinic's doctors
            $clinic_id = $current_user_role == $kcbase->getReceptionistRole() ?
                KCClinic::getClinicIdOfReceptionist() : KCClinic::getClinicIdOfClinicAdmin();

            // Check if encounter belongs to a doctor in their clinic
            $doctor_mappings = KCDoctorClinicMapping::query()
                ->where('clinicId', $clinic_id)
                ->where('doctorId', $encounter->doctorId)
                ->first();

            if (!$doctor_mappings) {
                return false;
            }
        } elseif ($current_user_role == $kcbase->getDoctorRole()) {
            // Doctor can only modify their own encounters
            if ($encounter->doctorId != $current_user_id) {
                return false;
            }
        } else {
            // Other roles cannot modify encounters
            return false;
        }

        return true;
    }

    /**
     * Get allowed user IDs for delete operation based on user role
     * 
     * @param string $user_role
     * @param int $current_user_id
     * @return array
     */
    private function getAllowedUserIdsForDelete($user_role, $current_user_id)
    {
        $kcbase = KCBase::get_instance();
        $allowed_ids = [$current_user_id]; // User can always delete their own templates

        if (in_array($user_role, [$kcbase->getReceptionistRole(), $kcbase->getClinicAdminRole()])) {
            // Receptionist and Clinic Admin can delete templates from their clinic's doctors + admin templates
            $clinic_id = $user_role == $kcbase->getReceptionistRole() ?
                KCClinic::getClinicIdOfReceptionist() : KCClinic::getClinicIdOfClinicAdmin();

            // Get doctor IDs from the clinic using KiviCare model
            $doctor_mappings = KCDoctorClinicMapping::query()
                ->where('clinicId', $clinic_id)
                ->get();

            $doctor_ids = $doctor_mappings->pluck('doctorId')->toArray();
            
            // Get admin user IDs
            $admin_users = get_users(array(
                'role' => 'administrator',
                'fields' => 'ID',
            ));
            $admin_ids = array_map('intval', $admin_users);
            
            $allowed_ids = array_merge($allowed_ids, $doctor_ids, $admin_ids);
            error_log(print_r($allowed_ids, true));
        } elseif ($user_role == $kcbase->getDoctorRole()) {
            // Doctor can delete admin templates + their own templates
            $admin_users = get_users(array(
                'role' => 'administrator',
                'fields' => 'ID',
            ));
            $admin_ids = array_map('intval', $admin_users);
            $allowed_ids = array_merge($allowed_ids, $admin_ids);
        }

        return array_unique($allowed_ids);
    }

    /**
     * Create a new encounter template
     * 
     * @param \WP_REST_Request $request
     * @return \WP_REST_Response|\WP_Error
     */
    public function createEncounterTemplate($request)
    {
        try {
            $params = $request->get_params();

            // Get current user ID
            $current_user_id = get_current_user_id();

            // Prepare data for creating encounter template
            $template_data = [
                'encountersTemplateName' => sanitize_text_field($params['name']),
                'status' => isset($params['status']) ? (int) $params['status'] : 1,
                'addedBy' => $current_user_id,
                'createdAt' => current_time('mysql'),
            ];


            // Create the encounter template
            $template_id = KCPatientEncountersTemplateMapping::create($template_data);

            if (is_wp_error($template_id)) {
                return new \WP_Error(
                    'kc_template_creation_failed',
                    __('Failed to create encounter template.', 'kivicare-pro'),
                    ['status' => 500, 'error' => $template_id->get_error_message()]
                );
            }

            // Get the created template
            $created_template = KCPatientEncountersTemplateMapping::find($template_id);

            if (!$created_template) {
                return new \WP_Error(
                    'kc_template_not_found',
                    __('Created template not found.', 'kivicare-pro'),
                    ['status' => 404]
                );
            }

            // Prepare response data
            $response_data = [
                'id' => $created_template->id,
                'encountersTemplateName' => $created_template->encountersTemplateName,
                'status' => $created_template->status,
                'addedBy' => $created_template->addedBy,
                'createdAt' => $created_template->createdAt,
            ];

            return $this->response($response_data, __('Encounter template created successfully.', 'kivicare-pro'));
        } catch (\Exception $e) {
            return new \WP_Error(
                'kc_template_creation_exception',
                __('An error occurred while creating the encounter template.', 'kivicare-pro'),
                ['status' => 500, 'error' => $e->getMessage()]
            );
        }
    }

    /**
     * Update an existing encounter template
     * 
     * @param \WP_REST_Request $request
     * @return \WP_REST_Response|\WP_Error
     */
    public function updateEncounterTemplate($request)
    {
        try {
            $params = $request->get_params();
            $template_id = (int) $params['id'];
            $current_user_id = get_current_user_id();

            // Check if template exists
            $existing_template = KCPatientEncountersTemplateMapping::find($template_id);

            if (!$existing_template) {
                return new \WP_Error(
                    'kc_template_not_found',
                    __('Encounter template not found.', 'kivicare-pro'),
                    ['status' => 404]
                );
            }

            // Check user permissions for updating this template using KCBase
            $kcbase = KCBase::get_instance();
            $is_admin = ($kcbase->getLoginUserRole() === 'administrator');

            // Only admin can update all templates, other users can only update their own templates
            if (!$is_admin && $existing_template->addedBy != $current_user_id) {
                return new \WP_Error(
                    'kc_insufficient_permissions',
                    __('You can only update templates that you created.', 'kivicare-pro'),
                    ['status' => 403]
                );
            }

            // Prepare data for updating encounter template
            $update_data = [];

            // Only update fields that are provided
            if (isset($params['name'])) {
                $update_data['encountersTemplateName'] = sanitize_text_field($params['name']);
            }

            if (isset($params['status'])) {
                $update_data['status'] = (int) $params['status'];
            }

            // If no data to update, return error
            if (empty($update_data)) {
                return new \WP_Error(
                    'kc_no_data_to_update',
                    __('No data provided for update.', 'kivicare-pro'),
                    ['status' => 400]
                );
            }

            // Update the encounter template
            $existing_template->encountersTemplateName = $update_data['encountersTemplateName'] ?? $existing_template->encountersTemplateName;
            $existing_template->status = $update_data['status'] ?? $existing_template->status;

            $update_result = $existing_template->save();

            if (is_wp_error($update_result)) {
                return new \WP_Error(
                    'kc_template_update_failed',
                    __('Failed to update encounter template.', 'kivicare-pro'),
                    ['status' => 500, 'error' => $update_result->get_error_message()]
                );
            }

            // Get the updated template
            $updated_template = KCPatientEncountersTemplateMapping::find($template_id);

            if (!$updated_template) {
                return new \WP_Error(
                    'kc_template_not_found_after_update',
                    __('Updated template not found.', 'kivicare-pro'),
                    ['status' => 404]
                );
            }

            // Prepare response data
            $response_data = [
                'id' => $updated_template->id,
                'encountersTemplateName' => $updated_template->encountersTemplateName,
                'status' => $updated_template->status,
                'addedBy' => $updated_template->addedBy,
                'createdAt' => $updated_template->createdAt,
            ];

            return $this->response($response_data, __('Encounter template updated successfully.', 'kivicare-pro'));
        } catch (\Exception $e) {
            return new \WP_Error(
                'kc_template_update_exception',
                __('An error occurred while updating the encounter template.', 'kivicare-pro'),
                ['status' => 500, 'error' => $e->getMessage()]
            );
        }
    }

    public function getEncounterTemplates($request)
    {
        try {

            $kcbase = KCBase::get_instance();
            $current_user_id = get_current_user_id();
            $current_user_role = $kcbase->getLoginUserRole();

            // Start query
            $query = KCPatientEncountersTemplateMapping::query();

            // Advanced permission logic based on user role using KiviCare models
            if (in_array($current_user_role, [$kcbase->getReceptionistRole(), $kcbase->getClinicAdminRole()])) {
                // Receptionist and Clinic Admin can see templates from their clinic's doctors + admin templates
                $clinic_id = $current_user_role == $kcbase->getReceptionistRole() ?
                    KCClinic::getClinicIdOfReceptionist() : KCClinic::getClinicIdOfClinicAdmin();

                // Get doctor IDs from the clinic using KiviCare model
                $doctor_mappings = KCDoctorClinicMapping::query()
                    ->where('clinicId', $clinic_id)
                    ->get();

                $doctor_ids = $doctor_mappings->pluck('doctorId')->toArray();
                
                // Get admin user IDs
                $admin_users = get_users(array(
                    'role' => 'administrator',
                    'fields' => 'ID',
                ));
                $admin_ids = array_map('intval', $admin_users);
                
                // fix: Include current user's own ID so clinic admin / receptionist can see
                // templates they personally created (addedBy = their own user ID).
                // Previously, only doctor IDs + administrator IDs were included, causing
                // templates added by the clinic admin role to be invisible in the list.
                $allowed_user_ids = array_merge($doctor_ids, $admin_ids, [$current_user_id]);

                // Filter by these user IDs
                $query->whereIn('addedBy', $allowed_user_ids);
            } elseif ($current_user_role == $kcbase->getDoctorRole()) {
                // Doctor can see admin templates + their own templates
                $admin_users = get_users(array(
                    'role' => 'administrator',
                    'fields' => 'ID',
                ));
                $admin_ids = array_map('intval', $admin_users);
                $admin_ids[] = $current_user_id;

                // Filter by admin IDs + current doctor ID
                $query->whereIn('addedBy', $admin_ids);
            } elseif ($current_user_role === $kcbase->getPatientRole()) {
                // Other users (patients, etc.) can only see their own templates
                $query->where('addedBy', $current_user_id);
            }

            // Handle column filters
            $columnFilters = $request->get_param('columnFilters');
            if (!empty($columnFilters)) {
                $columnFilters = is_string($columnFilters) ? json_decode(stripslashes($columnFilters), true) : $columnFilters;

                if (isset($columnFilters['id']) && !empty($columnFilters['id'])) {
                    $query->where('id', (int) $columnFilters['id']);
                }

                if (isset($columnFilters['encounters_template_name']) && !empty($columnFilters['encounters_template_name'])) {
                    $query->where('encountersTemplateName', 'LIKE', '%' . esc_sql($columnFilters['encounters_template_name']) . '%');
                }
            }

            // Handle search parameter
            $search = $request->get_param('search');
            if (!empty($search)) {
                $query->where(function($q) use ($search) {
                    $q->where('encountersTemplateName', 'LIKE', '%' . esc_sql($search) . '%');
                    if (is_numeric($search)) {
                        $q->orWhere('id', (int)$search);
                    }
                });
            }

            // Handle sorting
            $sort = $request->get_param('sort');
            if (!empty($sort) && is_array($sort) && isset($sort[0])) {
                $sort_data = $sort[0];
                if (isset($sort_data['id']) && !empty($sort_data['id'])) {
                    // in condition there is === because the value comes as string 'true' or 'false'
                    $direction = $sort_data['desc'] === 'true' ? 'DESC' : 'ASC';
                    if($sort_data['id'] === 'name') {
                        $sort_data['id'] = 'encountersTemplateName';
                    }
                    $query->orderBy($sort_data['id'], $direction);
                }
            } else {
                // Default sorting
                $query->orderBy('id', 'DESC');
            }

            // Handle pagination
            $perPage = (int) ($request->get_param('perPage') ?: 10);
            $page = (int) ($request->get_param('page') ?: 1);

            // Get total count before applying pagination
            $total = $query->count();

            // Apply pagination
            $query->limit($perPage)->offset($perPage * ($page - 1));
            $results = $query->get();

            // Format the results
            $list = $results->map(function ($row) {
                return [
                    'id' => $row->id,
                    'name' => $row->encountersTemplateName,
                    'status' => (int) $row->status,
                    'added_by' => (int) $row->addedBy,
                    'created_at' => $row->createdAt,
                ];
            });

            // Get default template ID if encounter_id is provided using KiviCare model
            $default_template_id = "";
            $encounter_id = $request->get_param('encounter_id');
            if (!empty($encounter_id)) {
                $encounter = KCPatientEncounter::query()
                    ->where('id', (int) $encounter_id)
                    ->first();
                $default_template_id = $encounter ? $encounter->templateId : "";
            }
            $totalPages = ceil($total / $perPage);
            return $this->response([
                'list' => $list,
                'default' => $default_template_id ?: "",
                'total_rows' => $total,
                'page' => $page,
                'total_pages' => $totalPages,
                'per_page' => $perPage,
                'has_more' => $page < $totalPages,
            ], __('Templates fetched successfully', 'kivicare-pro'));
        } catch (\Exception $e) {
            return new \WP_Error(
                'kc_template_list_exception',
                __('An error occurred while fetching templates.', 'kivicare-pro'),
                ['status' => 500, 'error' => $e->getMessage()]
            );
        }
    }

    public function getEncounterTemplate($request)
    {
        $kcbase = KCBase::get_instance();
        $current_user_id = get_current_user_id();
        $current_user_role = $kcbase->getLoginUserRole();

        $id = (int) $request->get_param('id');
        $template = KCPatientEncountersTemplateMapping::find($id);

        if (!$template) {
            return new \WP_Error('kc_template_not_found', __('Template not found.', 'kivicare-pro'), ['status' => 404]);
        }

        // Admin can view all, others only their own
        if ($current_user_role !== 'administrator' && $template->addedBy != $current_user_id) {
            return new \WP_Error('kc_permission_denied', __('You do not have permission to view this template.', 'kivicare-pro'), ['status' => 403]);
        }

        // Fetch custom field data for the template
        $customFieldData = [];
        if ($this->isModuleEnabled('custom_fields')) {
            $data = KCCustomFieldData::query()
                ->where('module_type', '=', 'patient_encounter_module')
                ->where('module_id', '=', $id)
                ->get();

            foreach ($data as $item) {
                $decodedData = json_decode($item->fieldsData, true);
                $customFieldData[$item->fieldId] = $decodedData !== null ? $decodedData : $item->fieldsData;
            }
        }

        $template_data = $template->toArray();
        $template_data['customfield_data'] = $customFieldData;

        return $this->response($template_data, __('Template fetched successfully', 'kivicare-pro'));
    }

    /**
     * Delete a single encounter template
     * 
     * @param \WP_REST_Request $request
     * @return \WP_REST_Response|\WP_Error
     */
    public function deleteEncounterTemplate($request)
    {
        try {
            $template_id = (int) $request->get_param('id');

            // Check if template exists
            $template = KCPatientEncountersTemplateMapping::find($template_id);

            if (!$template) {
                return new \WP_Error(
                    'kc_template_not_found',
                    __('Encounter template not found.', 'kivicare-pro'),
                    ['status' => 404]
                );
            }

            // Delete the template
            $delete_result = $template->delete();

            if (!$delete_result) {
                return new \WP_Error(
                    'kc_template_delete_failed',
                    __('Failed to delete encounter template.', 'kivicare-pro'),
                    ['status' => 500]
                );
            }

            return $this->response([
                'id' => $template_id,
                'deleted' => true
            ], __('Encounter template deleted successfully.', 'kivicare-pro'));
        } catch (\Exception $e) {
            return new \WP_Error(
                'kc_template_delete_exception',
                __('An error occurred while deleting the encounter template.', 'kivicare-pro'),
                ['status' => 500, 'error' => $e->getMessage()]
            );
        }
    }

    /**
     * Delete multiple encounter templates in bulk
     * 
     * @param \WP_REST_Request $request
     * @return \WP_REST_Response|\WP_Error
     */
    public function deleteBulkEncounterTemplate($request)
    {
        try {
            $ids_param = $request->get_param('ids');

            // Parse IDs from parameter
            if (is_string($ids_param)) {
                $ids = explode(',', $ids_param);
            } elseif (is_array($ids_param)) {
                $ids = $ids_param;
            } else {
                return new \WP_Error(
                    'kc_invalid_ids',
                    __('Invalid template IDs provided.', 'kivicare-pro'),
                    ['status' => 400]
                );
            }

            // Sanitize and validate IDs
            $template_ids = array_map('intval', $ids);
            $template_ids = array_filter($template_ids, function ($id) {
                return $id > 0;
            });

            if (empty($template_ids)) {
                return new \WP_Error(
                    'kc_no_valid_ids',
                    __('No valid template IDs provided.', 'kivicare-pro'),
                    ['status' => 400]
                );
            }

            // Check if all templates exist
            $templates = KCPatientEncountersTemplateMapping::query()
                ->whereIn('id', $template_ids)
                ->get();

            if ($templates->count() !== count($template_ids)) {
                return new \WP_Error(
                    'kc_some_templates_not_found',
                    __('Some encounter templates were not found.', 'kivicare-pro'),
                    ['status' => 404]
                );
            }

            // Delete templates
            $deleted_count = 0;
            $failed_ids = [];

            foreach ($templates as $template) {
                $delete_result = $template->delete();

                if ($delete_result) {
                    $deleted_count++;
                } else {
                    $failed_ids[] = $template->id;
                }
            }

            // Prepare response
            $response_data = [
                'total_requested' => count($template_ids),
                'deleted_count' => $deleted_count,
                'failed_count' => count($failed_ids),
                'failed_ids' => $failed_ids,
            ];

            if ($deleted_count === count($template_ids)) {
                // All templates deleted successfully
                return $this->response($response_data, __('All encounter templates deleted successfully.', 'kivicare-pro'));
            } elseif ($deleted_count > 0) {
                // Some templates deleted, some failed
                return $this->response($response_data, sprintf(
                    __('%d out of %d encounter templates deleted successfully.', 'kivicare-pro'),
                    $deleted_count,
                    count($template_ids)
                ));
            } else {
                // All templates failed to delete
                return new \WP_Error(
                    'kc_bulk_delete_failed',
                    __('Failed to delete any encounter templates.', 'kivicare-pro'),
                    ['status' => 500, 'data' => $response_data]
                );
            }
        } catch (\Exception $e) {
            return new \WP_Error(
                'kc_bulk_delete_exception',
                __('An error occurred while deleting encounter templates.', 'kivicare-pro'),
                ['status' => 500, 'error' => $e->getMessage()]
            );
        }
    }

    /**
     * Save encounter template medical history
     * 
     * @param \WP_REST_Request $request
     * @return \WP_REST_Response|\WP_Error
     */
    public function saveEncounterTemplateMedicalHistory($request)
    {
        try {
            $params = $request->get_params();

            // Prepare data for encounter template
            $template_data = [
                'encountersTemplateId' => (int) $params['template_id'],
                'clinicalDetailType' => sanitize_text_field($params['type']),
                'clinicalDetailVal' => sanitize_text_field($params['title']),
                'addedBy' => get_current_user_id(),
                'createdAt' => current_time('mysql'),
            ];

            // Create the encounter template record
            $template_id = KCPatientEncountersTemplate::create($template_data);

            if (is_wp_error($template_id)) {
                return new \WP_Error(
                    'kc_template_creation_failed',
                    __('Failed to save encounter template.', 'kivicare-pro'),
                    ['status' => 500, 'error' => $template_id->get_error_message()]
                );
            }

            // Get the created record
            $created_template = KCPatientEncountersTemplate::find($template_id);

            if (!$created_template) {
                return new \WP_Error(
                    'kc_template_not_found',
                    __('Created template not found.', 'kivicare-pro'),
                    ['status' => 404]
                );
            }

            // Prepare response data
            $response_data = [
                'id' => $created_template->id,
                'encounters_template_id' => $created_template->encountersTemplateId,
                'clinical_detail_type' => $created_template->clinicalDetailType,
                'clinical_detail_val' => $created_template->clinicalDetailVal,
                'added_by' => $created_template->addedBy,
                'created_at' => $created_template->createdAt,
            ];

            return $this->response($response_data, __('Encounter template saved successfully.', 'kivicare-pro'));
        } catch (\Exception $e) {
            return new \WP_Error(
                'kc_template_save_exception',
                __('An error occurred while saving encounter template.', 'kivicare-pro'),
                ['status' => 500, 'error' => $e->getMessage()]
            );
        }
    }

    /**
     * Get all medical history items for an encounter template
     * 
     * @param \WP_REST_Request $request
     * @return \WP_REST_Response|\WP_Error
     */
    public function getEncounterTemplateMedicalHistory($request)
    {
        try {
            $template_id = (int) $request->get_param('id');
            $type_filter = $request->get_param('type');

            // Check if template exists
            $template = KCPatientEncountersTemplateMapping::find($template_id);
            if (!$template) {
                return new \WP_Error(
                    'kc_template_not_found',
                    __('Encounter template not found.', 'kivicare-pro'),
                    ['status' => 404]
                );
            }

            // Build query for medical history items
            $query = KCPatientEncountersTemplate::query()
                ->where('encountersTemplateId', $template_id);

            // Apply type filter if provided
            if (!empty($type_filter)) {
                $query->where('clinicalDetailType', $type_filter);
            }

            $history_items = $query->orderBy('id', 'DESC')->get();

            // Prepare template data
            $template_data = [
                'id' => $template->id,
                'name' => $template->encountersTemplateName,
                'status' => (int) $template->status,
                'added_by' => $template->addedBy,
                'created_at' => $template->createdAt,
            ];

            if (!empty($type_filter)) {
                // Return specific type items as a list
                $items = $history_items->map(function ($item) {
                    return [
                        'id' => $item->id,
                        'encounters_template_id' => $item->encountersTemplateId,
                        'clinical_detail_type' => $item->clinicalDetailType,
                        'clinical_detail_val' => $item->clinicalDetailVal,
                        'added_by' => $item->addedBy,
                        'created_at' => $item->createdAt,
                    ];
                });

                return $this->response([
                    'template' => $template_data,
                    'type' => $type_filter,
                    'items' => $items,
                    'total' => $history_items->count(),
                ], __('Medical history items for type fetched successfully.', 'kivicare-pro'));
            } else {
                // Group items by clinical detail type
                $grouped_items = [];
                foreach ($history_items as $item) {
                    $type = $item->clinicalDetailType;
                    if (!isset($grouped_items[$type])) {
                        $grouped_items[$type] = [];
                    }
                    $grouped_items[$type][] = [
                        'id' => $item->id,
                        'encounters_template_id' => $item->encountersTemplateId,
                        'clinical_detail_type' => $item->clinicalDetailType,
                        'clinical_detail_val' => $item->clinicalDetailVal,
                        'added_by' => $item->addedBy,
                        'created_at' => $item->createdAt,
                    ];
                }

                return $this->response([
                    'template' => $template_data,
                    'items' => $grouped_items,
                    'total' => $history_items->count(),
                ], __('Medical history items fetched successfully.', 'kivicare-pro'));
            }
        } catch (\Exception $e) {
            return new \WP_Error(
                'kc_medical_history_fetch_exception',
                __('An error occurred while fetching medical history items.', 'kivicare-pro'),
                ['status' => 500, 'error' => $e->getMessage()]
            );
        }
    }

    /**
     * Delete a medical history item
     * 
     * @param \WP_REST_Request $request
     * @return \WP_REST_Response|\WP_Error
     */
    public function deleteEncounterTemplateMedicalHistoryItem($request)
    {
        try {
            $template_id = (int) $request->get_param('id');
            $item_id = (int) $request->get_param('item_id');

            // Check if template exists
            $template = KCPatientEncountersTemplateMapping::find($template_id);
            if (!$template) {
                return new \WP_Error(
                    'kc_template_not_found',
                    __('Encounter template not found.', 'kivicare-pro'),
                    ['status' => 404]
                );
            }

            // Get the medical history item
            $item = KCPatientEncountersTemplate::find($item_id);

            if (!$item) {
                return new \WP_Error(
                    'kc_item_not_found',
                    __('Medical history item not found.', 'kivicare-pro'),
                    ['status' => 404]
                );
            }

            // Check if item belongs to the template
            if ($item->encountersTemplateId != $template_id) {
                return new \WP_Error(
                    'kc_item_not_belongs_to_template',
                    __('Medical history item does not belong to this template.', 'kivicare-pro'),
                    ['status' => 403]
                );
            }

            // Delete the item
            $delete_result = $item->delete();

            if (!$delete_result) {
                return new \WP_Error(
                    'kc_item_delete_failed',
                    __('Failed to delete medical history item.', 'kivicare-pro'),
                    ['status' => 500]
                );
            }

            return $this->response([
                'id' => $item_id,
                'deleted' => true
            ], __('Medical history item deleted successfully.', 'kivicare-pro'));
        } catch (\Exception $e) {
            return new \WP_Error(
                'kc_medical_history_item_delete_exception',
                __('An error occurred while deleting medical history item.', 'kivicare-pro'),
                ['status' => 500, 'error' => $e->getMessage()]
            );
        }
    }

    /**
     * Save encounter template prescription
     * 
     * @param \WP_REST_Request $request
     * @return \WP_REST_Response|\WP_Error
     */
    public function saveEncounterTemplatePrescription($request)
    {
        try {
            $params = $request->get_params();
            $template_id = (int) $request->get_param('id');

            // Check if template exists
            $template = KCPatientEncountersTemplateMapping::find($template_id);
            if (!$template) {
                return new \WP_Error(
                    'kc_template_not_found',
                    __('Encounter template not found.', 'kivicare-pro'),
                    ['status' => 404]
                );
            }

            // Prepare data for encounter template prescription
            $prescription_data = [
                'encountersTemplateId' => $template_id,
                'name' => sanitize_text_field($params['name']),
                'frequency' => sanitize_text_field($params['frequency']),
                'duration' => sanitize_text_field($params['duration']),
                'instruction' => isset($params['instruction']) ? sanitize_text_field($params['instruction']) : '',
                'addedBy' => get_current_user_id(),
                'createdAt' => current_time('mysql'),
            ];

            // Create the encounter template prescription record
            $prescription_id = KCPrescriptionEncounterTemplate::create($prescription_data);

            if (is_wp_error($prescription_id)) {
                return new \WP_Error(
                    'kc_template_prescription_creation_failed',
                    __('Failed to save encounter template prescription.', 'kivicare-pro'),
                    ['status' => 500, 'error' => $prescription_id->get_error_message()]
                );
            }

            // Get the created record
            $created_prescription = KCPrescriptionEncounterTemplate::find($prescription_id);

            if (!$created_prescription) {
                return new \WP_Error(
                    'kc_template_prescription_not_found',
                    __('Created template prescription not found.', 'kivicare-pro'),
                    ['status' => 404]
                );
            }

            // Prepare response data
            $response_data = [
                'id' => $created_prescription->id,
                'encounters_template_id' => $created_prescription->encountersTemplateId,
                'name' => $created_prescription->name,
                'frequency' => $created_prescription->frequency,
                'duration' => $created_prescription->duration,
                'instruction' => $created_prescription->instruction,
                'added_by' => $created_prescription->addedBy,
                'created_at' => $created_prescription->createdAt,
            ];

            return $this->response($response_data, __('Encounter template prescription saved successfully.', 'kivicare-pro'));
        } catch (\Exception $e) {
            return new \WP_Error(
                'kc_template_prescription_save_exception',
                __('An error occurred while saving encounter template prescription.', 'kivicare-pro'),
                ['status' => 500, 'error' => $e->getMessage()]
            );
        }
    }

    /**
     * Get all prescriptions for an encounter template
     * 
     * @param \WP_REST_Request $request
     * @return \WP_REST_Response|\WP_Error
     */
    public function getEncounterTemplatePrescriptions($request)
    {
        try {
            $template_id = (int) $request->get_param('id');

            // Check if template exists
            $template = KCPatientEncountersTemplateMapping::find($template_id);
            if (!$template) {
                return new \WP_Error(
                    'kc_template_not_found',
                    __('Encounter template not found.', 'kivicare-pro'),
                    ['status' => 404]
                );
            }

            // Get prescription items
            $prescription_items = KCPrescriptionEncounterTemplate::query()
                ->where('encountersTemplateId', $template_id)
                ->orderBy('id', 'DESC')
                ->get();

            // Prepare template data
            $template_data = [
                'id' => $template->id,
                'name' => $template->encountersTemplateName,
                'status' => (int) $template->status,
                'added_by' => $template->addedBy,
                'created_at' => $template->createdAt,
            ];

            // Format prescription items
            $items = $prescription_items->map(function ($item) {
                return [
                    'id' => $item->id,
                    'encounters_template_id' => $item->encountersTemplateId,
                    'name' => $item->name,
                    'frequency' => $item->frequency,
                    'duration' => $item->duration,
                    'instruction' => $item->instruction,
                    'added_by' => $item->addedBy,
                    'created_at' => $item->createdAt,
                ];
            });

            return $this->response([
                'template' => $template_data,
                'items' => $items,
                'total' => $prescription_items->count(),
            ], __('Prescription items fetched successfully.', 'kivicare-pro'));
        } catch (\Exception $e) {
            return new \WP_Error(
                'kc_prescription_fetch_exception',
                __('An error occurred while fetching prescription items.', 'kivicare-pro'),
                ['status' => 500, 'error' => $e->getMessage()]
            );
        }
    }

    /**
     * Delete a prescription item
     * 
     * @param \WP_REST_Request $request
     * @return \WP_REST_Response|\WP_Error
     */
    public function deleteEncounterTemplatePrescriptionItem($request)
    {
        try {
            $template_id = (int) $request->get_param('id');
            $item_id = (int) $request->get_param('item_id');

            // Check if template exists
            $template = KCPatientEncountersTemplateMapping::find($template_id);
            if (!$template) {
                return new \WP_Error(
                    'kc_template_not_found',
                    __('Encounter template not found.', 'kivicare-pro'),
                    ['status' => 404]
                );
            }

            // Get the prescription item
            $item = KCPrescriptionEncounterTemplate::find($item_id);

            if (!$item) {
                return new \WP_Error(
                    'kc_item_not_found',
                    __('Prescription item not found.', 'kivicare-pro'),
                    ['status' => 404]
                );
            }

            // Check if item belongs to the template
            if ($item->encountersTemplateId != $template_id) {
                return new \WP_Error(
                    'kc_item_not_belongs_to_template',
                    __('Prescription item does not belong to this template.', 'kivicare-pro'),
                    ['status' => 403]
                );
            }

            // Delete the item
            $delete_result = $item->delete();

            if (!$delete_result) {
                return new \WP_Error(
                    'kc_item_delete_failed',
                    __('Failed to delete prescription item.', 'kivicare-pro'),
                    ['status' => 500]
                );
            }

            return $this->response([
                'id' => $item_id,
                'deleted' => true
            ], __('Prescription item deleted successfully.', 'kivicare-pro'));
        } catch (\Exception $e) {
            return new \WP_Error(
                'kc_prescription_item_delete_exception',
                __('An error occurred while deleting prescription item.', 'kivicare-pro'),
                ['status' => 500, 'error' => $e->getMessage()]
            );
        }
    }

    /**
     * Apply encounter template to an encounter
     *
     * @param \WP_REST_Request $request
     * @return \WP_REST_Response|\WP_Error
     */
    public function applyTemplateToEncounter($request)
    {
        try {
            $template_id = (int) $request->get_param('id');
            $encounter_id = (int) $request->get_param('encounter_id');
            $current_user_id = get_current_user_id();
            $current_time = current_time('mysql');

            // Get template and encounter (already validated in permission check)
            $template = KCPatientEncountersTemplateMapping::find($template_id);
            $encounter = KCPatientEncounter::find($encounter_id);

            // 2. Update encounter to link to template
            $encounter->templateId = $template_id;
            $encounter->save();

            // 3. Cleanup old template data
            // Remove medical history records that came from templates
            KCMedicalHistory::query()
                ->where('encounter_id', $encounter_id)
                ->where('is_from_template', 1)
                ->delete();

            // Remove prescription records that came from templates
            KCPrescription::query()
                ->where('encounter_id', $encounter_id)
                ->where('is_from_template', 1)
                ->delete();

            // 4. Template data retrieval
            $template_medical_history = KCPatientEncountersTemplate::query()
                ->where('encountersTemplateId', $template_id)
                ->get();

            $template_prescriptions = KCPrescriptionEncounterTemplate::query()
                ->where('encountersTemplateId', $template_id)
                ->get();

            $medical_history_inserted = 0;
            $prescription_inserted = 0;

            // 5. Medical History Population
            if ($template_medical_history->count() > 0) {
                $medical_history_data = [];

                foreach ($template_medical_history as $template_item) {
                    $medical_history_data[] = [
                        'patientId' => $encounter->patientId,
                        'encounterId' => $encounter_id,
                        'title' => $template_item->clinicalDetailVal,
                        'type' => $template_item->clinicalDetailType,
                        'addedBy' => $current_user_id,
                        'createdAt' => $current_time,
                        'isFromTemplate' => 1,
                    ];
                }

                // Bulk insert medical history records
                foreach ($medical_history_data as $data) {
                    KCMedicalHistory::create($data);
                    $medical_history_inserted++;
                }
            }

            // 6. Prescription Population
            if ($template_prescriptions->count() > 0) {
                $prescription_data = [];

                foreach ($template_prescriptions as $template_prescription) {
                    $prescription_data[] = [
                        'encounterId' => $encounter_id,
                        'patientId' => $encounter->patientId,
                        'name' => $template_prescription->name,
                        'frequency' => $template_prescription->frequency,
                        'duration' => $template_prescription->duration,
                        'instruction' => $template_prescription->instruction,
                        'addedBy' => $current_user_id,
                        'createdAt' => $current_time,
                        'isFromTemplate' => 1,
                    ];
                }

                // Bulk insert prescription records
                foreach ($prescription_data as $data) {
                    KCPrescription::create($data);
                    $prescription_inserted++;
                }
            }

            return $this->response([
                'template_id' => $template_id,
                'encounter_id' => $encounter_id,
                'medical_history_inserted' => $medical_history_inserted,
                'prescription_inserted' => $prescription_inserted,
                'template_name' => $template->encountersTemplateName,
            ], __('Template applied to encounter successfully.', 'kivicare-pro'));

        } catch (\Exception $e) {
            return new \WP_Error(
                'kc_apply_template_exception',
                __('An error occurred while applying template to encounter.', 'kivicare-pro'),
                ['status' => 500, 'error' => $e->getMessage()]
            );
        }
    }
}
