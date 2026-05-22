<?php

namespace KCProApp\controllers\api;

use App\baseClasses\KCBaseController;
use App\models\KCClinic;
use App\models\KCClinicAdmin;
use App\baseClasses\KCErrorLogger;
use WP_Error;
use WP_REST_Request;
use WP_REST_Response;
use WP_User;

defined('ABSPATH') or die('Something went wrong');
class KCProClinicController extends KCBaseController
{

    protected $route = 'clinics';
    public function registerRoutes()
    {
        // Create clinic
        $this->registerRoute('/' . $this->route, [
            'methods' => 'POST',
            'callback' => [$this, 'createClinic'],
            'permission_callback' => [$this, 'checkCreatePermission'],
            'args' => $this->getCreateEndpointArgs()
        ]);
    }


    /**
     * Check if user has permission to create a clinic
     * 
     * @param \WP_REST_Request $request
     * @return bool
     */
    public function checkCreatePermission($request)
    {
        // Check basic read permission first
        if (!$this->checkCapability('read')) {
            return false;
        }

        // Check clinic add permission
        return $this->checkResourceAccess('clinic', 'add');
    }


    /**
     * Get arguments for the create endpoint
     *
     * @return array
     */
    protected function getCreateEndpointArgs()
    {
        return [
            'clinic_name' => [
                'description' => 'Clinic name',
                'type' => 'string',
                'validate_callback' => function ($param) {
                    if (empty($param)) {
                        return new WP_Error('invalid_name', __('Clinic name is required', 'kivicare-pro'));
                    }

                    if (strlen($param) < 2) {
                        return new WP_Error('invalid_name', __('Clinic name must be at least 2 characters long', 'kivicare-pro'));
                    }

                    if (strlen($param) > 100) {
                        return new WP_Error('invalid_name', __('Clinic name cannot exceed 100 characters', 'kivicare-pro'));
                    }

                    return true;
                },
                'sanitize_callback' => 'sanitize_text_field',
                'required' => true
            ],
            'clinic_email' => [
                'description' => 'Clinic email',
                'type' => 'string',
                'validate_callback' => function ($param) {
                    if (empty($param)) {
                        return new WP_Error('invalid_email', __('Email is required', 'kivicare-pro'));
                    }

                    if (!is_email($param)) {
                        return new WP_Error('invalid_email', __('Please enter a valid email address', 'kivicare-pro'));
                    }

                    return true;
                },
                'sanitize_callback' => 'sanitize_email',
                'required' => true
            ],
            'clinic_contact' => [
                'description' => 'Clinic contact number',
                'type' => 'string',
                'validate_callback' => function ($param) {
                    if (empty($param)) {
                        return new WP_Error('invalid_contact', __('Contact number is required', 'kivicare-pro'));
                    }

                    if (!preg_match('/^[\d\s\-\+\(\)]+$/', $param)) {
                        return new WP_Error('invalid_contact', __('Please enter a valid contact number', 'kivicare-pro'));
                    }

                    return true;
                },
                'sanitize_callback' => 'sanitize_text_field',
                'required' => true
            ],
            'address' => [
                'description' => 'Clinic address',
                'type' => 'string',
                'required' => true,
                'validate_callback' => function ($param) {
                    if (empty($param)) {
                        return new WP_Error('invalid_address', __('Address is required', 'kivicare-pro'));
                    }
                    return true;
                },
                'sanitize_callback' => 'sanitize_text_field',
            ],
            'city' => [
                'description' => 'Clinic city',
                'type' => 'string',
                'sanitize_callback' => 'sanitize_text_field',
            ],
            'state' => [
                'description' => 'Clinic state/province',
                'type' => 'string',
                'sanitize_callback' => 'sanitize_text_field',
            ],
            'postal_code' => [
                'description' => 'Clinic postal/ZIP code',
                'type' => 'string',
                'sanitize_callback' => 'sanitize_text_field',
            ],
            'country' => [
                'description' => 'Clinic country',
                'type' => 'string',
                'sanitize_callback' => 'sanitize_text_field',
            ],
            'specialties' => [
                'description' => 'Clinic specialties (array of objects with id and label)',
                'type' => 'array',
                'items' => [
                    'type' => 'object',
                    'properties' => [
                        'id' => [
                            'type' => 'integer',
                            'description' => 'Specialty ID',
                            'sanitize_callback' => 'sanitize_text_field',
                        ],
                        'label' => [
                            'type' => 'string',
                            'description' => 'Specialty label',
                            'sanitize_callback' => 'sanitize_text_field',
                        ],
                    ],
                    'required' => ['id', 'label'],
                ],
                'validate_callback' => function ($param) {
                    if (!is_array($param) || empty($param)) {
                        return new WP_Error('invalid_specialties', __('Specialties are required and must be an array', 'kivicare-pro'));
                    }
                    foreach ($param as $specialty) {
                        if (
                            !is_array($specialty) ||
                            empty($specialty['id']) ||
                            empty($specialty['label'])
                        ) {
                            return new WP_Error('invalid_specialty', __('Each specialty must have id and label', 'kivicare-pro'));
                        }
                    }
                    return true;
                },
            ],
            'status' => [
                'description' => 'Clinic status (0: Inactive, 1: Active)',
                'type' => 'integer',
                'validate_callback' => function ($param) {
                    if (!in_array(intval($param), [0, 1])) {
                        return new WP_Error('invalid_status', __('Status must be 0 (inactive) or 1 (active)', 'kivicare-pro'));
                    }
                    return true;
                },
                'sanitize_callback' => 'absint',
            ],
            'profile_image' => [
                'description' => 'Clinic profile image ID',
                'type' => 'integer',
                'validate_callback' => function ($param) {
                    if (!empty($param) && (!is_numeric($param) || $param <= 0)) {
                        return new WP_Error('invalid_image_id', __('Invalid image ID', 'kivicare-pro'));
                    }
                    return true;
                },
                'sanitize_callback' => 'absint',
            ],
            'admin_id' => [
                'description' => 'Clinic administrator user ID',
                'type' => 'integer',
                'validate_callback' => function ($param) {
                    if (!empty($param) && (!is_numeric($param) || $param <= 0)) {
                        return new WP_Error('invalid_admin_id', __('Invalid admin user ID', 'kivicare-pro'));
                    }
                    return true;
                },
                'sanitize_callback' => 'absint',
            ],
            'description' => [
                'description' => 'Clinic description',
                'type' => 'string',
                'sanitize_callback' => 'sanitize_textarea_field',
            ],
            'timezone' => [
                'description' => 'Clinic admin timezone (IANA timezone identifier)',
                'type' => 'string',
                'sanitize_callback' => 'sanitize_text_field',
            ]
        ];
    }


