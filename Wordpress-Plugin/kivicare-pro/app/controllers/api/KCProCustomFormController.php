<?php
namespace KCProApp\controllers\api;

use App\baseClasses\KCBaseController;
use App\models\KCAppointment;
use App\models\KCDoctorClinicMapping;
use App\models\KCPatientClinicMapping;
use App\models\KCPatientEncounter;
use KCProApp\models\KCCustomForm;
use KCProApp\models\KCCustomFormData;
use App\models\KCClinic;
use WP_REST_Request;
use WP_REST_Response;
use WP_Error;

defined('ABSPATH') or die('Something went wrong');

/**
 * Class KCProCustomFormController
 * 
 * REST API controller for managing custom forms in KiviCare Pro.
 * Handles CRUD operations and form submissions for custom forms that can be
 * associated with appointments, encounters, patients, and doctors.
 * 
 * @package KCProApp\controllers\api
 * @since 1.0.0
 */
class KCProCustomFormController extends KCBaseController
{
    /**
     * The base route for all custom form endpoints
     * 
     * @var string
     */
    protected $route = 'custom-forms';

    /**
     * Register routes for this controller
     */
    public function registerRoutes()
    {
        // Get single custom form
        $this->registerRoute('/' . $this->route . '/(?P<id>\d+)', [
            'methods' => 'GET',
            'callback' => [$this, 'getCustomForm'],
            'permission_callback' => [$this, 'checkPermission'],
            'args' => $this->getSingleEndpointArgs()
        ]);

        // Create custom form
        $this->registerRoute('/' . $this->route, [
            'methods' => 'POST',
            'callback' => [$this, 'createCustomForm'],
            'permission_callback' => [$this, 'checkCreatePermission'],
            'args' => $this->getCreateEndpointArgs()
        ]);

        // Update custom form
        $this->registerRoute('/' . $this->route . '/(?P<id>\d+)', [
            'methods' => 'PUT',
            'callback' => [$this, 'updateCustomForm'],
            'permission_callback' => [$this, 'checkUpdatePermission'],
            'args' => $this->getUpdateEndpointArgs()
        ]);

        // Delete custom form
        $this->registerRoute('/' . $this->route . '/(?P<id>\d+)', [
            'methods' => 'DELETE',
            'callback' => [$this, 'deleteCustomForm'],
            'permission_callback' => [$this, 'checkDeletePermission'],
            'args' => $this->getSingleEndpointArgs()
        ]);

        // Bulk delete custom forms
        $this->registerRoute('/' . $this->route . '/bulk-delete', [
            'methods' => 'POST',
            'callback' => [$this, 'bulkDeleteCustomForms'],
            'permission_callback' => [$this, 'checkDeletePermission'],
            'args' => $this->getBulkDeleteEndpointArgs()
        ]);

        // Update custom form status
        $this->registerRoute('/' . $this->route . '/(?P<id>\d+)/status', [
            'methods' => 'PUT',
            'callback' => [$this, 'updateCustomFormStatus'],
            'permission_callback' => [$this, 'checkUpdatePermission'],
            'args' => $this->getStatusUpdateEndpointArgs()
        ]);


        // Submit custom form data
        $this->registerRoute('/' . $this->route . '/submit', [
            'methods' => 'POST',
            'callback' => [$this, 'submitCustomForm'],
            'permission_callback' => [$this, 'checkSubmitPermission'],
            'args' => $this->getSubmitEndpointArgs()
        ]);

        // Admin list custom forms
        $this->registerRoute('/' . $this->route . '/admin', [
            'methods' => 'GET',
            'callback' => [$this, 'getCustomFormsAdmin'],
            'permission_callback' => [$this, 'checkAdminPermission'],
            'args' => $this->getListEndpointArgs()
        ]);

        // Render custom forms
        $this->registerRoute('/' . $this->route . '/render', [
            'methods' => 'GET',
            'callback' => [$this, 'getCustomFormsRender'],
            'permission_callback' => function (\WP_REST_Request $request) {
                $params = $request->get_params(); // Get request params to check module_id
                if (empty($params['module_id'])) {
                    return true;
                }
                return in_array($this->kcbase->getLoginUserRole(), ['administrator', ...$this->kcbase->KCGetRoles()]);
            },
            'args' => $this->getListRenderEndpointArgs()
        ]);
    }

