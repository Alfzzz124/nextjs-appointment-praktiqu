<?php

namespace KCProApp\controllers\api;

use App\controllers\api\SettingsController;
use WP_REST_Request;
use WP_REST_Response;
use App\models\KCOption;
use WP_Error;

defined('ABSPATH') or die('Something went wrong');

/**
 * Class SidebarSetting
 * 
 * @package App\controllers\api\SettingsController
 */
class KCProSidebarSetting extends SettingsController
{
    private static $instance = null;

    protected $route = 'settings/sidebar-setting';

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
        // Get Sidebar Setting
        $this->registerRoute('/' . $this->route,  [
            'methods' => 'GET',
            'callback' => [$this, 'getSidebarSetting'],
            'permission_callback' => [$this, 'checkPermission'],
        ]);
        
        // Update Sidebar Setting
        $this->registerRoute('/' . $this->route, [
            'methods' => ['PUT', 'POST'],
            'callback' => [$this, 'updateSidebarSetting'],
            'permission_callback' => [$this, 'checkPermission'],
        ]);
    }

    /**
     * Get SidebarSetting settings
     * 
     * @param \WP_REST_Request $request
     * @return \WP_REST_Response
     */
    public function getSidebarSetting(WP_REST_Request $request): WP_REST_Response
    {
        try {
            $prefix = KIVI_CARE_PREFIX;
            
            // Get sidebar data for all roles
            $sidebar_data = [
                'administrator' => $this->getRoleSidebarData('administrator'),
                'clinic_admin' => $this->getRoleSidebarData($prefix . 'clinic_admin'),
                'receptionist' => $this->getRoleSidebarData($prefix . 'receptionist'),
                'doctor' => $this->getRoleSidebarData($prefix . 'doctor'),
                'patient' => $this->getRoleSidebarData($prefix . 'patient')
            ];

            return $this->response(['data' => $sidebar_data]);
            
        } catch (\Exception $e) {
            return $this->response(
                ['error' => $e->getMessage()],
                __('Failed to get sidebar settings.', 'kivicare-pro'),
                false,
                500
            );
        }
    }

    /**
     * Get default sidebar data using reflection
     * 
     * @param string $role
     * @return array
     */
    private function getDefaultSidebarData(string $role): array
    {
        $sidebar_manager = \App\baseClasses\KCSidebarManager::getInstance();
        
        $reflection = new \ReflectionClass($sidebar_manager);
        $method = $reflection->getMethod('generateSidebarForRole');
        $method->setAccessible(true);
        
        return $method->invoke($sidebar_manager, $role);
    }

    /**
     * Get sidebar data for specific role, including both current and default
     * 
     * @param string $role
     * @return array
     */
    private function getRoleSidebarData(string $role): array
    {
        $saved_data = $this->getSavedSidebarConfig($role);
        $default_data = $this->getDefaultSidebarData($role);
        
        return [
            'current' => $saved_data ?: $default_data,
            'default' => $default_data
        ];
    }

    /**
     * Get saved sidebar configuration from database
     * 
     * @param string $role
     * @return array
     */
    private function getSavedSidebarConfig(string $role): array
    {
        $prefix = KIVI_CARE_PREFIX;
        
        // Handle administrator role separately
        if ($role === 'administrator') {
            $option_key = $prefix . "administrator_dashboard_sidebar_data_4.0";
        } else {
            // Remove prefix for option key
            $clean_role = str_replace($prefix, '', $role);
            $option_key = $prefix . "{$clean_role}_dashboard_sidebar_data_4.0";
        }
        
        $option_data = get_option($option_key);
        
        if (!empty($option_data) && is_array($option_data)) {
            return $option_data;
        }
        
        return [];
    }

    /**
     * Update SidebarSetting settings
     * 
     * @param \WP_REST_Request $request
     * @return \WP_REST_Response
     */
    public function updateSidebarSetting(WP_REST_Request $request): WP_REST_Response
    {
        try {
            $request_data = $request->get_json_params();
            
            if (!isset($request_data['settings'])) {
                return $this->response(null, esc_html__('Invalid request data', 'kivicare-pro'), false);
            }
            
            $settings = $request_data['settings'];
            
            $valid_roles = ['administrator', 'clinic_admin', 'receptionist', 'doctor', 'patient'];
            
            if (isset($settings['reset']) && $settings['reset']) {
                // Handle reset
                if (!isset($settings['type']) || !in_array($settings['type'], $valid_roles)) {
                    return $this->response(null, esc_html__('Invalid role type', 'kivicare-pro'), false);
                }
                $role = $settings['type'];
                
                $prefix = KIVI_CARE_PREFIX;
                if ($role === 'administrator') {
                    $option_key = $prefix . "administrator_dashboard_sidebar_data_4.0";
                } else {
                    $option_key = $prefix . "{$role}_dashboard_sidebar_data_4.0";
                }
                
                delete_option($option_key);
                
                $sidebar_manager = \App\baseClasses\KCSidebarManager::getInstance();
                $actual_role = $role === 'administrator' ? $role : $prefix . $role;
                $sidebar_manager->clearCache($actual_role);
                
                return $this->response(null, esc_html__('Sidebar reset to default successfully', 'kivicare-pro'), true);
            } else {
                // Handle normal update
                $rules = [
                    'type' => 'required',
                    'data' => 'required',
                ];

                $errors = kcValidateRequest($rules, $settings);

                if (count($errors)) {
                    return $this->response(null, $errors[0], false);
                }

                if (in_array($settings['type'], $valid_roles)) {
                    $role = $settings['type'];
                    $data = $settings['data'];
                    
                    // Validate the data structure
                    if (!$this->validateSidebarData($data)) {
                        return $this->response(null, esc_html__('Invalid sidebar data structure', 'kivicare-pro'), false);
                    }
                    
                    // Save the data
                    $result = $this->saveSidebarConfig($role, $data);
                    
                    if ($result) {
                        return $this->response($data, esc_html__('Dashboard sidebar data saved successfully', 'kivicare-pro'), true);
                    } else {
                        return $this->response(null, esc_html__('Failed to save sidebar data', 'kivicare-pro'), false);
                    }
                } else {
                    return $this->response(null, esc_html__('Invalid role type', 'kivicare-pro'), false);
                }
            }
            
        } catch (\Exception $e) {
            return $this->response(
                ['error' => $e->getMessage()],
                __('Failed to save sidebar settings.', 'kivicare-pro'),
                false,
                500
            );
        }
    }

    /**
     * Validate sidebar data structure (Updated: Recursive validation for nested structure)
     * 
     * @param array $data
     * @return bool
     */
    private function validateSidebarData(array $data): bool
    {
        if (!is_array($data)) {
            return false;
        }
        
        foreach ($data as $item) {
            if (!is_array($item) || !isset($item['label']) || !isset($item['type'])) {
                return false;
            }
            
            // Recursively validate children (no unset - preserve hierarchy)
            if (isset($item['childrens']) && is_array($item['childrens'])) {
                if (!$this->validateSidebarData($item['childrens'])) {
                    return false;
                }
            }
        }
        
        return true;
    }

    /**
     * Save sidebar configuration
     * 
     * @param string $role
     * @param array $data
     * @return bool
     */
    private function saveSidebarConfig(string $role, array $data): bool
    {
        $prefix = KIVI_CARE_PREFIX;
        
        // Handle administrator role
        if ($role === 'administrator') {
            $option_key = $prefix . "administrator_dashboard_sidebar_data_4.0";
        } else {
            // For other roles, use the role name as is (clinic_admin, receptionist, etc.)
            $option_key = $prefix . "{$role}_dashboard_sidebar_data_4.0";
        }
        
        // Update option
        $result = update_option($option_key, $data);

        if (!$result) {
            $existing = get_option($option_key);
            if ($existing === $data) {
                $result = true;
            }
        }
        // Clear cache
        if ($result) {
            $sidebar_manager = \App\baseClasses\KCSidebarManager::getInstance();
            
            // Map frontend role names to actual role names
            $actual_role = $role;
            if ($role !== 'administrator') {
                $actual_role = $prefix . $role;
            }
            
            $sidebar_manager->clearCache($actual_role);
        }
        
        return $result;
    }
}