    /**
     * Create new clinic
     * 
     * @param \WP_REST_Request $request
     * @return \WP_REST_Response
     */
    public function createClinic(WP_REST_Request $request): WP_REST_Response
    {
        try {
            $data = $request->get_params();
            // Validate emails
            $clinicEmail = sanitize_email($data['clinic_email'] ?? '');
            $adminEmail = sanitize_email($data['admin_email'] ?? '');

            // Check clinic email uniqueness
            $existingClinic = KCClinic::table('c')
                ->where('c.email', $clinicEmail)
                ->first();

            if ($existingClinic) {
                return $this->response(
                    ['email' => $clinicEmail],
                    __('A clinic with this email already exists', 'kivicare-pro'),
                    false,
                    409 // Conflict status code
                );
            }

            // Check admin email uniqueness
            $existingUser = get_user_by('email', $adminEmail);
            if ($existingUser) {
                return $this->response(
                    ['email' => $adminEmail],
                    __('A user with this admin email already exists', 'kivicare-pro'),
                    false,
                    409
                );
            }
            // Prepare clinic data for new model structure
            $clinicData = [
                'name' => $data['clinic_name'] ?? '',
                'email' => $data['clinic_email'] ?? '',
                'telephoneNo' => $data['clinic_contact'] ?? '',
                'address' => $data['address'] ?? '',
                'city' => $data['city'] ?? '',
                'state' => $data['state'] ?? '',
                'country' => $data['country'] ?? '',
                'postalCode' => $data['postal_code'] ?? '',
                'specialties' => $data['specialties'] ?? '',
                'status' => $data['status'] ? 1 : 0,
                'profileImage' => !empty($data['clinic_image_id']) ? (int) $data['clinic_image_id'] : null,
                'clinicLogo' => !empty($data['clinic_image_id']) ? (int) $data['clinic_image_id'] : 0,
                'countryCode' => $data['country_code'] ?? '',
                'countryCallingCode' => $data['country_calling_code'] ?? '',
                'extra' => null,
                'createdAt' => current_time('Y-m-d H:i:s')
            ];

            // Prepare admin data for clinic admin user creation
            $data['clinicAdminData'] = [
                'first_name' => $data['first_name'] ?? '',
                'last_name' => $data['last_name'] ?? '',
                'user_email' => $data['admin_email'] ?? '',
                'mobile_number' => $data['admin_contact_number'] ?? '',
                'dob' => $data['dob'] ?? '',
                'gender' => $data['gender'] ?? '',
                'profile_image' => !empty($data['admin_image_id']) ? (int) $data['admin_image_id'] : null,
                'country_calling_code_admin' => $data['country_calling_code'] ?? '',
                'country_code_admin' => $data['country_code'] ?? ''
            ];

            // Create clinic using new model
            $clinic_id = KCClinic::create($clinicData);

            if (!$clinic_id) {
                return $this->response([
                    'status' => false,
                    'message' => __('Failed to create clinic', 'kivicare-pro')
                ], 500);
            }

            $clinic = KCClinic::find($clinic_id);

            // Create clinic admin user using KCClinicAdmin model
            $adminData = $data['clinicAdminData'];

            // Generate username if not provided
            $username = $this->generateUsername($adminData['first_name'] ?? 'admin');

            // Generate password if not provided
            $password = !empty($data["password"]) ? $data["password"] : $this->generateRandomString(12);

            // Create clinic admin using the model
            $clinicAdmin = new KCClinicAdmin();
            $clinicAdmin->username = $username;
            $clinicAdmin->email = $adminData['user_email'];
            $clinicAdmin->password = $password;
            $clinicAdmin->firstName = $adminData['first_name'] ?? '';
            $clinicAdmin->lastName = $adminData['last_name'] ?? '';
            $clinicAdmin->displayName = ($adminData['first_name'] ?? '') . ' ' . ($adminData['last_name'] ?? '');
            $clinicAdmin->contactNumber = $adminData['mobile_number'] ?? '';
            $clinicAdmin->gender = $adminData['gender'] ?? 'male';
            $clinicAdmin->address = $data['address'] ?? '';
            $clinicAdmin->city = $data['city'] ?? '';
            $clinicAdmin->state = $data['state'] ?? '';
            $clinicAdmin->country = $data['country'] ?? '';
            $clinicAdmin->postalCode = $data['postal_code'] ?? '';

            // Save clinic admin
            if (is_wp_error($save_result = $clinicAdmin->save())) {
                // If clinic was created but user creation failed, we should clean up
                $clinic->delete();
                return $this->response([
                    'status' => false,
                    'message' => $save_result->get_error_message()
                ], 500);
            }

            $user_id = $clinicAdmin->id;

            // Update clinic with admin ID
            $clinic->clinicAdminId = $user_id;
            $clinic->save();

            // Set additional meta data not handled by the model
            if (isset($adminData['dob']) && !empty($adminData['dob'])) {
                $clinicAdmin->updateMeta('dob', $adminData['dob']);
            }

            if (isset($adminData['profile_image']) && !empty((int) $adminData['profile_image'])) {
                $clinicAdmin->updateMeta('clinic_admin_profile_image', $adminData['profile_image']);
            }

            // Set country calling code and country code meta
            if (!empty($adminData['country_calling_code_admin'])) {
                $clinicAdmin->updateMeta('country_calling_code', $adminData['country_calling_code_admin']);
            }

            if (!empty($adminData['country_code_admin'])) {
                $clinicAdmin->updateMeta('country_code', $adminData['country_code_admin']);
            }

            // Store basic data as JSON (for backward compatibility)
            $clinicAdmin->updateMeta('basic_data', json_encode($adminData));

            // Save timezone to user meta
            if (!empty($data['timezone'])) {
                update_user_meta($user_id, 'timezone', sanitize_text_field($data['timezone']));
            }

            // Send clinic admin registration email notification
            $this->sendClinicAdminRegistrationEmail($adminData, $username, $password, $clinic->toArray());

            $adminNotificationData = [
                'id' => $clinic_id,
                'user_id' => $user_id,
                'username' => $username,
                'password' => $password,
                'user_email' => $adminData['user_email'],
                'first_name' => $adminData['first_name'],
                'last_name' => $adminData['last_name'],
                'mobile_number' => $adminData['mobile_number'],
                'clinic_name' => $clinic->name
            ];
            
            // Trigger action hook for additional processing
            do_action('kcpro_clinic_save', $adminNotificationData);
            do_action('kivicare_clinic_admin_registered', $adminNotificationData);

            return $this->response([
                'status' => true,
                'message' => __('Clinic created successfully', 'kivicare-pro'),
                'data' => [
                    'clinic_id' => $clinic_id,
                    'admin_id' => $user_id,
                    'username' => $username
                ]
            ], 200);
        } catch (\Exception $e) {
            return $this->response([
                'status' => false,
                'message' => __('An error occurred: ', 'kivicare-pro') . $e->getMessage()
            ], 500);
        }
    }