    /**
     * Get arguments for list endpoint
     */
    private function getListRenderEndpointArgs()
    {
        return [
            'module_type' => [
                'description' => 'Filter by module type',
                'type' => 'string',
                'required' => false,
                'enum' => ['appointment_module', 'patient_encounter_module', 'patient_module', 'doctor_module'],
                'sanitize_callback' => 'sanitize_text_field',
            ],
            'module_id' => [
                'description' => 'Filter by module ID',
                'type' => 'integer',
                'required' => false,
                'sanitize_callback' => 'absint',
            ],
        ];
    }
    /**
     * Get arguments for list endpoint
     */
    private function getListEndpointArgs()
    {
        return [
            'page' => [
                'description' => 'Page number',
                'type' => 'integer',
                'required' => false,
                'default' => 1,
                'validate_callback' => function ($param) {
                    return is_numeric($param) && $param > 0;
                },
                'sanitize_callback' => 'absint',
            ],
            'perPage' => [
                'description' => 'Number of items per page',
                'type' => 'string',
                'required' => false,
                'default' => 10,
                'validate_callback' => function ($param) {
                    return strtolower($param) === 'all' || (is_numeric($param) && $param > 0);
                },
                'sanitize_callback' => function ($param) {
                    return strtolower($param) === 'all' ? 'all' : absint($param);
                },
            ],
            'search' => [
                'description' => 'Search term',
                'type' => 'string',
                'required' => false,
                'sanitize_callback' => 'sanitize_text_field',
            ],
            'status' => [
                'description' => 'Filter by status',
                'type' => 'integer',
                'required' => false,
                'enum' => [0, 1],
                'sanitize_callback' => 'absint',
            ],
            'module_type' => [
                'description' => 'Filter by module type',
                'type' => 'string',
                'required' => false,
                'enum' => ['appointment', 'encounter', 'patient', 'doctor'],
                'sanitize_callback' => 'sanitize_text_field',
            ],
            'module_id' => [
                'description' => 'Filter by module ID',
                'type' => 'integer',
                'required' => false,
                'sanitize_callback' => 'absint',
            ],
        ];
    }

    /**
     * Get arguments for single item endpoints
     */
    private function getSingleEndpointArgs()
    {
        return [
            'id' => [
                'description' => 'Custom Form ID',
                'type' => 'integer',
                'required' => true,
                'validate_callback' => function ($param) {
                    return is_numeric($param) && $param > 0;
                },
                'sanitize_callback' => 'absint',
            ],
        ];
    }

    /**
     * Get arguments for create endpoint
     */
    private function getCreateEndpointArgs()
    {
        return [
            'name' => [
                'description' => 'Form name',
                'type' => 'string',
                'required' => true,
                'sanitize_callback' => 'sanitize_text_field',
            ],
            'moduleType' => [
                'description' => 'Module type',
                'type' => 'string',
                'required' => true,
                'enum' => ['appointment_module', 'patient_encounter_module', 'patient_module', 'doctor_module'],
                'sanitize_callback' => 'sanitize_text_field',
            ],
            'status' => [
                'description' => 'Form status',
                'type' => 'string',
                'required' => false,
                'default' => 'active',
                'enum' => ['active', 'inactive'],
                'sanitize_callback' => 'sanitize_text_field',
            ],
            'fields' => [
                'description' => 'Form fields configuration',
                'type' => 'array',
                'required' => false,
                'default' => [],
                'items' => [
                    'type' => 'object',
                ],
            ],
            'formIcon' => [
                'description' => 'Form icon',
                'type' => 'string',
                'required' => false,
                'sanitize_callback' => 'sanitize_text_field',
            ],
            // 'showIfAppointmentStatus' => [
            //     'description' => 'Show if appointment status',
            //     'type' => 'array',
            //     'required' => false,
            //     'items' => [
            //         'type' => 'string',
            //     ],
            // ],
            'showInModule' => [
                'description' => 'Show in module',
                'type' => 'string',
                'required' => false,
                'sanitize_callback' => 'sanitize_text_field',
            ],
            'showInEncounter' => [
                'description' => 'Show in encounter',
                'type' => 'boolean',
                'required' => false,
            ],
            'showInAppointment' => [
                'description' => 'Show in appointment',
                'type' => 'boolean',
                'required' => false,
            ],
            'clinics' => [
                'description' => 'Clinics',
                'type' => 'array',
                'required' => false,
                'items' => [
                    'type' => 'integer',
                ],
            ],
            'roles' => [
                'description' => 'Roles',
                'type' => 'array',
                'required' => false,
                'items' => [
                    'type' => 'string',
                ],
            ],
            'form_conditions' => [
                'description' => 'Form field conditions',
                'type' => 'array',
                'required' => false,
                'default' => [],
                'items' => [
                    'type' => 'object',
                ],
            ],
        ];
    }

    /**
     * Get arguments for update endpoint
     */
    private function getUpdateEndpointArgs()
    {
        $args = $this->getCreateEndpointArgs();
        $args['id'] = [
            'description' => 'Custom Form ID',
            'type' => 'integer',
            'required' => true,
            'validate_callback' => function ($param) {
                return is_numeric($param) && $param > 0;
            },
            'sanitize_callback' => 'absint',
        ];
        return $args;
    }

    /**
     * Get arguments for bulk delete endpoint
     */
    private function getBulkDeleteEndpointArgs()
    {
        return [
            'ids' => [
                'description' => 'Array of custom form IDs to delete',
                'type' => 'array',
                'required' => true,
                'items' => [
                    'type' => 'integer',
                    'validate_callback' => function ($param) {
                        return is_numeric($param) && $param > 0;
                    },
                    'sanitize_callback' => 'absint',
                ],
            ],
        ];
    }

    /**
     * Get arguments for status update endpoint
     */
    private function getStatusUpdateEndpointArgs()
    {
        return [
            'id' => [
                'description' => 'Custom Form ID',
                'type' => 'integer',
                'required' => true,
                'validate_callback' => function ($param) {
                    return is_numeric($param) && $param > 0;
                },
                'sanitize_callback' => 'absint',
            ],
            'status' => [
                'description' => 'New status',
                'type' => 'integer',
                'required' => true,
                'enum' => [0, 1],
                'sanitize_callback' => 'absint',
            ],
        ];
    }

