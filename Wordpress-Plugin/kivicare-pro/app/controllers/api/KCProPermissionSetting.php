<?php

namespace KCProApp\controllers\api;

use App\controllers\api\SettingsController;
use WP_REST_Request;
use WP_REST_Response;
use WP_Error;

defined('ABSPATH') or die('Something went wrong');

/**
 * Class PermissionSetting
 * 
 * @package App\controllers\api\SettingsController
 */
class KCProPermissionSetting extends SettingsController
{
    private static $instance = null;

    protected $route = 'settings/permission-setting';


    public function __construct()
    {
        parent::__construct();
    }

    public static function getInstance(): self
    {
        if (self::$instance === null) {
            self::$instance = new self();
        }
        return self::$instance;
    }


    /**
     * Register routes for this controller
     */
    public function registerRoutes()
    {
        $this->registerRoute('/' . $this->route, [
            'methods' => 'GET',
            'callback' => [$this, 'getPermissionSetting'],
            'permission_callback' => [$this, 'checkPermission'],
            //'args' => $this->getSettingsEndpointArgs()
        ]);
        // Update Permission Setting
        $this->registerRoute('/' . $this->route, [
            'methods' => ['PUT', 'POST'],
            'callback' => [$this, 'updatePermissionSetting'],
            'permission_callback' => [$this, 'checkUpdatePermission'],
            // 'args'     => $this->getSettingFieldSchema()['permission_setting']
        ]);
    }

    /**
     * Get default roles
     * 
     * @return array
     */
    private function getDefaultRoles(): array
    {
        return [
            ['key' => 'administrator', 'name' => __('Administrator', 'kivicare-pro')],
            ['key' => 'clinic_admin', 'name' => __('Clinic Admin', 'kivicare-pro')],
            ['key' => 'doctor', 'name' => __('Doctor', 'kivicare-pro')],
            ['key' => 'patient', 'name' => __('Patient', 'kivicare-pro')],
            ['key' => 'receptionist', 'name' => __('Receptionist', 'kivicare-pro')]
        ];
    }