    /**
     * Send clinic admin registration email
     * 
     * @param array $adminData
     * @param string $username
     * @param string $password
     * @param array $clinicData
     * @return void
     */
    private function sendClinicAdminRegistrationEmail(array $adminData, string $username, string $password, array $clinicData): void
    {
        try {

            // Prepare email data
            $emailData = [
                'user_name' => $username,
                'user_email' => $adminData['user_email'],
                'user_password' => $password,
                'user_role' => 'Clinic Administrator',
                'user_contact' => $adminData['mobile_number'] ?? '',
                'clinic_name' => $clinicData['name'] ?? '',
                'clinic_email' => $clinicData['email'] ?? '',
                'clinic_contact_number' => $clinicData['telephoneNo'] ?? '',
                'clinic_address' => $this->formatClinicAddress($clinicData),
                'first_name' => $adminData['first_name'] ?? '',
                'last_name' => $adminData['last_name'] ?? '',
                'display_name' => trim(($adminData['first_name'] ?? '') . ' ' . ($adminData['last_name'] ?? ''))
            ];

            // Send email using the clinic admin registration template
            $templateName = KIVI_CARE_PREFIX . 'clinic_admin_registration';
            $emailSent = $this->emailSender->sendEmailByTemplate(
                $templateName,
                $adminData['user_email'],
                $emailData
            );

            if ($emailSent) {
                KCErrorLogger::instance()->error("Clinic admin registration email sent successfully to: " . $adminData['user_email']);
            } else {
                KCErrorLogger::instance()->error("Failed to send clinic admin registration email to: " . $adminData['user_email']);
            }
        } catch (\Exception $e) {
            KCErrorLogger::instance()->error("Error sending clinic admin registration email: " . $e->getMessage());
        }
    }