    /**
     * Get arguments for submit endpoint
     */
    private function getSubmitEndpointArgs()
    {
        return [
            'form_id' => [
                'description' => 'Custom Form ID',
                'type' => 'integer',
                'required' => true,
                'validate_callback' => function ($param) {
                    return is_numeric($param) && $param > 0;
                },
                'sanitize_callback' => 'absint',
            ],
            'module_id' => [
                'description' => 'Module ID (encounter_id, patient_id, etc.)',
                'type' => 'integer',
                'required' => true,
                'validate_callback' => function ($param) {
                    return is_numeric($param) && $param > 0;
                },
                'sanitize_callback' => 'absint',
            ],
            'module_type' => [
                'description' => 'Module type (appointment_module, patient_encounter_module, etc.)',
                'type' => 'string',
                'required' => true,
                'enum' => ['appointment_module', 'patient_encounter_module', 'patient_module', 'doctor_module'],
                'sanitize_callback' => 'sanitize_text_field',
            ],
            'form_data' => [
                'description' => 'Form data to submit',
                'type' => 'object',
                'required' => true,
                'validate_callback' => function ($param) {
                    return is_array($param) || is_object($param);
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

                    return $sanitize_recursive((array) $param);
                },
            ],
        ];
    }

    /**
     * Permission checks
     */
    public function checkPermission($request)
    {
        return $this->checkCapability('custom_form_list');
    }

    public function checkCreatePermission($request)
    {
        return $this->checkCapability('custom_form_add');
    }

    public function checkSubmitPermission($request)
    {
        $moduleType = $request->get_param('module_type');
        
        // Allow authenticated users to submit appointment and patient forms
        if (in_array($moduleType, ['appointment_module', 'patient_module'])) {
            return is_user_logged_in();
        }

        return $this->checkCapability('patient_encounter_edit');
    }

    public function checkUpdatePermission($request)
    {
        return $this->checkCapability('custom_form_edit');
    }

    public function checkDeletePermission($request)
    {
        return $this->checkCapability('custom_form_delete');
    }

    public function checkAdminPermission($request)
    {
        return $this->checkCapability('custom_form_list');
    }

    /**
     * Get a single custom form.
     *
     * @param WP_REST_Request $request The REST API request object.
     * @return WP_REST_Response Returns a response containing the custom form data on success.
     */
    public function getCustomForm(WP_REST_Request $request): WP_REST_Response
    {
        try {
            $id = $request->get_param('id');
            $form = KCCustomForm::find($id);

            if (!$form) {
                return $this->response(null, __('Custom form not found', 'kivicare-pro'), false, 404);
            }

            return $this->response($this->formatCustomForm($form), __('Custom form retrieved successfully', 'kivicare-pro'));
        } catch (\Exception $e) {
            return $this->response(['error' => $e->getMessage()], __('Failed to retrieve custom form', 'kivicare-pro'), false, 500);
        }
    }

    /**
     * Create a new custom form.
     *
     * @param WP_REST_Request $request The REST API request object.
     * @return WP_REST_Response Returns a response containing the created form data on success.
     */
    public function createCustomForm(WP_REST_Request $request): WP_REST_Response
    {
        try {
            $params = $request->get_params();

            // Prepare name as object
            $nameObj = is_array($params['name']) ? $params['name'] : [
                'text' => $params['name'],
                'color' => 'text-primary',
                'align' => 'text-center',
                'tag' => 'h2',
            ];

            // Prepare conditions
            $conditions = [];
            if (!empty($params['showIfAppointmentStatus'])) {
                $conditions['appointment_status'] = array_map(function ($status) {
                    return ['id' => (string) $status, 'label' => 'Status ' . $status];
                }, $params['showIfAppointmentStatus']);
            }
            $showMode = [];
            if (!empty($params['showInEncounter'])) {
                $showMode[] = ['id' => 'encounter', 'label' => 'Encounter'];
            }
            if (!empty($params['showInAppointment'])) {
                $showMode[] = ['id' => 'appointment', 'label' => 'Appointment'];
            }
            if (!empty($showMode)) {
                $conditions['show_mode'] = $showMode;
            }

            // Ensure Clinic Admin's clinic is associated
            $currentRole = $this->kcbase->getLoginUserRole();
            $clinicAdminRole = $this->kcbase->getClinicAdminRole();

            if ($currentRole === $clinicAdminRole) {
                $userClinicId = KCClinic::getClinicIdForCurrentUser();
                if ($userClinicId) {
                    $clinics = !empty($params['clinics']) ? $params['clinics'] : [];
                    // Ensure we're dealing with integers/strings consistently
                    if (!in_array($userClinicId, $clinics) && !in_array((string)$userClinicId, $clinics)) {
                        $clinics[] = $userClinicId;
                    }
                    $params['clinics'] = $clinics;
                }
            }

            if (!empty($params['clinics'])) {
                $conditions['clinics'] = $params['clinics'];
            }
            if (!empty($params['roles'])) {
                $conditions['roles'] = $params['roles'];
            }
            if (isset($params['form_conditions'])) {
                $conditions['form_conditions'] = $params['form_conditions'];
            }

            $form = new KCCustomForm();
            $form->setName($nameObj);
            $form->module_type = $params['showInModule'] ?: $params['moduleType'];
            $form->status = $params['status'] === 'active' ? 1 : 0;
            $form->setFields($this->sanitizeFields($params['fields'] ?? []));
            $form->setConditions($this->sanitizeConditions($conditions));
            $form->added_by = get_current_user_id();
            $form->created_at = current_time('mysql');

            if (!$form->save()) {
                return $this->response(null, __('Failed to create custom form', 'kivicare-pro'), false, 500);
            }

            return $this->response($this->formatCustomForm($form), __('Custom form created successfully', 'kivicare-pro'), true, 201);
        } catch (\Exception $e) {
            return $this->response(['error' => $e->getMessage()], __('Failed to create custom form', 'kivicare-pro'), false, 500);
        }
    }