    /**
     * Build default permissions
     * 
     * @return array
     */
    public function buildDefaultPermissions(): array
    {
        $default_roles = $this->getDefaultRoles();

        // Define role permissions (copied from frontend structure)
        $role_permissions = [
            'administrator' => [
                'permissions' => [
                    'appointment_module' => [
                        'appointment_list',
                        'appointment_add',
                        'appointment_edit',
                        'appointment_view',
                        'appointment_delete',
                        'appointment_export',
                        'patient_appointment_status_change'
                    ],
                    'billing_module' => [
                        'patient_bill_list',
                        'patient_bill_add',
                        'patient_bill_edit',
                        'patient_bill_view',
                        'patient_bill_export'
                    ],
                    'clinic_module' => [
                        'clinic_list',
                        'clinic_add',
                        'clinic_edit',
                        'clinic_delete',
                        'clinic_profile',
                        'clinic_resend_credential',
                        'clinic_export'
                    ],
                    'clinical_detail_module' => [
                        'medical_records_list',
                        'medical_records_add',
                        'medical_records_delete'
                    ],
                    'custom_field_module' => [
                        'custom_field_list',
                        'custom_field_add',
                        'custom_field_edit',
                        'custom_field_delete',
                        'custom_field_export'
                    ],
                    'dashboard_module' => [
                        'dashboard_total_patient',
                        'dashboard_total_doctor',
                        'dashboard_total_appointment',
                        'dashboard_total_revenue',
                        'dashboard_total_service',
                        'dashboard_total_clinic',
                    ],
                    'doctor_module' => [
                        'doctor_list',
                        'doctor_add',
                        'doctor_edit',
                        'doctor_delete',
                        'doctor_resend_credential',
                        'patient_review_get',
                        'doctor_session',
                        'doctor_service',
                        'doctor_export'
                    ],
                    'encounter_module' => [
                        'patient_encounter_list',
                        'patient_encounter_add',
                        'patient_encounter_edit',
                        'patient_encounter_view',
                        'patient_encounter_view_billing',
                        'patient_encounter_delete',
                        'patient_encounter_export'
                    ],
                    'encounters_template_module' => [
                        'encounters_template_list',
                        'encounters_template_add',
                        'encounters_template_edit',
                        'encounters_template_view',
                        'encounters_template_delete'
                    ],
                    'holiday_module' => [
                        'clinic_schedule',
                        'clinic_schedule_add',
                        'clinic_schedule_edit',
                        'clinic_schedule_delete',
                        'clinic_schedule_export'
                    ],
                    'other_module' => [
                        'medical_records_view',
                        'patient_bill_delete',
                    ],
                    'tax_module' => [
                        'tax_list',
                        'tax_add',
                        'tax_edit',
                        'tax_delete',
                        'tax_export',
                    ],
                    'custom_form_module' => [
                        'custom_form_list',
                        'custom_form_add',
                        'custom_form_edit',
                        'custom_form_view',
                        'custom_form_delete',
                        'change_password',
                    ],
                    'patient_module' => [
                        'patient_list',
                        'patient_add',
                        'patient_edit',
                        'patient_delete',
                        'patient_profile',
                        'patient_resend_credential',
                        'patient_export',
                        'patient_appointment',
                        'patient_appointment_report',
                        'patient_encounter'
                    ],
                    'followup_module' => [
                        'followup_list',
                        'followup_add',
                        'followup_view',
                        'followup_delete',
                        'followup_cancel',
                        'followup_schedule',
                        'followup_create_clinical',
                        'followup_update_clinical'
                    ],
                    'chain_module' => [
                        'chain_manage_clinical',
                        'chain_admin_override',
                        'chain_read_all',
                        'chain_configure'
                    ],
                    'patient_report_module' => [
                        'patient_report',
                        'patient_report_add',
                        'patient_report_view',
                        'patient_report_delete',
                        'patient_report_edit'
                    ],
                    'prescription_module' => [
                        'prescription_list',
                        'prescription_add',
                        'prescription_edit',
                        'prescription_delete',
                        'prescription_export'
                    ],
                    'receptionist_module' => [
                        'receptionist_list',
                        'receptionist_add',
                        'receptionist_edit',
                        'receptionist_delete',
                        'receptionist_resend_credential',
                        'receptionist_export'
                    ],
                    'service_module' => [
                        'service_list',
                        'service_add',
                        'service_edit',
                        'service_delete',
                        'service_export'
                    ],
                    'session_module' => [
                        'doctor_session_list',
                        'doctor_session_add',
                        'doctor_session_edit',
                        'doctor_session_delete',
                        'doctor_session_export'
                    ],
                    'static_data_module' => [
                        'static_data_list',
                        'static_data_add',
                        'static_data_edit',
                        'static_data_export'
                    ]
                ]
            ],
            'clinic_admin' => [
                'permissions' => [
                    'appointment_module' => [
                        'appointment_list',
                        'appointment_add',
                        'appointment_edit',
                        'appointment_view',
                        'appointment_delete',
                        'appointment_export',
                        'patient_appointment_status_change'
                    ],
                    'billing_module' => [
                        'patient_bill_list',
                        'patient_bill_add',
                        'patient_bill_edit',
                        'patient_bill_view',
                        'patient_bill_export'
                    ],
                    'clinical_detail_module' => [
                        'medical_records_list',
                        'medical_records_add',
                        'medical_records_delete'
                    ],
                    'custom_field_module' => [
                        'custom_field_list',
                        'custom_field_add',
                        'custom_field_edit',
                        'custom_field_delete',
                        'custom_field_export'
                    ],
                    'dashboard_module' => [
                        'dashboard_total_patient',
                        'dashboard_total_doctor',
                        'dashboard_total_appointment',
                        'dashboard_total_revenue',
                        'dashboard_total_clinic',
                        'dashboard',
                        'dashboard_total_service'
                    ],
                    'doctor_module' => [
                        'doctor_list',
                        'doctor_add',
                        'doctor_edit',
                        'doctor_delete',
                        'doctor_resend_credential',
                        'patient_review_get',
                        'doctor_session',
                        'doctor_service',
                        'doctor_export'
                    ],
                    'encounter_module' => [
                        'patient_encounter_list',
                        'patient_encounter_add',
                        'patient_encounter_edit',
                        'patient_encounter_view',
                        'patient_encounter_delete',
                        'patient_encounter_export',
                        'patient_encounter_view_billing'
                    ],
                    'encounters_template_module' => [
                        'encounters_template_list',
                        'encounters_template_add',
                        'encounters_template_edit',
                        'encounters_template_view',
                        'encounters_template_delete'
                    ],
                    'holiday_module' => [
                        'clinic_schedule',
                        'clinic_schedule_add',
                        'clinic_schedule_edit',
                        'clinic_schedule_delete',
                        'clinic_schedule_export'
                    ],
                    'other_module' => [
                        'medical_records_view',
                        'patient_bill_delete',
                    ],
                    'tax_module' => [
                        'tax_list',
                        'tax_add',
                        'tax_edit',
                        'tax_delete',
                        'tax_export',
                    ],
                    'custom_form_module' => [
                        'custom_form_list',
                        'custom_form_add',
                        'custom_form_edit',
                        'custom_form_view',
                        'custom_form_delete',
                        'change_password',
                    ],
                    'patient_module' => [
                        'patient_list',
                        'patient_add',
                        'patient_edit',
                        'patient_delete',
                        'patient_profile',
                        'patient_resend_credential',
                        'patient_export',
                        'patient_appointment',
                        'patient_appointment_report',
                        'patient_encounter'
                    ],
                    'followup_module' => [
                        'followup_list',
                        'followup_add',
                        'followup_view',
                        'followup_delete',
                        'followup_cancel',
                        'followup_schedule'
                    ],
                    'chain_module' => [
                        'chain_admin_override',
                        'chain_read_all'
                    ],
                    'patient_report_module' => [
                        'patient_report',
                        'patient_report_add',
                        'patient_report_view',
                        'patient_report_delete',
                        'patient_report_edit'
                    ],
                    'prescription_module' => [
                        'prescription_list',
                        'prescription_add',
                        'prescription_edit',
                        'prescription_delete',
                        'prescription_export'
                    ],
                    'receptionist_module' => [
                        'receptionist_list',
                        'receptionist_add',
                        'receptionist_edit',
                        'receptionist_delete',
                        'receptionist_resend_credential',
                        'receptionist_export'
                    ],
                    'service_module' => [
                        'service_list',
                        'service_add',
                        'service_edit',
                        'service_delete',
                        'service_export'
                    ],
                    'session_module' => [
                        'doctor_session_list',
                        'doctor_session_add',
                        'doctor_session_edit',
                        'doctor_session_delete',
                        'doctor_session_export'
                    ],
                    'static_data_module' => [
                        'static_data_list',
                        'static_data_add',
                        'static_data_edit',
                        'static_data_export'
                    ]
                ]
            ],
            'doctor' => [
                'permissions' => [
                    'appointment_module' => [
                        'appointment_list',
                        'appointment_add',
                        'appointment_edit',
                        'appointment_view',
                        'appointment_delete',
                        'appointment_export',
                        'patient_appointment_status_change'
                    ],
                    'billing_module' => [
                        'patient_bill_list',
                        'patient_bill_add',
                        'patient_bill_edit',
                        'patient_bill_view',
                        'patient_bill_export'
                    ],
                    'clinical_detail_module' => [
                        'medical_records_list',
                        'medical_records_add',
                        'medical_records_delete'
                    ],
                    'dashboard_module' => [
                        'dashboard_total_patient',
                        'dashboard_total_appointment',
                        'dashboard_total_today_appointment',
                        'dashboard_total_service',
                        'dashboard_total_clinic',
                        'dashboard'
                    ],
                    'encounter_module' => [
                        'patient_encounter_list',
                        'patient_encounter_add',
                        'patient_encounter_edit',
                        'patient_encounter_view',
                        'patient_encounter_delete',
                        'patient_encounter_export',
                        'patient_encounter_view_billing'
                    ],
                    'encounters_template_module' => [
                        'encounters_template_list',
                        'encounters_template_add',
                        'encounters_template_edit',
                        'encounters_template_view',
                        'encounters_template_delete'
                    ],
                    'holiday_module' => [
                        'clinic_schedule',
                        'clinic_schedule_add',
                        'clinic_schedule_edit',
                        'clinic_schedule_delete',
                        'clinic_schedule_export'
                    ],
                    'other_module' => [
                        'dashboard',
                        'change_password',
                        'medical_records_view',
                    ],
                    'patient_module' => [
                        'patient_list',
                        'patient_add',
                        'patient_edit',
                        'patient_delete',
                        'patient_profile',
                        'patient_resend_credential',
                        'patient_export',
                        'patient_appointment',
                        'patient_appointment_report',
                        'patient_encounter'
                    ],
                    'followup_module' => [
                        'followup_list',
                        'followup_add',
                        'followup_view',
                        'followup_delete',
                        'followup_cancel',
                        'followup_schedule',
                        'followup_create_clinical',
                        'followup_update_clinical'
                    ],
                    'chain_module' => [
                        'chain_manage_clinical'
                    ],
                    'patient_report_module' => [
                        'patient_report',
                        'patient_report_add',
                        'patient_report_view',
                        'patient_report_delete',
                        'patient_report_edit'
                    ],
                    'prescription_module' => [
                        'prescription_list',
                        'prescription_add',
                        'prescription_edit',
                        'prescription_delete',
                        'prescription_export'
                    ],
                    'service_module' => [
                        'service_list',
                        'service_add',
                        'service_edit',
                        'service_delete',
                        'service_export'
                    ],
                    'session_module' => [
                        'doctor_session_list',
                        'doctor_session_add',
                        'doctor_session_edit',
                        'doctor_session_delete',
                        'doctor_session_export'
                    ],
                    'static_data_module' => [
                        'static_data_list',
                        'static_data_add',
                        'static_data_edit',
                        'static_data_export'
                    ]
                ]
            ],
            'patient' => [
                'permissions' => [
                    'appointment_module' => [
                        'appointment_list',
                        'appointment_add',
                        'appointment_edit',
                        'appointment_view',
                        'appointment_cancel',
                        'appointment_export'
                    ],
                    'billing_module' => [
                        'patient_bill_list',
                        'patient_bill_view',
                        'patient_bill_export'
                    ],
                    'clinical_detail_module' => [
                        'medical_records_list'
                    ],
                    'encounter_module' => [
                        'patient_encounter_list',
                        'patient_encounter_view',
                        'patient_encounter_export',
                        'patient_encounter_view_billing'
                    ],
                    'other_module' => [
                        'dashboard',
                        'change_password',
                        'medical_records_view',
                        'home_page'
                    ],
                    'patient_module' => [
                        'patient_profile',
                        'patient_clinic',
                        'patient_edit'
                    ],
                    'patient_report_module' => [
                        'patient_report',
                        'patient_report_add',
                        'patient_report_view',
                        'patient_report_delete',
                        'patient_report_edit'
                    ],
                    'patient_review_module' => [
                        'patient_review_add',
                        'patient_review_edit',
                        'patient_review_get',
                        'patient_review_delete'
                    ],
                    'prescription_module' => [
                        'prescription_list',
                        'prescription_export'
                    ],
                    'followup_module' => [
                        'followup_list',
                        'followup_view',
                        'followup_add',
                        'followup_delete',
                        'followup_cancel',
                        'followup_schedule'
                    ]
                ]
            ],
            'receptionist' => [
                'permissions' => [
                    'appointment_module' => [
                        'appointment_list',
                        'appointment_add',
                        'appointment_edit',
                        'appointment_view',
                        'appointment_delete',
                        'appointment_export',
                        'patient_appointment_status_change'
                    ],
                    'billing_module' => [
                        'patient_bill_list',
                        'patient_bill_add',
                        'patient_bill_edit',
                        'patient_bill_view',
                        'patient_bill_export'
                    ],
                    'clinical_detail_module' => [
                        'medical_records_list',
                        'medical_records_add',
                        'medical_records_delete'
                    ],
                    'dashboard_module' => [
                        'dashboard_total_patient',
                        'dashboard_total_doctor',
                        'dashboard_total_appointment',
                        'dashboard_total_revenue',
                        'dashboard_total_clinic',
                        'dashboard',
                        'dashboard_total_service',
                        'dashboard_total_today_appointment',
                    ],
                    'doctor_module' => [
                        'doctor_list',
                        'doctor_add',
                        'doctor_edit',
                        'doctor_delete',
                        'doctor_resend_credential',
                        'doctor_export',
                        'patient_review_get',
                        'doctor_session',
                        'doctor_service',
                    ],
                    'encounter_module' => [
                        'patient_encounter_list',
                        'patient_encounter_add',
                        'patient_encounter_edit',
                        'patient_encounter_view',
                        'patient_encounter_delete',
                        'patient_encounter_export',
                        'patient_encounter_view_billing'
                    ],
                    'encounters_template_module' => [
                        'encounters_template_list',
                        'encounters_template_add',
                        'encounters_template_edit',
                        'encounters_template_view',
                        'encounters_template_delete'
                    ],
                    'holiday_module' => [
                        'clinic_schedule',
                        'clinic_schedule_add',
                        'clinic_schedule_edit',
                        'clinic_schedule_delete',
                        'clinic_schedule_export'
                    ],
                    'other_module' => [
                        'dashboard',
                        'change_password',
                        'medical_records_view',
                    ],
                    'patient_module' => [
                        'patient_list',
                        'patient_add',
                        'patient_edit',
                        'patient_delete',
                        'patient_profile',
                        'patient_resend_credential',
                        'patient_export',
                        'patient_appointment',
                        'patient_appointment_report',
                        'patient_encounter'
                    ],
                    'followup_module' => [
                        'followup_list',
                        'followup_add',
                        'followup_view',
                        'followup_delete',
                        'followup_cancel',
                        'followup_schedule'
                    ],
                    'chain_module' => [
                        'chain_read_all'
                    ],
                    'patient_report_module' => [
                        'patient_report',
                        'patient_report_add',
                        'patient_report_view',
                        'patient_report_delete',
                        'patient_report_edit'
                    ],
                    'prescription_module' => [
                        'prescription_list',
                        'prescription_add',
                        'prescription_edit',
                        'prescription_delete',
                        'prescription_export'
                    ],
                    'service_module' => [
                        'service_list',
                        'service_add',
                        'service_edit',
                        'service_delete',
                        'service_export'
                    ],
                    'session_module' => [
                        'doctor_session_list',
                        'doctor_session_add',
                        'doctor_session_edit',
                        'doctor_session_export'
                    ],
                    'static_data_module' => [
                        'static_data_list',
                        'static_data_add',
                        'static_data_edit',
                        'static_data_export'
                    ]
                ]
            ]
        ];

        // Build default permissions
        $permissions = [];
        foreach ($default_roles as $role) {
            $role_key = $role['key'];
            $permissions[$role_key] = [
                'name' => $role['name'],
                'capabilities' => []
            ];

            if (isset($role_permissions[$role_key]['permissions'])) {
                foreach ($role_permissions[$role_key]['permissions'] as $module_key => $perms) {
                    $permissions[$role_key]['capabilities'][$module_key] = [];
                    foreach ($perms as $perm) {
                        $permissions[$role_key]['capabilities'][$module_key][$perm] = true;
                    }
                }
            }
        }

        /**
         * Filter: 'kivicare_pro_default_permissions'
         *
         * Allows modification of the default permissions array before returning.
         *
         * @param array $permissions The default permissions array.
         */
        return apply_filters('kivicare_pro_default_permissions', $permissions);
    }