    /**
     * Format clinic address from clinic data
     * 
     * @param array $clinicData
     * @return string
     */
    private function formatClinicAddress(array $clinicData): string
    {
        $addressParts = [];

        if (!empty($clinicData['address'])) {
            $addressParts[] = $clinicData['address'];
        }
        if (!empty($clinicData['city'])) {
            $addressParts[] = $clinicData['city'];
        }
        if (!empty($clinicData['state'])) {
            $addressParts[] = $clinicData['state'];
        }
        if (!empty($clinicData['postalCode'])) {
            $addressParts[] = $clinicData['postalCode'];
        }
        if (!empty($clinicData['country'])) {
            $addressParts[] = $clinicData['country'];
        }

        return implode(', ', array_filter($addressParts));
    }

    /**
     * Generate unique username
     * 
     * @param string $base_name
     * @return string
     */
    private function generateUsername($base_name)
    {
        $username = sanitize_user($base_name);
        $counter = 1;

        while (username_exists($username)) {
            $username = sanitize_user($base_name . $counter);
            $counter++;
        }

        return $username;
    }

    /**
     * Generate random string for password
     * 
     * @param int $length
     * @return string
     */
    private function generateRandomString($length = 12)
    {
        $characters = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ!@#$%^&*';
        $charactersLength = strlen($characters);
        $randomString = '';

        for ($i = 0; $i < $length; $i++) {
            $randomString .= $characters[rand(0, $charactersLength - 1)];
        }

        return $randomString;
    }
}