    /**
     * Update an existing custom form.
     *
     * @param WP_REST_Request $request The REST API request object.
     * @return WP_REST_Response Returns a response containing the updated form data on success.
     */
    public function updateCustomForm(WP_REST_Request $request): WP_REST_Response
    {
        try {
            $id = $request->get_param('id');
            $params = $request->get_params();

            $form = KCCustomForm::find($id);
            if (!$form) {
                return $this->response(null, __('Custom form not found', 'kivicare-pro'), false, 404);
            }

            if (isset($params['name'])) {
                $nameObj = is_array($params['name']) ? $params['name'] : [
                    'text' => $params['name'],
                    'color' => 'text-primary',
                    'align' => 'text-center',
                    'tag' => 'h2',
                ];
                $form->setName($nameObj);
            }
            if (isset($params['moduleType']) || isset($params['showInModule'])) {
                $form->module_type = $params['showInModule'] ?: $params['moduleType'];
            }
            if (isset($params['status'])) {
                $form->status = $params['status'] === 'active' ? 1 : 0;
            }
            if (isset($params['fields'])) {
                $form->setFields($this->sanitizeFields($params['fields']));
            }
            if (isset($params['showIfAppointmentStatus']) || isset($params['showInEncounter']) || isset($params['showInAppointment']) || isset($params['clinics']) || isset($params['roles'])) {
                $conditions = $form->getConditions();
                if (isset($params['showIfAppointmentStatus'])) {
                    $conditions['appointment_status'] = array_map(function ($status) {
                        return ['id' => (string) $status, 'label' => 'Status ' . $status];
                    }, $params['showIfAppointmentStatus']);
                }
                $showMode = [];
                if (!empty($params['showInEncounter'])) {
                    $showMode[] = ['id' => 'encounter', 'label' => 'Encounter'];
                }
                if (!empty($params['showInAppointment'])) {
                    $showMode[] = ['id' => 'appointment', 'label' => 'Appointment'];
                }
                if (!empty($showMode)) {
                    $conditions['show_mode'] = $showMode;
                }

                // Ensure Clinic Admin's clinic is associated on update too
                $currentRole = $this->kcbase->getLoginUserRole();
                $clinicAdminRole = $this->kcbase->getClinicAdminRole();

                if ($currentRole === $clinicAdminRole && isset($params['clinics'])) {
                    $userClinicId = KCClinic::getClinicIdForCurrentUser();
                    if ($userClinicId) {
                        $clinics = $params['clinics'];
                        if (!in_array($userClinicId, $clinics) && !in_array((string)$userClinicId, $clinics)) {
                            $clinics[] = $userClinicId;
                        }
                        $params['clinics'] = $clinics;
                    }
                }

                if (isset($params['clinics'])) {
                    $conditions['clinics'] = $params['clinics'];
                }
                if (isset($params['roles'])) {
                    $conditions['roles'] = $params['roles'];
                }
                if (isset($params['form_conditions'])) {
                    $conditions['form_conditions'] = $params['form_conditions'];
                }
                $form->setConditions($this->sanitizeConditions($conditions));
            }

            if (!$form->save()) {
                return $this->response(null, __('Failed to update custom form', 'kivicare-pro'), false, 500);
            }

            return $this->response($this->formatCustomForm($form), __('Custom form updated successfully', 'kivicare-pro'));
        } catch (\Exception $e) {
            return $this->response(['error' => $e->getMessage()], __('Failed to update custom form', 'kivicare-pro'), false, 500);
        }
    }

    /**
     * Delete a custom form.
     *
     * @param WP_REST_Request $request The REST API request object.
     * @return WP_REST_Response Returns a response with the deleted form ID on success.
     */
    public function deleteCustomForm(WP_REST_Request $request): WP_REST_Response
    {
        try {
            $id = $request->get_param('id');
            $form = KCCustomForm::find($id);

            if (!$form) {
                return $this->response(null, __('Custom form not found', 'kivicare-pro'), false, 404);
            }

            if (!$form->delete()) {
                return $this->response(null, __('Failed to delete custom form', 'kivicare-pro'), false, 500);
            }

            return $this->response(['id' => $id], __('Custom form deleted successfully', 'kivicare-pro'));
        } catch (\Exception $e) {
            return $this->response(['error' => $e->getMessage()], __('Failed to delete custom form', 'kivicare-pro'), false, 500);
        }
    }