    /**
     * Get PermissionSetting settings
     * 
     * @param \WP_REST_Request $request
     * @return \WP_REST_Response
     */
    public function getPermissionSetting(WP_REST_Request $request): WP_REST_Response
    {
        $default_permissions = $this->buildDefaultPermissions();

        // Load actual role capabilities from WordPress
        foreach ($default_permissions as $role_key => &$role_data) {
            $wp_role_key = ($role_key === 'administrator') ? 'administrator' : KIVI_CARE_PREFIX . $role_key;
            $role = get_role($wp_role_key);
            if ($role) {
                foreach ($role_data['capabilities'] as $module => &$module_caps) {
                    foreach ($module_caps as $cap_key => &$cap_val) {
                        // Check if capability exists in role, if not use default true
                        if (array_key_exists($cap_key, $role->capabilities)) {
                            $cap_val = $role->has_cap($cap_key);
                        } else {
                            $cap_val = true; // Default to enabled for new capabilities
                        }
                    }
                }
            } else {
                // If role doesn't exist, set all to true by default
                foreach ($role_data['capabilities'] as $module => &$module_caps) {
                    foreach ($module_caps as $cap_key => &$cap_val) {
                        $cap_val = true;
                    }
                }
            }
        }

        return new WP_REST_Response([
            'status' => true,
            'data' => $default_permissions
        ], 200);
    }