    /**
     * Bulk delete custom forms.
     *
     * @param WP_REST_Request $request The REST API request object.
     * @return WP_REST_Response Returns success message with count of deleted forms.
     */
    public function bulkDeleteCustomForms(WP_REST_Request $request): WP_REST_Response
    {
        try {
            $ids = $request->get_param('ids');

            if (empty($ids) || !is_array($ids)) {
                return $this->response(null, __('Invalid IDs provided', 'kivicare-pro'), false, 400);
            }

            $deleted = KCCustomForm::query()->whereIn('id', $ids)->delete();

            return $this->response([
                'deleted_count' => $deleted,
                'ids' => $ids
            ], __('Custom forms deleted successfully', 'kivicare-pro'));
        } catch (\Exception $e) {
            return $this->response(['error' => $e->getMessage()], __('Failed to delete custom forms', 'kivicare-pro'), false, 500);
        }
    }

    /**
     * Update custom form status.
     *
     * @param WP_REST_Request $request The REST API request object.
     * @return WP_REST_Response Returns the updated form data.
     */
    public function updateCustomFormStatus(WP_REST_Request $request): WP_REST_Response
    {
        try {
            $id = $request->get_param('id');
            $status = $request->get_param('status');

            $form = KCCustomForm::find($id);
            if (!$form) {
                return $this->response(null, __('Custom form not found', 'kivicare-pro'), false, 404);
            }

            $form->status = $status;
            $form->updated_at = current_time('mysql');

            if (!$form->save()) {
                return $this->response(null, __('Failed to update form status', 'kivicare-pro'), false, 500);
            }

            return $this->response($this->formatCustomForm($form), __('Form status updated successfully', 'kivicare-pro'));
        } catch (\Exception $e) {
            return $this->response(['error' => $e->getMessage()], __('Failed to update form status', 'kivicare-pro'), false, 500);
        }
    }

    /**
     * Format custom form data for API response.
     *
     * @param KCCustomForm $form The form model instance.
     * @return array Formatted form data.
     */
    private function formatCustomForm($form)
    {
        $conditions = $form->getConditions();
        return [
            'id' => $form->id,
            'name' => $form->getName(),
            'moduleType' => [
                'value' => $form->module_type,
                'label' => match ($form->module_type) {
                    'appointment_module' => __('Appointment Module', 'kivicare-pro'),
                    'patient_encounter_module' => __('Encounter Module', 'kivicare-pro'),
                    'patient_module' => __('Patient Module', 'kivicare-pro'),
                    'doctor_module' => __('Doctor Module', 'kivicare-pro'),
                    default => $form->module_type,
                },
            ],
            'status' => [
                'value' => $form->status ? 'active' : 'inactive',
                'label' => $form->status ? __('Active', 'kivicare-pro') : __('Inactive', 'kivicare-pro'),
            ],
            'fields' => $form->getFields(),
            'conditions' => $conditions,
            'added_by' => $form->added_by,
            'created_at' => $form->created_at,
        ];
    }

    /**
     * Get date range for statistics.
     *
     * @param string $period The period (7days, 30days, 90days, 1year).
     * @return array Start and end dates.
     */
    private function getDateRange($period)
    {
        $now = current_time('mysql');
        $end = date('Y-m-d H:i:s', strtotime($now));

        switch ($period) {
            case '7days':
                $start = date('Y-m-d H:i:s', strtotime('-7 days', strtotime($now)));
                break;
            case '90days':
                $start = date('Y-m-d H:i:s', strtotime('-90 days', strtotime($now)));
                break;
            case '1year':
                $start = date('Y-m-d H:i:s', strtotime('-1 year', strtotime($now)));
                break;
            case '30days':
            default:
                $start = date('Y-m-d H:i:s', strtotime('-30 days', strtotime($now)));
                break;
        }

        return ['start' => $start, 'end' => $end];
    }

    /**
     * Get form data for a specific module.
     *
     * @param int $formId The form ID.
     * @param int $moduleId The module ID.
     * @return array|null Form data or null if not found.
     */
    private function getFormDataForModule($formId, $moduleId)
    {
        $formData = KCCustomFormData::query()
            ->where('form_id', (int) $formId)
            ->where('module_id', (int) $moduleId)
            ->first();

        if ($formData) {
            return json_decode($formData->formData, true);
        }

        return null;
    }

    /**
     * Check if a module belongs to a specific clinic.
     *
     * @param string $moduleType The module type (appointment_module, patient_encounter_module, etc.)
     * @param int $moduleId The module ID
     * @param array $clinicIds The clinic ID to check against
     * @return bool Whether the module belongs to the clinic
     */
    private function checkModuleBelongsToClinic($moduleType, $moduleId, $clinicIds)
    {
        switch ($moduleType) {
            case 'appointment_module':
                $appointment = KCAppointment::find($moduleId);
                return $appointment && in_array($appointment->clinicId, $clinicIds);

            case 'patient_encounter_module':
                $encounter = KCPatientEncounter::find($moduleId);
                return $encounter && in_array($encounter->clinicId, $clinicIds);

            case 'patient_module':
                // Check patient-clinic mapping table
                $patientMapping = KCPatientClinicMapping::query()
                    ->where('patient_id', $moduleId)
                    ->whereIn('clinic_id', $clinicIds)
                    ->first();
                return $patientMapping !== null;

            case 'doctor_module':
                // Check doctor-clinic mapping table
                $doctorMapping = KCDoctorClinicMapping::query()
                    ->where('doctor_id', $moduleId)
                    ->whereIn('clinic_id', $clinicIds)
                    ->first();
                return $doctorMapping !== null;

            default:
                return true; // For unknown module types, allow access
        }
    }
    /**
     * Submit custom form data with comprehensive validation.
     * 
     * This method validates form submission based on the same logic used in rendering forms:
     * - Clinic access validation 
     * - Role-based access control
     * - Show mode validation (appointment vs encounter)
     * - Module type compatibility checks
     *
     * @param WP_REST_Request $request The REST API request object.
     * @return WP_REST_Response Returns success response on valid submission.
     */
    public function submitCustomForm(WP_REST_Request $request): WP_REST_Response
    {
        try {
            $formId = $request->get_param('form_id');
            $moduleId = $request->get_param('module_id');
            $moduleType = $request->get_param('module_type');
            $formData = $request->get_param('form_data');

            // Validate that the form exists and is active
            $form = KCCustomForm::find($formId);
            if (!$form) {
                return $this->response(null, __('Custom form not found', 'kivicare-pro'), false, 404);
            }

            if (!$form->status) {
                return $this->response(null, __('Custom form is inactive', 'kivicare-pro'), false, 400);
            }

            // Get current user role for validation
            $currentRole = $this->kcbase->getLoginUserRole();
            $conditions = $form->getConditions();

            // Determine the actual module type if not provided
            if (empty($moduleType)) {
                // Try to infer module type from form configuration
                $moduleType = $form->module_type;
            }

            // Handle appointment/encounter module logic (same as render)
            $appointmentId = null;
            $actualModuleId = $moduleId;
            
            if ($form->module_type === 'appointment_module') {
                if (!empty($conditions['show_mode'])) {
                    $hasEncounter = collect($conditions['show_mode'])
                        ->first(function ($mode) {
                            return $mode['id'] === 'encounter';
                        });

                    // If form is configured for encounter mode and we have an encounter ID
                    if ($hasEncounter && $moduleType === 'patient_encounter_module') {
                        $encounter = KCPatientEncounter::find($moduleId);
                        if ($encounter) {
                            $appointmentId = $encounter->appointmentId;
                            $actualModuleId = $appointmentId; // Use appointment ID for storage
                        } else {
                            return $this->response(null, __('Encounter not found', 'kivicare-pro'), false, 404);
                        }
                    }
                }
            }

            // Validate clinic access (same logic as render)
            $clinicAllowed = empty($conditions['clinics']) || $moduleId === null;
            if (!$clinicAllowed && !empty($moduleId)) {
                // For encounter modules that map to appointments, check against the appointment
                $checkModuleId = ($form->module_type === 'appointment_module' && !is_null($appointmentId)) 
                    ? $appointmentId 
                    : $moduleId;
                
                $clinicAllowed = $this->checkModuleBelongsToClinic(
                    $form->module_type, 
                    $checkModuleId, 
                    $conditions['clinics']
                );
            }

            if (!$clinicAllowed) {
                return $this->response(null, __('Access denied: Form not available for this clinic', 'kivicare-pro'), false, 403);
            }

            // Validate role access (same logic as render)
            $roleAllowed = empty($conditions['roles']) || in_array($currentRole, $conditions['roles']);
            if (!$roleAllowed) {
                return $this->response(null, __('Access denied: Insufficient role permissions', 'kivicare-pro'), false, 403);
            }

            // Validate show mode (same logic as render)
            $showModeAllowed = true;
            if ($form->module_type === 'appointment_module') {
                if (!empty($conditions['show_mode'])) {
                    $showModes = collect($conditions['show_mode'])->pluck('id')->toArray();
                    
                    if ($moduleType === 'appointment_module') {
                        // For appointment module, check if appointment mode is allowed
                        $showModeAllowed = in_array('appointment', $showModes);
                    } elseif ($moduleType === 'patient_encounter_module') {
                        // For encounter module, check if encounter mode is allowed  
                        $showModeAllowed = in_array('encounter', $showModes);
                    }
                }
            }

            if (!$showModeAllowed) {
                return $this->response(null, __('Access denied: Form not available for this module type', 'kivicare-pro'), false, 403);
            }

            // Validate module type compatibility
            if ($moduleType === 'patient_encounter_module' && $form->module_type !== 'appointment_module' && $form->module_type !== 'patient_encounter_module') {
                return $this->response(null, __('Form is not compatible with encounter module', 'kivicare-pro'), false, 400);
            }

            // Check if record already exists for this form and module
            $existingRecord = KCCustomFormData::query()
                ->where('form_id', (int) $formId)
                ->where('module_id', (int) $actualModuleId)
                ->first();

            if ($existingRecord) {
                // Update existing record
                $existingRecord->formData = wp_json_encode($formData);
                $existingRecord->updated_at = current_time('mysql');
                $existingRecord->save();
            } else {
                // Create new record
                $customFormEntry = new KCCustomFormData();
                $customFormEntry->formId = (int) $formId;
                $customFormEntry->formData = wp_json_encode($formData);
                $customFormEntry->moduleId = (int) $actualModuleId;
                $customFormEntry->created_at = current_time('mysql');
                $customFormEntry->save();
            }

            return $this->response([
                'form_id' => $formId,
                'module_id' => $moduleId,
                'actual_module_id' => $actualModuleId,
                'module_type' => $moduleType,
                'saved' => true
            ], __('Custom form data saved successfully', 'kivicare-pro'));

        } catch (\Exception $e) {
            return $this->response(['error' => $e->getMessage()], __('Failed to save custom form data', 'kivicare-pro'), false, 500);
        }
    }