    /**
     * Update PermissionSetting settings
     * 
     * @param \WP_REST_Request $request
     * @return \WP_REST_Response
     */
    public function updatePermissionSetting(WP_REST_Request $request): WP_REST_Response
    {
        $data = $request->get_json_params();
        $role_key = $data['type'] ?? null;

        if ($role_key && isset($data['data'][$role_key]['capabilities']) && is_array($data['data'][$role_key]['capabilities'])) {
            
            $wp_role_key = ($role_key === 'administrator') ? 'administrator' : KIVI_CARE_PREFIX . $role_key;
            $role = get_role($wp_role_key);
            if (!$role) {
                return new WP_REST_Response(['status' => false, 'message' => __('Role not found', 'kivicare-pro')], 404);
            }

            $all_possible_caps_structure = $this->buildDefaultPermissions();
            if (!isset($all_possible_caps_structure[$role_key])) {
                return new WP_REST_Response(['status' => false, 'message' => __('Invalid role specified', 'kivicare-pro')], 400);
            }

            // Flatten the capabilities from the request
            $submitted_caps_by_module = $data['data'][$role_key]['capabilities'];
            $submitted_caps = [];
            foreach ($submitted_caps_by_module as $module_caps) {
                if (is_array($module_caps)) {
                    foreach ($module_caps as $key => $value) {
                        $submitted_caps[$key] = $value;
                    }
                }
            }

            // Get all possible capabilities for this role from the default structure
            $all_role_caps = [];
            foreach ($all_possible_caps_structure[$role_key]['capabilities'] as $module_caps) {
                $all_role_caps = array_merge($all_role_caps, array_keys($module_caps));
            }
            $all_role_caps = array_unique($all_role_caps);

            foreach ($all_role_caps as $cap_key) {
                $has_cap = isset($submitted_caps[$cap_key]) && in_array($submitted_caps[$cap_key], ['1', 1, true, 'true'], true);
                $role->add_cap($cap_key, $has_cap);
            }

            $response_data = $this->getPermissionSetting($request)->get_data();

            return new WP_REST_Response([
                'status' => true,
                'data' => $response_data['data'],
                'message' => __('Permission updated successfully', 'kivicare-pro')
            ], 200);
        }

        return new WP_REST_Response([
            'status' => false,
            'message' => __('Invalid data provided', 'kivicare-pro')
        ], 400);
    }
}