    /**
     * List all custom forms for admin.
     *
     * @param WP_REST_Request $request The REST API request object.
     * @return WP_REST_Response Returns a response containing an array of custom forms on success.
     */
    public function getCustomFormsAdmin(WP_REST_Request $request): WP_REST_Response
    {
        try {
            $params = $request->get_params();
            $page = isset($params['page']) ? (int) $params['page'] : 1;
            if ($page <= 0) $page = 1;

            $perPageParam = isset($params['perPage']) ? $params['perPage'] : 10;
            $showAll = (strtolower((string) $perPageParam) === 'all');
            $perPage = $showAll ? null : (int) $perPageParam;
            if (!$showAll && $perPage <= 0) $perPage = 10;

            $query = KCCustomForm::query();

            // Apply filters
            if (!empty($params['search'])) {
                $query->where('name', 'LIKE', '%' . $params['search'] . '%');
            }

            if (isset($params['status']) && $params['status'] !== '') {
                $query->where('status', '=', (int) $params['status']);
            }

            if (!empty($params['module_type'])) {
                $query->where('module_type', '=', $params['module_type']);
            }

            if ($this->kcbase->getClinicAdminRole() === $this->kcbase->getLoginUserRole()) {
                $query->where('added_by', '=', get_current_user_id());
            }

            $total = $query->count();

            if ($showAll) {
                $perPage = $total > 0 ? $total : 1;
                $page = 1;
            }

            $totalPages = $perPage > 0 ? (int) ceil($total / $perPage) : 1;
            $offset = ($page - 1) * $perPage;

            $forms = $query->offset($offset)->limit($perPage)->get();

            $data = [];
            foreach ($forms as $form) {
                $data[] = $this->formatCustomForm($form);
            }

            return $this->response([
                'forms' => $data,
                'pagination' => [
                    'total'       => $total,
                    'perPage'     => $perPage,
                    'currentPage' => $page,
                    'lastPage'    => $totalPages,
                ],
            ], __('Custom forms retrieved successfully', 'kivicare-pro'));
        } catch (\Exception $e) {
            return $this->response(['error' => $e->getMessage()], __('Failed to retrieve custom forms', 'kivicare-pro'), false, 500);
        }
    }

    /**
     * List all custom forms for rendering.
     *
     * @param WP_REST_Request $request The REST API request object.
     * @return WP_REST_Response Returns a response containing an array of custom forms on success.
     */
    public function getCustomFormsRender(WP_REST_Request $request): WP_REST_Response
    {
        try {
            $params = $request->get_params();
            $query = KCCustomForm::query();
            $query->where('status', '=', 1);


            $query->where(function ($q) use ($params) {
                if ($params['module_type'] == 'patient_encounter_module') {
                    $q->whereIn('module_type', ['appointment_module', 'patient_encounter_module']);
                } else {
                    $q->Where('module_type', '=', $params['module_type']);
                }
            });

            $appointmentId = null;
            if (!empty($params['module_id']) && $params['module_type'] == 'patient_encounter_module') {
                $encounter = KCPatientEncounter::find($params['module_id']);
                if ($encounter) {
                    $appointmentId = $encounter->appointmentId;
                }
            }

            // Remove sensitive fields
            $forms = $query->get();


            $currentRole = $this->kcbase->getLoginUserRole();


            $data = $forms
                ->filter(function ($form) use ($currentRole, $params) {
                    $conditions = $form->getConditions();


                    // Check clinic condition: allow if no clinics specified or module belongs to clinic
                    $moduleId = $params['module_id'] ?? null;
                    $clinicAllowed = empty($conditions['clinics']) || empty($moduleId);
                    if (!$clinicAllowed && !empty($moduleId)) {
                        $clinicAllowed = $this->checkModuleBelongsToClinic($form->module_type, $moduleId, $conditions['clinics']);
                    }
                    
                    // Check role condition: allow if no roles specified or current role is in the list
                    $roleAllowed = ($params['widgetType'] === 'phpWidget') || empty($conditions['roles']) || in_array($currentRole, $conditions['roles']);

                    // Check show_mode condition based on module type
                    $showModeAllowed = true;
                    if ($form->module_type === 'appointment_module') {
                        if (!empty($conditions['show_mode'])) {
                            $showModes = collect($conditions['show_mode'])->pluck('id')->toArray();
                            
                            if ($params['module_type'] === 'appointment_module') {
                                // For appointment module, check if appointment mode is allowed
                                $showModeAllowed = in_array('appointment', $showModes);
                            } elseif ($params['module_type'] === 'patient_encounter_module') {
                                // For encounter module, check if encounter mode is allowed  
                                $showModeAllowed = in_array('encounter', $showModes);
                            }
                        }
                    }
                    
                  
                    return $clinicAllowed && $roleAllowed && $showModeAllowed;
                })
                ->map(function ($form) use ($params, $appointmentId) {
                    $formData = $this->formatCustomForm($form);

                    // Include form data if module_id is provided
                    if (!empty($params['module_id'])) {
                        if ($form->module_type == 'appointment_module' && !is_null($appointmentId)) {
                            $formData['form_data'] = $this->getFormDataForModule($form->id, (int) $appointmentId);
                        } else {
                            $formData['form_data'] = $this->getFormDataForModule($form->id, $params['module_id']);
                        }
                    }

                    return $formData;
                })->values();

            return $this->response([
                'forms' => $data,
            ], __('Custom forms retrieved successfully', 'kivicare-pro'));
        } catch (\Exception $e) {
            return $this->response(['error' => $e->getMessage()], __('Failed to retrieve custom forms', 'kivicare-pro'), false, 500);
        }
    }

    /**
     * Sanitize custom form fields configuration.
     * 
     * @param array $fields The fields configuration array.
     * @return array Sanitized fields configuration.
     */
    private function sanitizeFields($fields)
    {
        if (!is_array($fields)) {
            return [];
        }

        return array_map(function ($field) {
            $sanitized = [];
            foreach ($field as $key => $value) {
                if ($key === 'options' && is_array($value)) {
                    $sanitized['options'] = array_map('sanitize_text_field', $value);
                } elseif (is_array($value)) {
                    $sanitized[$key] = array_map('sanitize_text_field', $value);
                } elseif (is_string($value)) {
                    $sanitized[$key] = sanitize_text_field($value);
                } else {
                    $sanitized[$key] = $value;
                }
            }
            return $sanitized;
        }, $fields);
    }

    /**
     * Sanitize conditions object.
     * 
     * @param array $conditions The conditions array.
     * @return array Sanitized conditions.
     */
    private function sanitizeConditions($conditions)
    {
        if (!is_array($conditions)) {
            return [];
        }

        $sanitized = [];

        foreach ($conditions as $key => $value) {
            if (in_array($key, ['show_mode', 'appointment_status']) && is_array($value)) {
                $sanitized[$key] = array_map(function ($item) {
                    return is_array($item) ? array_map('sanitize_text_field', $item) : [];
                }, $value);
            } elseif ($key === 'clinics' && is_array($value)) {
                $sanitized['clinics'] = array_map('absint', $value);
            } elseif ($key === 'form_conditions' && is_array($value)) {
                $operators = ['=', '!=', '>', '<', 'contains', 'is_empty', 'is_not_empty', 'not_contains', 'starts_with', 'not_starts_with', 'ends_with', 'not_ends_with'];
                $actionTypes = ['show', 'hide', 'required', 'optional', 'enable', 'disable'];
                $logicOperators = ['AND', 'OR', 'NOR', 'NOT'];

                $sanitized['form_conditions'] = array_map(function ($fc) use ($operators, $actionTypes, $logicOperators) {
                    if (!is_array($fc)) return [];
                    $sanitizedFc = [];
                    foreach ($fc as $fcKey => $fcValue) {
                        if ($fcKey === 'conditions' && is_array($fcValue)) {
                            $sanitizedFc['conditions'] = array_map(function ($c) use ($operators) {
                                if (!is_array($c)) return [];
                                $sanitizedC = array_map('sanitize_text_field', $c);
                                $sanitizedC['operator'] = in_array($sanitizedC['operator'] ?? '', $operators) ? $sanitizedC['operator'] : '==';
                                return $sanitizedC;
                            }, $fcValue);
                        } elseif ($fcKey === 'actions' && is_array($fcValue)) {
                            $sanitizedFc['actions'] = array_map(function ($a) use ($actionTypes) {
                                if (!is_array($a)) return [];
                                $sanitizedA = array_map('sanitize_text_field', $a);
                                $sanitizedA['type'] = in_array($sanitizedA['type'] ?? '', $actionTypes) ? $sanitizedA['type'] : 'show';
                                return $sanitizedA;
                            }, $fcValue);
                        } elseif ($fcKey === 'logic' && is_string($fcValue)) {
                            $logicValue = strtoupper(sanitize_text_field($fcValue));
                            $sanitizedFc['logic'] = in_array($logicValue, $logicOperators) ? $logicValue : 'AND';
                        } elseif (is_array($fcValue)) {
                            $sanitizedFc[$fcKey] = array_map('sanitize_text_field', $fcValue);
                        } elseif (is_string($fcValue)) {
                            $sanitizedFc[$fcKey] = sanitize_text_field($fcValue);
                        } else {
                            $sanitizedFc[$fcKey] = $fcValue;
                        }
                    }
                    return $sanitizedFc;
                }, $value);
            } elseif (is_array($value)) {
                $sanitized[$key] = array_map('sanitize_text_field', $value);
            } elseif (is_string($value)) {
                $sanitized[$key] = sanitize_text_field($value);
            } else {
                $sanitized[$key] = $value;
            }
        }

        return $sanitized;
    }
}
