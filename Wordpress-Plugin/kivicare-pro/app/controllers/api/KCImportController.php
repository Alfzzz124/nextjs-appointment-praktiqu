<?php

namespace KCProApp\controllers\api;

defined('ABSPATH') or die('Something went wrong');

use App\controllers\api\SettingsController;
use App\models\KCAppointment;
use App\models\KCAppointmentServiceMapping;
use App\models\KCClinic;
use App\models\KCCustomField;
use App\models\KCDoctor;
use App\models\KCDoctorClinicMapping;
use App\models\KCClinicSession;
use App\models\KCPatient;
use App\models\KCPatientClinicMapping;
use App\models\KCReceptionistClinicMapping;
use App\models\KCService;
use App\models\KCPrescription;
use App\models\KCPatientEncounter;
use App\models\KCServiceDoctorMapping;
use App\models\KCStaticData;
use App\services\KCAppointmentDataService;
use App\services\KCTimeSlotService;
use App\baseClasses\KCErrorLogger;
use WP_REST_Request;
use WP_REST_Response;
use WP_Error;
use WP_User;
use PhpOffice\PhpSpreadsheet\IOFactory;
use PhpOffice\PhpSpreadsheet\Shared\Date;

/**
 * Import Controller for handling data import operations
 * 
 * @package KCProApp\controllers\api
 */
class KCImportController extends SettingsController
{
    /**
     * Route prefix for import endpoints
     * 
     * @var string
     */
    protected $route = 'import';

    /**
     * Constructor
     */
    public function __construct()
    {
        parent::__construct();
    }

    /**
     * Register import routes
     * 
     * @return void
     */
    public function registerRoutes(): void
    {
        $this->registerRoute('/' . $this->route . '/doctors', [
            'methods' => 'POST',
            'callback' => [$this, 'importDoctors'],
            'permission_callback' => [$this, 'checkPermission'],
            'args' => $this->getImportEndpointArgs()
        ]);
        
        $this->registerRoute('/' . $this->route . '/receptionists', [
            'methods' => 'POST',
            'callback' => [$this, 'importReceptionists'],
            'permission_callback' => [$this, 'checkPermission'],
            'args' => $this->getImportEndpointArgs()
        ]);

        $this->registerRoute('/' . $this->route . '/clinics', [
            'methods' => 'POST',
            'callback' => [$this, 'importClinics'],
            'permission_callback' => [$this, 'checkPermission'],
            'args' => $this->getImportEndpointArgs()
        ]);

        $this->registerRoute('/' . $this->route . '/patients', [
            'methods' => 'POST',
            'callback' => [$this, 'importPatients'],
            'permission_callback' => [$this, 'checkPermission'],
            'args' => $this->getImportEndpointArgs()
        ]);

        $this->registerRoute('/' . $this->route . '/services', [
            'methods' => 'POST',
            'callback' => [$this, 'importServices'],
            'permission_callback' => [$this, 'checkPermission'],
            'args' => $this->getImportEndpointArgs()
        ]);

        $this->registerRoute('/' . $this->route . '/custom-fields', [
            'methods' => 'POST',
            'callback' => [$this, 'importCustomFields'],
            'permission_callback' => [$this, 'checkPermission'],
            'args' => $this->getImportEndpointArgs()
        ]);

        $this->registerRoute('/' . $this->route . '/appointments', [
            'methods' => 'POST',
            'callback' => [$this, 'importAppointments'],
            'permission_callback' => [$this, 'checkPermission'],
            'args' => $this->getImportEndpointArgs()
        ]);
        $this->registerRoute('/' . $this->route . '/prescriptions', [
            'methods' => 'POST',
            'callback' => [$this, 'importPrescriptions'],
            'permission_callback' => [$this, 'checkPermission'],
            'args' => $this->getImportEndpointArgs()
        ]);
        $this->registerRoute('/' . $this->route . '/listing', [
            'methods' => 'POST',
            'callback' => [$this, 'importListings'],
            'permission_callback' => [$this, 'checkPermission'],
            'args' => $this->getImportEndpointArgs()
        ]);
    }

    /**
     * Get import endpoint arguments
     * 
     * @return array
     */
    private function getImportEndpointArgs(): array
    {
        return [
            'context' => [
                'required' => true,
                'type' => 'string',
                'sanitize_callback' => 'sanitize_text_field',
                'validate_callback' => [$this, 'validateContext']
            ],
            'file_format' => [
                'required' => true,
                'type' => 'string',
                'sanitize_callback' => 'sanitize_text_field',
                'validate_callback' => [$this, 'validateFileFormat']
            ],
            'send_email_notification' => [
                'required' => false,
                'type' => 'boolean',
                'default' => false
            ],
            'send_sms_notification' => [
                'required' => false,
                'type' => 'boolean',
                'default' => false
            ]
        ];
    }

    /**
     * Validate context parameter
     * 
     * @param mixed $param The parameter to validate
     * @return bool|WP_Error
     */
    public function validateContext($param)
    {
        $allowedContexts = ['doctors', 'patients', 'receptionists', 'clinics', 'services', 'custom-fields', 'appointments','prescriptions', 'listing'];
        
        if (!in_array($param, $allowedContexts)) {
            return new WP_Error('invalid_context', __('Invalid import context', 'kivicare-pro'));
        }
        
        return true;
    }

    /**
     * Validate file format parameter
     * 
     * @param mixed $param The parameter to validate
     * @return bool|WP_Error
     */
    public function validateFileFormat($param)
    {
        $allowedFormats = ['csv', 'xlsx'];
        
        if (!in_array($param, $allowedFormats)) {
            return new WP_Error('invalid_format', __('Invalid file format. Only CSV and XLSX are supported', 'kivicare-pro'));
        }
        
        return true;
    }


    /**
     * Validate file format match with selected format
     */
    private function validateFileFormatMatch($file_extension, $selected_format) {
        $format_extensions = [
            'csv' => ['csv'],
            'xlsx' => ['xlsx', 'xls']
        ];

        $expected_extensions = $format_extensions[$selected_format] ?? [];
        
        if (!in_array($file_extension, $expected_extensions)) {
            $expected_formats = implode(', ', $expected_extensions);
            return [
                'valid' => false,
                'message' => sprintf(
                    __('File format invalid. Expected %s file for %s format', 'kivicare-pro'),
                    strtoupper($expected_formats),
                    strtoupper($selected_format)
                )
            ];
        }

        return ['valid' => true];
    }


    /**
     * Validate file upload
     * 
     * @return array
     */
    private function validateFileUpload(): array
    {
        if (!isset($_FILES['file'])) {
            return [
                'valid' => false,
                'message' => __('No file uploaded', 'kivicare-pro')
            ];
        }

        if ($_FILES['file']['error'] !== UPLOAD_ERR_OK) {
            $errorMessages = [
                UPLOAD_ERR_INI_SIZE => __('File too large (server limit)', 'kivicare-pro'),
                UPLOAD_ERR_FORM_SIZE => __('File too large (form limit)', 'kivicare-pro'),
                UPLOAD_ERR_PARTIAL => __('File upload was incomplete', 'kivicare-pro'),
                UPLOAD_ERR_NO_FILE => __('No file was uploaded', 'kivicare-pro'),
                UPLOAD_ERR_NO_TMP_DIR => __('Missing temporary folder', 'kivicare-pro'),
                UPLOAD_ERR_CANT_WRITE => __('Failed to write file to disk', 'kivicare-pro'),
                UPLOAD_ERR_EXTENSION => __('File upload stopped by extension', 'kivicare-pro')
            ];
            
            $errorMessage = $errorMessages[$_FILES['file']['error']] ?? __('Unknown upload error', 'kivicare-pro');
            
            return [
                'valid' => false,
                'message' => sprintf(__('File upload error: %s', 'kivicare-pro'), $errorMessage)
            ];
        }

        return ['valid' => true];
    }

    /**
     * Validate file type and format
     * 
     * @param array $uploadedFile The uploaded file array
     * @param string $fileFormat The expected file format
     * @return array
     */
    private function validateFileTypeAndFormat(array $uploadedFile, string $fileFormat): array
    {
        $allowedTypes = [
            'text/csv',
            'text/plain', 
            'application/csv', 
            'application/vnd.ms-excel', 
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        ];
        
        $fileType = $uploadedFile['type'];
        $fileName = $uploadedFile['name'];
        $fileExtension = strtolower(pathinfo($fileName, PATHINFO_EXTENSION));
        
        // Check if file type is allowed
        if (!in_array($fileType, $allowedTypes)) {
            return [
                'valid' => false,
                'message' => __('Invalid file type. Please upload CSV or XLSX file', 'kivicare-pro')
            ];
        }
        
        // Check if file format matches selected format
        $formatValidation = $this->validateFileFormatMatch($fileExtension, $fileFormat);
        if (!$formatValidation['valid']) {
            return [
                'valid' => false,
                'message' => $formatValidation['message']
            ];
        }

        return ['valid' => true];
    }

    /**
     * Import receptionists from uploaded file
     * 
     * @param WP_REST_Request $request The REST request object
     * @return WP_REST_Response
     */
    public function importReceptionists(WP_REST_Request $request): WP_REST_Response
    {
        try {
            $params = $request->get_params();
            $context = $params['context'];
            $fileFormat = $params['file_format'];
            $sendEmailNotification = $params['send_email_notification'] ?? false;
            $sendSmsNotification = $params['send_sms_notification'] ?? false;
            
            // Validate file upload
            $fileValidation = $this->validateFileUpload();
            if (!$fileValidation['valid']) {
                return $this->response([
                    'success' => false,
                    'message' => $fileValidation['message']
                ], 400);
            }
            
            $uploadedFile = $_FILES['file'];
            $filePath = $uploadedFile['tmp_name'];

            // Validate file type and format
            $fileValidation = $this->validateFileTypeAndFormat($uploadedFile, $fileFormat);
            if (!$fileValidation['valid']) {
                return $this->response([
                    'success' => false,
                    'message' => $fileValidation['message']
                ], 400);
            }

            // Parse file based on format
            $data = $this->parseFile($filePath, $fileFormat);
            
            if (empty($data)) {
                return $this->response([
                    'success' => false,
                    'message' => __('No data found in the uploaded file', 'kivicare-pro')
                ], 400);
            }

            // Process import data
            $result = $this->processReceptionistsImport($data, $sendEmailNotification, $sendSmsNotification);

            // Clear memory
            unset($data);
            
            // Return response
            return $this->response([
                'success' => true,
                'message' => __('Import completed successfully', 'kivicare-pro'),
                'data' => [
                    'total_rows' => $result['total_rows'] ?? 0,
                    'inserted_rows' => $result['inserted_rows'] ?? 0,
                    'toast_error_message' => $result['toast_error_message'] ?? ''
                ]
            ], 200);

        } catch (\Exception $e) {
            return $this->response([
                'success' => false,
                'message' => __('Import failed', 'kivicare-pro') . ': ' . $e->getMessage(),
                'error' => $e->getMessage()
            ], 500);
        }
    }

    /**
     * Import clinics from uploaded file
     * 
     * @param WP_REST_Request $request The REST request object
     * @return WP_REST_Response
     */
    public function importClinics(WP_REST_Request $request): WP_REST_Response
    {
        try {
            $params = $request->get_params();
            $context = $params['context'];
            $fileFormat = $params['file_format'];
            $sendEmailNotification = $params['send_email_notification'] ?? false;
            $sendSmsNotification = $params['send_sms_notification'] ?? false;
            
            // Validate file upload
            $fileValidation = $this->validateFileUpload();
            if (!$fileValidation['valid']) {
                return $this->response([
                    'success' => false,
                    'message' => $fileValidation['message']
                ], 400);
            }
            
            $uploadedFile = $_FILES['file'];
            $filePath = $uploadedFile['tmp_name'];

            // Validate file type and format
            $fileValidation = $this->validateFileTypeAndFormat($uploadedFile, $fileFormat);
            if (!$fileValidation['valid']) {
                return $this->response([
                    'success' => false,
                    'message' => $fileValidation['message']
                ], 400);
            }

            // Parse file based on format
            $data = $this->parseFile($filePath, $fileFormat);
            
            if (empty($data)) {
                return $this->response([
                    'success' => false,
                    'message' => __('No data found in the uploaded file', 'kivicare-pro')
                ], 400);
            }

            // Process import data
            $result = $this->processClinicsImport($data, $sendEmailNotification, $sendSmsNotification);

            // Clear memory
            unset($data);
            
            // Return response
            return $this->response([
                'success' => true,
                'message' => __('Import completed successfully', 'kivicare-pro'),
                'data' => [
                    'total_rows' => $result['total_rows'] ?? 0,
                    'inserted_rows' => $result['inserted_rows'] ?? 0,
                    'toast_error_message' => $result['toast_error_message'] ?? ''
                ]
            ], 200);

        } catch (\Exception $e) {
            return $this->response([
                'success' => false,
                'message' => __('Import failed', 'kivicare-pro') . ': ' . $e->getMessage(),
                'error' => $e->getMessage()
            ], 500);
        }
    }

    /**
     * Import doctors from uploaded file
     * 
     * @param WP_REST_Request $request The REST request object
     * @return WP_REST_Response
     */
    public function importDoctors(WP_REST_Request $request): WP_REST_Response
    {
        try {
            $params = $request->get_params();
            $context = $params['context'];
            $fileFormat = $params['file_format'];
            $sendEmailNotification = $params['send_email_notification'] ?? false;
            $sendSmsNotification = $params['send_sms_notification'] ?? false;
            
            // Validate file upload
            $fileValidation = $this->validateFileUpload();
            if (!$fileValidation['valid']) {
                return $this->response([
                    'success' => false,
                    'message' => $fileValidation['message']
                ], 400);
            }
            
            $uploadedFile = $_FILES['file'];
            $filePath = $uploadedFile['tmp_name'];

            // Validate file type and format
            $fileValidation = $this->validateFileTypeAndFormat($uploadedFile, $fileFormat);
            if (!$fileValidation['valid']) {
                return $this->response([
                    'success' => false,
                    'message' => $fileValidation['message']
                ], 400);
            }

            // Parse file based on format
            $data = $this->parseFile($filePath, $fileFormat);
            
            if (empty($data)) {
                return $this->response([
                    'success' => false,
                    'message' => __('No data found in the uploaded file', 'kivicare-pro')
                ], 400);
            }

            // Process import data
            $result = $this->processDoctorsImport($data, $sendEmailNotification, $sendSmsNotification);

            // Clear memory
            unset($data);
            
            // Return response
            return $this->response([
                'success' => true,
                'message' => __('Import completed successfully', 'kivicare-pro'),
                'data' => [
                    'total_rows' => $result['total_rows'] ?? 0,
                    'inserted_rows' => $result['inserted_rows'] ?? 0,
                    'toast_error_message' => $result['toast_error_message'] ?? ''
                ]
            ], 200);

        } catch (\Exception $e) {
            return $this->response([
                'success' => false,
                'message' => __('Import failed', 'kivicare-pro') . ': ' . $e->getMessage(),
                'error' => $e->getMessage()
            ], 500);
        }
    }

    /**
     * Import patients from uploaded file
     * 
     * @param WP_REST_Request $request The REST request object
     * @return WP_REST_Response
     */
    public function importPatients(WP_REST_Request $request): WP_REST_Response
    {
        try {
            $params = $request->get_params();
            $context = $params['context'];
            $fileFormat = $params['file_format'];
            $sendEmailNotification = $params['send_email_notification'] ?? false;
            $sendSmsNotification = $params['send_sms_notification'] ?? false;
            
            // Validate file upload
            $fileValidation = $this->validateFileUpload();
            if (!$fileValidation['valid']) {
                return $this->response([
                    'success' => false,
                    'message' => $fileValidation['message']
                ], 400);
            }
            
            $uploadedFile = $_FILES['file'];
            $filePath = $uploadedFile['tmp_name'];

            // Validate file type and format
            $fileValidation = $this->validateFileTypeAndFormat($uploadedFile, $fileFormat);
            if (!$fileValidation['valid']) {
                return $this->response([
                    'success' => false,
                    'message' => $fileValidation['message']
                ], 400);
            }

            // Parse file based on format
            $data = $this->parseFile($filePath, $fileFormat);
            
            if (empty($data)) {
                return $this->response([
                    'success' => false,
                    'message' => __('No data found in the uploaded file', 'kivicare-pro')
                ], 400);
            }

            // Process import data
            $result = $this->processPatientsImport($data, $sendEmailNotification, $sendSmsNotification);

            // Clear memory
            unset($data);
            
            // Return response
            return $this->response([
                'success' => true,
                'message' => __('Import completed successfully', 'kivicare-pro'),
                'data' => [
                    'total_rows' => $result['total_rows'] ?? 0,
                    'inserted_rows' => $result['inserted_rows'] ?? 0,
                    'toast_error_message' => $result['toast_error_message'] ?? ''
                ]
            ], 200);

        } catch (\Exception $e) {
            return $this->response([
                'success' => false,
                'message' => __('Import failed', 'kivicare-pro') . ': ' . $e->getMessage(),
                'error' => $e->getMessage()
            ], 500);
        }
    }

    /**
     * Import services from uploaded file
     * 
     * @param WP_REST_Request $request The REST request object
     * @return WP_REST_Response
     */
    public function importServices(WP_REST_Request $request): WP_REST_Response
    {
        try {
            $params = $request->get_params();
            $context = $params['context'];
            $fileFormat = $params['file_format'];
            $sendEmailNotification = $params['send_email_notification'] ?? false;
            $sendSmsNotification = $params['send_sms_notification'] ?? false;
            
            // Validate file upload
            $fileValidation = $this->validateFileUpload();
            if (!$fileValidation['valid']) {
                return $this->response([
                    'success' => false,
                    'message' => $fileValidation['message']
                ], 400);
            }
            
            $uploadedFile = $_FILES['file'];
            $filePath = $uploadedFile['tmp_name'];

            // Validate file type and format
            $fileValidation = $this->validateFileTypeAndFormat($uploadedFile, $fileFormat);
            if (!$fileValidation['valid']) {
                return $this->response([
                    'success' => false,
                    'message' => $fileValidation['message']
                ], 400);
            }

            // Parse file based on format
            $data = $this->parseFile($filePath, $fileFormat);
            
            if (empty($data)) {
                return $this->response([
                    'success' => false,
                    'message' => __('No data found in the uploaded file', 'kivicare-pro')
                ], 400);
            }

            // Process import data
            $result = $this->processServicesImport($data, $sendEmailNotification, $sendSmsNotification);

            // Clear memory
            unset($data);
            
            // Return response
            return $this->response([
                'success' => true,
                'message' => __('Import completed successfully', 'kivicare-pro'),
                'data' => [
                    'total_rows' => $result['total_rows'] ?? 0,
                    'inserted_rows' => $result['inserted_rows'] ?? 0,
                    'toast_error_message' => $result['toast_error_message'] ?? ''
                ]
            ], 200);

        } catch (\Exception $e) {
            return $this->response([
                'success' => false,
                'message' => __('Import failed', 'kivicare-pro') . ': ' . $e->getMessage(),
                'error' => $e->getMessage()
            ], 500);
        }
    }

    /**
     * Parse uploaded file
     */
    private function parseFile($file_path, $format) {
        try {
            if ($format === 'csv') {
                return $this->parseCSV($file_path);
            } else {
                return $this->parseExcel($file_path);
            }
        } catch (\Exception $e) {
            throw new \Exception(__('Error parsing file', 'kivicare-pro') . ': ' . $e->getMessage());
        }
    }

    /**
     * Parse CSV file
     */
    private function parseCSV($file_path) {
        $data = [];
        $handle = fopen($file_path, 'r');
        
        if ($handle === false) {
            throw new \Exception(__('Could not open CSV file', 'kivicare-pro'));
        }

        $headers = fgetcsv($handle, 0, ',', '"', '\\');
        if ($headers === false) {
            fclose($handle);
            throw new \Exception(__('Could not read CSV headers', 'kivicare-pro'));
        }

        // Clean headers
        $headers = array_map('trim', $headers);

        while (($row = fgetcsv($handle, 0, ',', '"', '\\')) !== false) {
            if (count($row) === count($headers)) {
                $data[] = array_combine($headers, $row);
            }
        }

        fclose($handle);
        return $data;
    }

    /**
     * Parse Excel file
     */
    private function parseExcel($file_path) {
        try {
            // Check if PhpSpreadsheet is available
            if (!class_exists('PhpOffice\PhpSpreadsheet\IOFactory')) {
                throw new \Exception(__('PhpSpreadsheet library is not available. Please install it to import Excel files.', 'kivicare-pro'));
            }
            
            $spreadsheet = IOFactory::load($file_path);
            $worksheet = $spreadsheet->getActiveSheet();
            $data = [];

            $headers = [];
            $highestRow = $worksheet->getHighestRow();
            $highestColumn = $worksheet->getHighestColumn();

            // Get headers from first row and trim them
            for ($col = 'A'; $col <= $highestColumn; ++$col) {
                $headerValue = $worksheet->getCell($col . '1')->getValue();
                $headers[] = trim(strtolower(str_replace(' ', '_', $headerValue)));
            }

            // Get data rows
            for ($row = 2; $row <= $highestRow; ++$row) {
                $rowData = [];
                $colIndex = 0;
                $hasData = false;
                
                for ($col = 'A'; $col <= $highestColumn; ++$col) {
                    $cellValue = $worksheet->getCell($col . $row)->getValue();
                    
                    // Handle date cells
                    if ($cellValue instanceof \DateTime) {
                        $cellValue = $cellValue->format('Y-m-d');
                    }
                    
                    // Convert null to empty string
                    if ($cellValue === null) {
                        $cellValue = '';
                    }
                    
                    $rowData[$headers[$colIndex]] = $cellValue;
                    
                    // Check if row has any data
                    if (!empty($cellValue)) {
                        $hasData = true;
                    }
                    
                    $colIndex++;
                }
                
                // Only add row if it has data
                if ($hasData) {
                    $data[] = $rowData;
                }
            }

            return $data;
        } catch (\Exception $e) {
            throw new \Exception(__('Error reading Excel file', 'kivicare-pro') . ': ' . $e->getMessage());
        }
    }


    /**
     * Process doctors import
     */
    private function processDoctorsImport($data, $sendEmailNotification, $sendSmsNotification) {
        $total_rows = count($data);
        $inserted_rows = 0;
        $errors = [];
        $required_fields = [
            'first_name', 'last_name', 'email', 'country_calling_code', 
            'country_code', 'contact', 'gender', 'specialization'
        ];
        
        // Optional clinic fields
        $clinic_fields = ['clinic_id'];

        // Start database transaction
        global $wpdb;
        $wpdb->query('START TRANSACTION');

        try {
            foreach ($data as $index => $row) {
                $row_number = $index + 2; // +2 because index starts at 0 and we skip header row
                
                try {
                    // Validate required fields
                    $validation_result = $this->validateDoctorRow($row, $required_fields, $row_number);
                    if (!$validation_result['valid']) {
                        $errors[] = $validation_result['error'];
                        continue;
                    }

                    // Validate clinic exists if specified
                    $clinic_validation = $this->validateClinicById($row, $row_number);
                    if (!$clinic_validation['valid']) {
                        $errors[] = $clinic_validation['error'];
                        continue;
                    }

                    // Prepare doctor data
                    $doctor_data = $this->prepareDoctorData($row);
                    
                    // Check if doctor already exists
                    if ($this->doctorExists($doctor_data['email'])) {
                        $errors[] = sprintf(__('Row %d: Doctor with email %s already exists', 'kivicare-pro'), $row_number, $doctor_data['email']);
                        continue;
                    }

                    // Create doctor
                    $result = $this->createDoctor($doctor_data, $sendEmailNotification, $sendSmsNotification);
                    
                    if ($result['success']) {
                        $inserted_rows++;
                    } else {
                        $errors[] = sprintf(__('Row %d: %s', 'kivicare-pro'), $row_number, $result['error']);
                    }

                } catch (\Exception $e) {
                    $errors[] = sprintf(__('Row %d: %s', 'kivicare-pro'), $row_number, $e->getMessage());
                }
            }

            // Commit transaction if all operations successful
            $wpdb->query('COMMIT');

        } catch (\Exception $e) {
            // Rollback transaction on any error
            $wpdb->query('ROLLBACK');
            $errors[] = sprintf(__('Import failed: %s', 'kivicare-pro'), $e->getMessage());
        }

        // Create a single error message for toast
        $toast_error_message = '';
        if ($inserted_rows === 0 && $total_rows > 0) {
            if (!empty($errors)) {
                // Check for specific error types and create appropriate messages
                $has_duplicate_emails = false;
                $has_required_fields = false;
                $has_invalid_fields = false;
                $has_clinic_errors = false;
                
                foreach ($errors as $error) {
                    if (strpos($error, 'already exists') !== false) {
                        $has_duplicate_emails = true;
                    } elseif (strpos($error, 'is required') !== false) {
                        $has_required_fields = true;
                    } elseif (strpos($error, 'Invalid') !== false) {
                        $has_invalid_fields = true;
                    } elseif (strpos($error, 'Clinic') !== false && strpos($error, 'does not exist') !== false) {
                        $has_clinic_errors = true;
                    }
                }
                
                // Create specific error messages
                $error_parts = [];
                if ($has_duplicate_emails) {
                    $error_parts[] = __('Email already exists', 'kivicare-pro');
                }
                if ($has_required_fields) {
                    $error_parts[] = __('Required fields missing', 'kivicare-pro');
                }
                if ($has_invalid_fields) {
                    $error_parts[] = __('Invalid field format', 'kivicare-pro');
                }
                if ($has_clinic_errors) {
                    $error_parts[] = __('Clinic not found', 'kivicare-pro');
                }
                
                $toast_error_message = !empty($errors) ? $errors[0] : __('Data not imported', 'kivicare-pro');
            } else {
                $toast_error_message = !empty($errors) ? $errors[0] : __('Data not imported', 'kivicare-pro');
            }
        }
        
        return [
            'total_rows' => $total_rows,
            'inserted_rows' => $inserted_rows,
            'errors' => [], // Don't show individual errors
            'error_summary' => [], // Don't show error summary
            'toast_error_message' => $toast_error_message // Single error message for toast
        ];
    }

    /**
     * Validate doctor row data
     */
    private function validateDoctorRow($row, $required_fields, $row_number) {
        // Check for required fields
        foreach ($required_fields as $field) {
            if (empty($row[$field])) {
                return [
                    'valid' => false,
                    'error' => sprintf(__('Row %d: %s is required', 'kivicare-pro'), $row_number, $field)
                ];
            }
        }

        // Validate email format - strict validation
        $email = trim($row['email']);
        if (!preg_match('/^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/', $email)) {
            return [
                'valid' => false,
                'error' => sprintf(__('Row %d: Invalid email format', 'kivicare-pro'), $row_number)
            ];
        }

        // Validate gender
        $allowed_genders = ['male', 'female', 'other'];
        if (!in_array(strtolower($row['gender']), $allowed_genders)) {
            return [
                'valid' => false,
                'error' => sprintf(__('Row %d: Gender must be male, female, or other', 'kivicare-pro'), $row_number)
            ];
        }

        // Validate contact number
        $contact = trim($row['contact']);
        if (!preg_match('/^[\d\s\-\+\(\)]+$/', $contact)) {
            return [
                'valid' => false,
                'error' => sprintf(__('Row %d: Invalid contact number format', 'kivicare-pro'), $row_number)
            ];
        }

        return ['valid' => true];
    }

    /**
     * Validate clinic exists by ID if specified in CSV
     */
    private function validateClinicById($row, $row_number) {
        $clinic_id = trim($row['clinic_id'] ?? '');
        
        // If no clinic specified, skip validation
        if (empty($clinic_id)) {
            return ['valid' => true];
        }
        
        // Check if clinic exists by ID
        $clinic = $this->findClinicById($clinic_id);
        if (!$clinic) {
            return [
                'valid' => false,
                'error' => sprintf(__('Row %d: Clinic with ID "%s" does not exist. Please use a valid clinic ID.', 'kivicare-pro'), $row_number, $clinic_id)
            ];
        }
        
        return ['valid' => true];
    }

    /**
     * Prepare doctor data for creation
     */
    private function prepareDoctorData($row) {
        // Get clinic ID from CSV data or fallback to current user's clinic
        $clinic_id = $this->getClinicIdFromCsvData($row);

        // Format contact number with country codes
        $country_calling_code = $row['country_calling_code'] ?? '';
        $country_code = $row['country_code'] ?? '';
        $contact = $row['contact'] ?? '';
        
        $formatted_contact = $this->formatContactNumber($country_calling_code, $country_code, $contact);

        // Parse specializations
        $specializations = $this->parseSpecializations($row['specialization'] ?? '');

        // Parse status from CSV (default to active if not provided)
        $csv_status = $this->parseStatus($row['status'] ?? 'active');

        return [
            'first_name' => trim($row['first_name']),
            'last_name' => trim($row['last_name']),
            'email' => trim($row['email']),
            'mobile_number' => $formatted_contact,
            'gender' => strtolower(trim($row['gender'])),
            'clinic_id' => $clinic_id,
            'specialties' => $specializations,
            'status' => $csv_status, // Use status from CSV
            'address' => $row['address'] ?? '',
            'city' => $row['city'] ?? '',
            'country' => $row['country'] ?? '',
            'postal_code' => $row['postal_code'] ?? '',
            'dob' => $row['dob'] ?? '',
            'experience_years' => $row['experience'] ?? '',
            'blood_group' => $row['blood_group'] ?? '',
            'description' => $row['description'] ?? '',
            'profile_image' => $row['profile_image'] ?? ''
        ];
    }

    /**
     * Get clinic ID from CSV data or fallback to current user's clinic
     * Only uses existing clinics, does not create new ones
     */
    private function getClinicIdFromCsvData($row) {
        // Check if CSV has clinic_id
        $clinic_id = trim($row['clinic_id'] ?? '');
        
        if (!empty($clinic_id)) {
            // Try to find existing clinic by ID
            $clinic = $this->findClinicById($clinic_id);
            if ($clinic) {
                return $clinic->id;
            }
            
            // If clinic not found, log warning and use default clinic
            KCErrorLogger::instance()->error("Clinic not found for import: ID='{$clinic_id}'. Using default clinic.");
        }
        
        // Fallback to current user's clinic (do not create new clinic)
        $current_user_role = wp_get_current_user()->roles[0] ?? '';
        return $this->getClinicIdForUser($current_user_role);
    }

    /**
     * Find clinic by ID using KCClinic model
     */
    private function findClinicById($clinic_id) {
        try {
            $clinic = KCClinic::query()->where('id', $clinic_id)->first();
            return $clinic;
        } catch (\Exception $e) {
            KCErrorLogger::instance()->error("Error finding clinic by ID: " . $e->getMessage());
            return null;
        }
    }


    /**
     * Get clinic ID for current user
     */
    private function getClinicIdForUser($user_role) {
        if (isKiviCareProActive()) {
            if ($user_role === 'kivicare_clinic_admin') {
                return KCClinic::getClinicIdOfClinicAdmin();
            } elseif ($user_role === 'kivicare_receptionist') {
                return KCClinic::getClinicIdOfReceptionist();
            }
        }
        
        // Default clinic ID
        return KCClinic::kcGetDefaultClinicId();
    }

    /**
     * Format contact number with country codes
     */
    private function formatContactNumber($country_calling_code, $country_code, $contact) {
        // Remove any existing country codes from contact
        // $contact = preg_replace('/^\+?\d{1,4}/', '', $contact);
        $contact = trim($contact);
        
        // Add country calling code if provided
        if (!empty($country_calling_code)) {
            $country_calling_code = preg_replace('/[^\d]/', '', $country_calling_code);
             // Check if contact already starts with country code
             if (strpos($contact, $country_calling_code) === 0) {
                $contact = substr($contact, strlen($country_calling_code));
            }
            return '+' . $country_calling_code . $contact;
        }
        
        return $contact;
    }

    /**
     * Parse status from CSV value
     */
    private function parseStatus($status_value) {
        $status_value = strtolower(trim($status_value));
        
        // Handle different status formats
        switch ($status_value) {
            case 'inactive':
            case '1':
                return 1; // inactive status
            case 'active':
            case '0':
                return 0; // Active status
            default:
                return 0; // Default to active
        }
    }

    /**
     * Parse specializations from string
     */
    private function parseSpecializations($specialization_string) {
        if (empty($specialization_string)) {
            return [];
        }

        // Split by common delimiters
        $specializations = preg_split('/[,;|]/', $specialization_string);
        $result = [];

        foreach ($specializations as $spec) {
            $spec = trim($spec);
            if (!empty($spec)) {
                // Try to find existing specialization by name
                $existing_spec = $this->findSpecializationByName($spec);
                if ($existing_spec) {
                    $result[] = [
                        'id' => $existing_spec['id'],
                        'label' => $existing_spec['label']
                    ];
                } else {
                    // Create new specialization entry
                    $new_spec_data = [
                        'type' => 'specialization',
                        'label' => $spec,
                        'value' => sanitize_title($spec),
                        'status' => 1
                    ];
                    
                    $created_spec_id = KCStaticData::create($new_spec_data);
                    
                    if ($created_spec_id && !is_wp_error($created_spec_id)) {
                        $result[] = [
                            'id' => $created_spec_id,
                            'label' => $spec
                        ];
                    }
                }
            }
        }

        return $result;
    }

    /**
     * Find specialization by name using KCStaticData model
     */
    private function findSpecializationByName($name) {
        try {
            $result = KCStaticData::query()
                ->where('type', 'specialization')
                ->where('label', $name)
                ->first();
            
            return $result ? $result->toArray() : null;
        } catch (\Exception $e) {
            KCErrorLogger::instance()->error("Error finding specialization by name: " . $e->getMessage());
            return null;
        }
    }

    /**
     * Check if doctor already exists
     */
    private function doctorExists($email) {
        $existingDoctor = KCDoctor::table('d')
            ->where('d.user_email', '=', $email)
            ->first();
        
        return $existingDoctor !== null;
    }

    /**
     * Create doctor
     */
    private function createDoctor($doctor_data,$sendEmailNotification, $sendSmsNotification) {
        global $wpdb;
        
        try {
            // Start transaction for this doctor creation
            $wpdb->query('START TRANSACTION');

            // Create new KCDoctor instance (same as regular doctor creation)
            $doctor = new KCDoctor();

            // Set doctor properties
            $doctor->username = kcGenerateUsername($doctor_data['first_name']);
            $doctor->password = kcGenerateRandomString(12);
            $doctor->email = sanitize_email($doctor_data['email']);
            $doctor->firstName = $doctor_data['first_name'];
            $doctor->lastName = $doctor_data['last_name'];
            $doctor->displayName = $doctor_data['first_name'] . ' ' . $doctor_data['last_name'];
            $doctor->gender = $doctor_data['gender'];
            $doctor->bloodGroup = $doctor_data['blood_group'] ?? '';
            $doctor->contactNumber = $doctor_data['mobile_number'];
            $doctor->dob = $doctor_data['dob'] ?? '';
            $doctor->experience = $doctor_data['experience_years'] ?? '';
            $doctor->signature = '';
            $doctor->description = $doctor_data['description'] ?? '';
            $doctor->address = $doctor_data['address'] ?? '';
            $doctor->city = $doctor_data['city'] ?? '';
            $doctor->country = $doctor_data['country'] ?? '';
            $doctor->postalCode = $doctor_data['postal_code'] ?? '';
            $doctor->status = $doctor_data['status'];
            $doctor->qualifications = [];
            $doctor->specialties = $doctor_data['specialties'];
            $doctor->clinicId = $doctor_data['clinic_id'];
            
            // Add profile image if provided
            if (!empty($doctor_data['profile_image'])) {
                $doctor->profileImage = (int)$doctor_data['profile_image'];
            }

            // Save doctor
            if (!$doctor->save()) {
                $wpdb->query('ROLLBACK');
                return [
                    'success' => false,
                    'error' => __('Failed to save doctor', 'kivicare-pro')
                ];
            }

            // Save doctor clinic mapping
            $this->saveDoctorClinic($doctor->id, $doctor_data['clinic_id']);
            
            // Handle profile image (URL or ID)
            if (!empty($doctor_data['profile_image'])) {
                $profile_image_id = $this->handleProfileImageForDoctor($doctor_data['profile_image'], $doctor->id);
                if ($profile_image_id) {
                    update_user_meta($doctor->id, 'doctor_profile_image', $profile_image_id);
                }
            }

            // Commit transaction for this doctor
            $wpdb->query('COMMIT');
            
            $doctorData = [
            'id' => $doctor->id,
            'user_id' => $doctor->id,
            'first_name' => $doctor->firstName,
            'last_name' => $doctor->lastName,
            'email' => $doctor->email,
            'username' => $doctor->username,
            'temp_password' => $doctor->password,
            'contact_number' => $doctor->contactNumber,
            'clinic_id' => $doctor->clinicId,
            'dob' => $doctor->dob,
            'gender' => $doctor->gender,
            'blood_group' => $doctor->bloodGroup,
            'experience' => $doctor->experience,
            'signature' => $doctor->signature,
            'description' => $doctor->description,
            'address' => $doctor->address,
            'city' => $doctor->city,
            'country' => $doctor->country,
            'postal_code' => $doctor->postalCode,
            'status' => $doctor->status,
            'qualifications' => $doctor->qualifications,
            'specialties' => $doctor->specialties,
            'doctor_image_url' => $doctor->profileImage ? wp_get_attachment_url($doctor->profileImage) : '',
            'created_at' => current_time('mysql'),
            ];
            // Send notifications if requested (after successful creation)
            if ($sendEmailNotification) {
                do_action('kc_doctor_save', $doctorData, new WP_REST_Request());
            } elseif ($sendSmsNotification) {
                do_action('kc_doctor_register', $doctorData);
            }

            return [
                'success' => true,
                'doctor_id' => $doctor->id
            ];

        } catch (\Exception $e) {
            // Rollback transaction on error
            $wpdb->query('ROLLBACK');
            return [
                'success' => false,
                'error' => $e->getMessage()
            ];
        }
    }

    /**
     * Handle profile image for doctor (URL or ID)
     */
    private function handleProfileImageForDoctor($profile_image, $doctor_id) {
        if (empty($profile_image)) {
            return null;
        }
        
        // If it's already a numeric ID, return it
        if (is_numeric($profile_image)) {
            return (int)$profile_image;
        }
        
        // If it's a URL, validate and download
        if (filter_var($profile_image, FILTER_VALIDATE_URL)) {
            // Check if URL is valid before downloading
            if (!$this->isValidImageUrl($profile_image)) {
                return null;
            }
            return $this->downloadImageAndCreateAttachment($profile_image, $doctor_id);
        }
        
        return null;
    }
    
    /**
     * Check if image URL is valid (returns 200 status)
     */
    private function isValidImageUrl($image_url) {
        try {
            $response = wp_remote_head($image_url, ['timeout' => 10]);
            
            if (is_wp_error($response)) {
                return false;
            }
            
            $status_code = wp_remote_retrieve_response_code($response);
            
            // Check if status is 200 (OK)
            if ($status_code !== 200) {
                return false;
            }
            
            // Check if content type is image
            $content_type = wp_remote_retrieve_header($response, 'content-type');
            if (empty($content_type) || strpos($content_type, 'image') === false) {
                return false;
            }
            
            return true;
        } catch (\Exception $e) {
            return false;
        }
    }
    
    /**
     * Download image from URL and create WordPress attachment
     */
    private function downloadImageAndCreateAttachment($image_url, $user_id) {
        try {
            // Download image
            $response = wp_remote_get($image_url, ['timeout' => 30]);
            if (is_wp_error($response)) {
                return null;
            }

            $image_data = wp_remote_retrieve_body($response);
            if (empty($image_data)) {
                return null;
            }
            
            // Get file info
            $filename = basename(parse_url($image_url, PHP_URL_PATH));
            if (empty($filename) || strpos($filename, '.') === false) {
                $filename = 'doctor-' . $user_id . '-' . time() . '.jpg';
            }
            
            // Upload to WordPress
            $upload = wp_upload_bits($filename, null, $image_data);
            if ($upload['error']) {
                return null;
            }
            
            // Create attachment
            $attachment = [
                'post_mime_type' => wp_check_filetype($upload['file'])['type'],
                'post_title' => sanitize_file_name($filename),
                'post_content' => '',
                'post_status' => 'inherit'
            ];
            
            $attachment_id = wp_insert_attachment($attachment, $upload['file']);
            if (is_wp_error($attachment_id)) {
                return null;
            }
            
            // Generate metadata
            require_once(ABSPATH . 'wp-admin/includes/image.php');
            $attachment_data = wp_generate_attachment_metadata($attachment_id, $upload['file']);
            wp_update_attachment_metadata($attachment_id, $attachment_data);
            
            return $attachment_id;
            
        } catch (\Exception $e) {
            KCErrorLogger::instance()->error('Failed to download profile image: ' . $e->getMessage());
            return null;
        }
    }

    /**
     * Save doctor clinic mapping using KCDoctorClinicMapping
     */
    private function saveDoctorClinic($doctor_id, $clinic_id) {
        try {
            // Create doctor clinic mapping using the mapping model
            $mapping_data = [
                'doctorId' => (int)$doctor_id,
                'clinicId' => (int)$clinic_id,
                'owner' => 0,
                'createdAt' => current_time('mysql')
            ];
            
            KCDoctorClinicMapping::create($mapping_data);
        } catch (\Exception $e) {
            KCErrorLogger::instance()->error("Failed to add doctor to clinic: " . $e->getMessage());
        }
    }


    /**
     * Validate receptionist row data
     */
    private function validateReceptionistRow($row, $required_fields, $row_number) {
        // Check for required fields
        foreach ($required_fields as $field) {
            if (empty($row[$field])) {
                return [
                    'valid' => false,
                    'error' => sprintf(__('Row %d: %s is required', 'kivicare-pro'), $row_number, $field)
                ];
            }
        }

        // Validate email format - strict validation
        $email = trim($row['email']);
        if (!preg_match('/^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/', $email)) {
            return [
                'valid' => false,
                'error' => sprintf(__('Row %d: Invalid email format', 'kivicare-pro'), $row_number)
            ];
        }

        // Validate gender
        $allowed_genders = ['male', 'female', 'other'];
        if (!in_array(strtolower($row['gender']), $allowed_genders)) {
            return [
                'valid' => false,
                'error' => sprintf(__('Row %d: Gender must be male, female, or other', 'kivicare-pro'), $row_number)
            ];
        }

        // Validate contact number
        $contact = trim($row['contact']);
        if (!preg_match('/^[\d\s\-\+\(\)]+$/', $contact)) {
            return [
                'valid' => false,
                'error' => sprintf(__('Row %d: Invalid contact number format', 'kivicare-pro'), $row_number)
            ];
        }

        return ['valid' => true];
    }

    /**
     * Prepare receptionist data for creation
     */
    private function prepareReceptionistData($row) {
        // Get clinic ID from CSV data or fallback to current user's clinic
        $clinic_id = $this->getClinicIdFromCsvData($row);

        // Format contact number with country codes
        $country_calling_code = $row['country_calling_code'] ?? '';
        $country_code = $row['country_code'] ?? '';
        $contact = $row['contact'] ?? '';
        
        $formatted_contact = $this->formatContactNumber($country_calling_code, $country_code, $contact);

        // Parse status from CSV (default to active if not provided)
        $csv_status = $this->parseStatus($row['status'] ?? 'active');

        return [
            'first_name' => trim($row['first_name']),
            'last_name' => trim($row['last_name']),
            'email' => trim($row['email']),
            'mobile_number' => $formatted_contact,
            'gender' => strtolower(trim($row['gender'])),
            'clinic_id' => $clinic_id,
            'status' => $csv_status,
            'address' => $row['address'] ?? '',
            'city' => $row['city'] ?? '',
            'country' => $row['country'] ?? '',
            'postal_code' => $row['postal_code'] ?? '',
            'dob' => $row['dob'] ?? '',
            'password' => $row['password'] ?? '',
            'profile_image' => $row['profile_image'] ?? ''
        ];
    }

    /**
     * Check if receptionist already exists
     */
    private function receptionistExists($email) {
        $existingReceptionist = get_user_by('email', $email);
        return $existingReceptionist !== false;
    }

    /**
     * Create receptionist
     */
    private function createReceptionist($receptionist_data, $sendEmailNotification, $sendSmsNotification) {
        global $wpdb;
        
        try {
            // Start transaction for this receptionist creation
            $wpdb->query('START TRANSACTION');

            // Generate username and password
            $username = kcGenerateUsername($receptionist_data['first_name']);
            $password = !empty($receptionist_data['password']) ? $receptionist_data['password'] : kcGenerateRandomString(12);

            // Create WordPress user
            $user_id = wp_create_user(
                $username,
                $password,
                $receptionist_data['email']
            );

            if (is_wp_error($user_id)) {
                $wpdb->query('ROLLBACK');
                return [
                    'success' => false,
                    'error' => $user_id->get_error_message()
                ];
            }

            // Update user meta
            update_user_meta($user_id, 'first_name', $receptionist_data['first_name']);
            update_user_meta($user_id, 'last_name', $receptionist_data['last_name']);
            update_user_meta($user_id, 'status', $receptionist_data['status']);

            // Store basic data in JSON format (this is how the system expects it)
            $basic_data = [
                'mobile_number' => $receptionist_data['mobile_number'],
                'gender' => $receptionist_data['gender'],
                'address' => $receptionist_data['address'],
                'city' => $receptionist_data['city'],
                'country' => $receptionist_data['country'],
                'postal_code' => $receptionist_data['postal_code'],
                'dob' => $receptionist_data['dob']
            ];
            update_user_meta($user_id, 'basic_data', json_encode($basic_data));

            // Set user role
            $user = new \WP_User($user_id);
            $user->set_role('kivicare_receptionist');

            // Save receptionist clinic mapping using KCReceptionistClinicMapping
            $this->saveReceptionistClinic($user_id, $receptionist_data['clinic_id']);

            // Handle profile image if provided
            if (!empty($receptionist_data['profile_image'])) {
                $profile_image_id = $this->handleProfileImageForDoctor($receptionist_data['profile_image'], $user_id);
                if ($profile_image_id) {
                    update_user_meta($user_id, 'receptionist_profile_image', $profile_image_id);
                }
            }

            // Commit transaction for this receptionist
            $wpdb->query('COMMIT');

            $receptionistData =[
                'id' => $user_id,
                'user_id' => $user_id,
                'first_name' => $receptionist_data['first_name'],
                'last_name' => $receptionist_data['last_name'],
                'email' => $receptionist_data['email'],
                'user_name' => $username,
                'user_password' => $password,
                'contact_number' => $receptionist_data['mobile_number'],
                'clinic_id' => $receptionist_data['clinic_id'],
                'dob' => $receptionist_data['dob'],
                'created_at' => current_time('mysql'),
            ];
            // Send notifications if requested (after successful creation)
            if ($sendEmailNotification) {
                do_action('kc_receptionist_save', $receptionistData);
            }else if($sendSmsNotification) {
                do_action('kc_receptionist_created', $receptionistData);
            }

            return [
                'success' => true,
                'receptionist_id' => $user_id
            ];

        } catch (\Exception $e) {
            // Rollback transaction on error
            $wpdb->query('ROLLBACK');
            return [
                'success' => false,
                'error' => $e->getMessage()
            ];
        }
    }

    /**
     * Save receptionist clinic mapping using KCReceptionistClinicMapping
     */
    private function saveReceptionistClinic($receptionist_id, $clinic_id) {
        try {
            // Create receptionist clinic mapping using the mapping model
            $mapping_data = [
                'receptionistId' => (int)$receptionist_id,
                'clinicId' => (int)$clinic_id,
                'createdAt' => current_time('mysql')
            ];
            
            // Use the KCReceptionistClinicMapping model
            KCReceptionistClinicMapping::create($mapping_data);
        } catch (\Exception $e) {
            KCErrorLogger::instance()->error("Failed to add receptionist to clinic: " . $e->getMessage());
        }
    }



    /**
     * Process receptionists import
     */
    private function processReceptionistsImport($data,$sendEmailNotification, $sendSmsNotification) {
        $total_rows = count($data);
        $inserted_rows = 0;
        $errors = [];
        $required_fields = [
            'first_name', 'last_name', 'email', 'country_calling_code', 
            'country_code', 'contact', 'gender'
        ];
        
        // Optional clinic fields
        $clinic_fields = ['clinic_id'];

        // Start database transaction
        global $wpdb;
        $wpdb->query('START TRANSACTION');

        try {
            foreach ($data as $index => $row) {
                $row_number = $index + 2; // +2 because index starts at 0 and we skip header row
                
                try {
                    // Validate required fields
                    $validation_result = $this->validateReceptionistRow($row, $required_fields, $row_number);
                    if (!$validation_result['valid']) {
                        $errors[] = $validation_result['error'];
                        continue;
                    }

                    // Validate clinic exists if specified
                    $clinic_validation = $this->validateClinicById($row, $row_number);
                    if (!$clinic_validation['valid']) {
                        $errors[] = $clinic_validation['error'];
                        continue;
                    }

                    // Prepare receptionist data
                    $receptionist_data = $this->prepareReceptionistData($row);
                    
                    // Check if receptionist already exists
                    if ($this->receptionistExists($receptionist_data['email'])) {
                        $errors[] = sprintf(__('Row %d: Receptionist with email %s already exists', 'kivicare-pro'), $row_number, $receptionist_data['email']);
                        continue;
                    }

                    // Create receptionist
                    $result = $this->createReceptionist($receptionist_data,$sendEmailNotification, $sendSmsNotification);
                    
                    if ($result['success']) {
                        $inserted_rows++;
                    } else {
                        $errors[] = sprintf(__('Row %d: %s', 'kivicare-pro'), $row_number, $result['error']);
                    }

                } catch (\Exception $e) {
                    $errors[] = sprintf(__('Row %d: %s', 'kivicare-pro'), $row_number, $e->getMessage());
                }
            }

            // Commit transaction if all operations successful
            $wpdb->query('COMMIT');

        } catch (\Exception $e) {
            // Rollback transaction on any error
            $wpdb->query('ROLLBACK');
            $errors[] = sprintf(__('Import failed: %s', 'kivicare-pro'), $e->getMessage());
        }

        // Create a single error message for toast
        $toast_error_message = '';
        if ($inserted_rows === 0 && $total_rows > 0) {
            if (!empty($errors)) {
                // Check for specific error types and create appropriate messages
                $has_duplicate_emails = false;
                $has_required_fields = false;
                $has_invalid_fields = false;
                $has_clinic_errors = false;
                
                foreach ($errors as $error) {
                    if (strpos($error, 'already exists') !== false) {
                        $has_duplicate_emails = true;
                    } elseif (strpos($error, 'is required') !== false) {
                        $has_required_fields = true;
                    } elseif (strpos($error, 'Invalid') !== false) {
                        $has_invalid_fields = true;
                    } elseif (strpos($error, 'Clinic') !== false && strpos($error, 'does not exist') !== false) {
                        $has_clinic_errors = true;
                    }
                }
                
                // Create specific error messages
                $error_parts = [];
                if ($has_duplicate_emails) {
                    $error_parts[] = __('Email already exists', 'kivicare-pro');
                }
                if ($has_required_fields) {
                    $error_parts[] = __('Required fields missing', 'kivicare-pro');
                }
                if ($has_invalid_fields) {
                    $error_parts[] = __('Invalid field format', 'kivicare-pro');
                }
                if ($has_clinic_errors) {
                    $error_parts[] = __('Clinic not found', 'kivicare-pro');
                }
                
                $toast_error_message = !empty($errors) ? $errors[0] : __('Data not imported', 'kivicare-pro');
            } else {
                $toast_error_message = !empty($errors) ? $errors[0] : __('Data not imported', 'kivicare-pro');
            }
        }
        
        return [
            'total_rows' => $total_rows,
            'inserted_rows' => $inserted_rows,
            'errors' => [], // Don't show individual errors
            'error_summary' => [], // Don't show error summary
            'toast_error_message' => $toast_error_message // Single error message for toast
        ];
    }

    /**
     * Process clinics import
     */
    private function processClinicsImport($data,$sendEmailNotification, $sendSmsNotification) {
        $total_rows = count($data);
        $inserted_rows = 0;
        $errors = [];
        $required_fields = [
            'clinic_name', 'email', 'country_calling_code', 'country_code', 'contact', 
            'specialization', 'address', 'city', 'country', 'postal_code',
            'clinic_admin_first_name', 'clinic_admin_last_name', 'clinic_admin_email', 
            'clinic_admin_country_calling_code', 'clinic_admin_country_code', 
            'clinic_admin_contact', 'clinic_admin_gender'
        ];

        // Start database transaction
        global $wpdb;
        $wpdb->query('START TRANSACTION');

        try {
            foreach ($data as $index => $row) {
                $row_number = $index + 2; // +2 because index starts at 0 and we skip header row
                
                try {
                    // Validate required fields
                    $validation_result = $this->validateClinicRow($row, $required_fields, $row_number);
                    if (!$validation_result['valid']) {
                        $errors[] = $validation_result['error'];
                        continue;
                    }

                    // Prepare clinic data
                    $clinic_data = $this->prepareClinicData($row);
                    
                    // Check if clinic already exists
                    if ($this->clinicExists($clinic_data['email'])) {
                        $errors[] = sprintf(__('Row %d: Clinic with email %s already exists', 'kivicare-pro'), $row_number, $clinic_data['email']);
                        continue;
                    }

                    // Check if admin email already exists and handle appropriately
                    $admin_check_result = $this->checkAdminEmailAvailability($clinic_data['admin_email']);
                    if (!$admin_check_result['available']) {
                        $errors[] = sprintf(__('Row %d: %s', 'kivicare-pro'), $row_number, $admin_check_result['message']);
                        continue;
                    }

                    // Create clinic with admin (pass the admin check result)
                    $result = $this->createClinicWithAdmin($clinic_data, $sendEmailNotification, $sendSmsNotification, $admin_check_result);
                    
                    if ($result['success']) {
                        $inserted_rows++;
                    } else {
                        $errors[] = sprintf(__('Row %d: %s', 'kivicare-pro'), $row_number, $result['error']);
                    }

                } catch (\Exception $e) {
                    $errors[] = sprintf(__('Row %d: %s', 'kivicare-pro'), $row_number, $e->getMessage());
                }
            }

            // Commit transaction if all operations successful
            $wpdb->query('COMMIT');

        } catch (\Exception $e) {
            // Rollback transaction on any error
            $wpdb->query('ROLLBACK');
            $errors[] = sprintf(__('Import failed: %s', 'kivicare-pro'), $e->getMessage());
        }

        // Create a single error message for toast
        $toast_error_message = '';
        if ($inserted_rows === 0 && $total_rows > 0) {
            if (!empty($errors)) {
                // Check for specific error types and create appropriate messages
                $has_duplicate_emails = false;
                $has_required_fields = false;
                $has_invalid_fields = false;
                
                foreach ($errors as $error) {
                    if (strpos($error, 'already exists') !== false) {
                        $has_duplicate_emails = true;
                    } elseif (strpos($error, 'is required') !== false) {
                        $has_required_fields = true;
                    } elseif (strpos($error, 'Invalid') !== false) {
                        $has_invalid_fields = true;
                    }
                }
                
                // Create specific error messages
                $error_parts = [];
                if ($has_duplicate_emails) {
                    $error_parts[] = __('Email already exists', 'kivicare-pro');
                }
                if ($has_required_fields) {
                    $error_parts[] = __('Required fields missing', 'kivicare-pro');
                }
                if ($has_invalid_fields) {
                    $error_parts[] = __('Invalid field format', 'kivicare-pro');
                }
                
                $toast_error_message = !empty($errors) ? $errors[0] : __('Data not imported', 'kivicare-pro');
            } else {
                $toast_error_message = !empty($errors) ? $errors[0] : __('Data not imported', 'kivicare-pro');
            }
        }
        
        return [
            'total_rows' => $total_rows,
            'inserted_rows' => $inserted_rows,
            'errors' => [], // Don't show individual errors
            'error_summary' => [], // Don't show error summary
            'toast_error_message' => $toast_error_message // Single error message for toast
        ];
    }

    /**
     * Validate clinic row data
     */
    private function validateClinicRow($row, $required_fields, $row_number) {
        // Check for required fields
        foreach ($required_fields as $field) {
            if (empty($row[$field])) {
                return [
                    'valid' => false,
                    'error' => sprintf(__('Row %d: %s is required', 'kivicare-pro'), $row_number, $field)
                ];
            }
        }

        // Validate clinic email format - strict validation
        $clinic_email = trim($row['email']);
        if (!preg_match('/^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/', $clinic_email)) {
            return [
                'valid' => false,
                'error' => sprintf(__('Row %d: Invalid clinic email format', 'kivicare-pro'), $row_number)
            ];
        }

        // Validate admin email format - strict validation
        $admin_email = trim($row['clinic_admin_email']);
        if (!preg_match('/^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/', $admin_email)) {
            return [
                'valid' => false,
                'error' => sprintf(__('Row %d: Invalid admin email format', 'kivicare-pro'), $row_number)
            ];
        }

        // Validate admin gender
        $allowed_genders = ['male', 'female', 'other'];
        if (!in_array(strtolower($row['clinic_admin_gender']), $allowed_genders)) {
            return [
                'valid' => false,
                'error' => sprintf(__('Row %d: Admin gender must be male, female, or other', 'kivicare-pro'), $row_number)
            ];
        }

        // Validate phone number
        $phone = trim($row['contact']);
        if (!preg_match('/^[\d\s\-\+\(\)]+$/', $phone)) {
            return [
                'valid' => false,
                'error' => sprintf(__('Row %d: Invalid phone number format', 'kivicare-pro'), $row_number)
            ];
        }

        // Validate admin contact
        $admin_contact = trim($row['clinic_admin_contact']);
        if (!preg_match('/^[\d\s\-\+\(\)]+$/', $admin_contact)) {
            return [
                'valid' => false,
                'error' => sprintf(__('Row %d: Invalid admin contact format', 'kivicare-pro'), $row_number)
            ];
        }

        return ['valid' => true];
    }

    /**
     * Prepare clinic data for creation
     */
    private function prepareClinicData($row) {
        // Format contact number with country codes
        $country_calling_code = $row['country_calling_code'] ?? '';
        $country_code = $row['country_code'] ?? '';
        $contact = $row['contact'] ?? '';
        $formatted_contact = $this->formatContactNumber($country_calling_code, $country_code, $contact);

        // Format admin contact number
        $admin_country_calling_code = $row['clinic_admin_country_calling_code'] ?? '';
        $admin_country_code = $row['clinic_admin_country_code'] ?? '';
        $admin_contact = $row['clinic_admin_contact'] ?? '';
        $formatted_admin_contact = $this->formatContactNumber($admin_country_calling_code, $admin_country_code, $admin_contact);

        return [
            'clinic_name' => trim($row['clinic_name']),
            'email' => trim($row['email']),
            'phone_number' => $formatted_contact,
            'address' => trim($row['address']),
            'city' => trim($row['city']),
            'state' => trim($row['state'] ?? ''),
            'country' => trim($row['country']),
            'postal_code' => trim($row['postal_code'] ?? ''),
            'country_code' => trim($row['country_code'] ?? ''),
            'country_calling_code' => trim($row['country_calling_code'] ?? ''),
            'specialization' => trim($row['specialization'] ?? ''),
            'status' => $this->parseStatus($row['status'] ?? '1'),
            'admin_first_name' => trim($row['clinic_admin_first_name']),
            'admin_last_name' => trim($row['clinic_admin_last_name']),
            'admin_email' => trim($row['clinic_admin_email']),
            'admin_contact' => $formatted_admin_contact,
            'admin_gender' => strtolower(trim($row['clinic_admin_gender'])),
            'admin_password' => trim($row['clinic_admin_password'] ?? wp_generate_password(12, false)),
            'admin_profile_image' => trim($row['clinic_admin_profile_image'] ?? ''),
            'clinic_profile_image' => trim($row['clinic_profile_image'] ?? '')
        ];
    }

    /**
     * Create clinic with admin
     */
    private function createClinicWithAdmin($clinic_data, $sendEmailNotification, $sendSmsNotification, $admin_check_result = null) {
        try {

            // Check if we should reuse an existing user or create a new one
            if (isset($admin_check_result['existing_user_id'])) {
                // Reuse existing orphaned clinic admin
                $admin_user_id = $admin_check_result['existing_user_id'];
                KCErrorLogger::instance()->error("Reusing existing clinic admin user with ID: " . $admin_user_id);
                
                // Update the existing user's information
                $admin_user_data = [
                    'ID' => $admin_user_id,
                    'user_login' => $clinic_data['admin_email'], // Keep existing login
                    'user_email' => $clinic_data['admin_email'],
                    'user_pass' => $clinic_data['admin_password'], // Update password
                    'first_name' => $clinic_data['admin_first_name'],
                    'last_name' => $clinic_data['admin_last_name'],
                    'display_name' => $clinic_data['admin_first_name'] . ' ' . $clinic_data['admin_last_name'],
                ];
                
                $update_result = wp_update_user($admin_user_data);
                if (is_wp_error($update_result)) {
                    return [
                        'success' => false,
                        'error' => 'Failed to update existing admin user: ' . $update_result->get_error_message()
                    ];
                }
                
            } else {
                // Create new clinic admin user
                $admin_user_data = [
                    'user_login' => $clinic_data['admin_email'],
                    'user_email' => $clinic_data['admin_email'],
                    'user_pass' => $clinic_data['admin_password'],
                    'first_name' => $clinic_data['admin_first_name'],
                    'last_name' => $clinic_data['admin_last_name'],
                    'display_name' => $clinic_data['admin_first_name'] . ' ' . $clinic_data['admin_last_name'],
                ];

                $admin_user_id = wp_insert_user($admin_user_data);

                if (is_wp_error($admin_user_id)) {
                    return [
                        'success' => false,
                        'error' => 'Failed to create admin user: ' . $admin_user_id->get_error_message()
                    ];
                }
                KCErrorLogger::instance()->error("Created new clinic admin user with ID: " . $admin_user_id);
            }

            // Ensure user has correct role
            $user = new \WP_User($admin_user_id);
            $user->set_role('kivicare_clinic_admin');

            // Prepare the basic_data array
            $basic_data = [
                'first_name' => $clinic_data['admin_first_name'],
                'last_name' => $clinic_data['admin_last_name'],
                'user_email' => $clinic_data['admin_email'],
                'mobile_number' => $clinic_data['admin_contact'],
                'dob' => isset($clinic_data['admin_dob']) ? $clinic_data['admin_dob'] : null,
                'gender' => $clinic_data['admin_gender'],
                'profile_image' => null,
                'country_calling_code_admin' => $clinic_data['country_calling_code'] ?? '',
                'country_code_admin' => $clinic_data['country_code'] ?? ''
            ];

            // Save as single JSON in usermeta
            update_user_meta($admin_user_id, 'basic_data', wp_json_encode($basic_data));
            
            // Handle admin profile image if provided
            if (!empty($clinic_data['admin_profile_image'])) {
                $profile_image_id = $this->handleProfileImageForDoctor($clinic_data['admin_profile_image'], $admin_user_id);
                if ($profile_image_id) {
                    update_user_meta($admin_user_id, 'clinic_admin_profile_image', $profile_image_id);
                }
            }

            // Parse specializations
            $specializations = $this->parseSpecializations($clinic_data['specialization']);

            // Create clinic
            $clinic = new KCClinic();
            $clinic->name = $clinic_data['clinic_name'];
            $clinic->email = $clinic_data['email'];
            $clinic->telephoneNo = $clinic_data['phone_number'];
            $clinic->address = $clinic_data['address'];
            $clinic->city = $clinic_data['city'];
            $clinic->state = $clinic_data['state'];
            $clinic->country = $clinic_data['country'];
            $clinic->postalCode = $clinic_data['postal_code'];
            $clinic->countryCode = $clinic_data['country_code'];
            $clinic->countryCallingCode = $clinic_data['country_calling_code'];
            $clinic->specialties = json_encode($specializations);
            $clinic->status = $clinic_data['status'];
            $clinic->clinicAdminId = $admin_user_id;
            $clinic->createdAt = current_time('mysql');

            $clinic_id = $clinic->save();

            if (is_wp_error($clinic_id)) {
                // Delete the admin user if clinic creation failed
                wp_delete_user($admin_user_id);
                return [
                    'success' => false,
                    'error' => 'Failed to create clinic: ' . $clinic_id->get_error_message()
                ];
            }
            
            // Handle clinic profile image if provided
            if (!empty($clinic_data['clinic_profile_image'])) {
                $clinic_image_id = $this->handleProfileImageForDoctor($clinic_data['clinic_profile_image'], $clinic_id);
                if ($clinic_image_id) {
                    // Update clinic with profile image
                    global $wpdb;
                    $wpdb->update(
                        $wpdb->prefix . 'kc_clinics',
                        ['profile_image' => $clinic_image_id],
                        ['id' => $clinic_id]
                    );
                }
            }

           $adminNotificationData = [
                'user_id' => $admin_user_id,
                'user_email' => $clinic_data['admin_email'],
                'username' => $clinic_data['admin_first_name'] . ' ' . $clinic_data['admin_last_name'],
                'password' => $clinic_data['admin_password'],
                'first_name' => $clinic_data['admin_first_name'],
                'last_name' => $clinic_data['admin_last_name'],
                'mobile_number' => $clinic_data['admin_contact'],
                'clinic_name' => $clinic_data['clinic_name'],
                'created_at' => current_time('mysql'),
            ];
            // Send notifications if enabled
            if ($sendEmailNotification) {
                
                do_action('kcpro_clinic_save', $adminNotificationData);

            }

            if ($sendSmsNotification) {
               do_action('kivicare_clinic_admin_registered', $adminNotificationData);

            }
            return [
                'success' => true,
                'clinic_id' => $clinic_id,
                'admin_id' => $admin_user_id
            ];

        } catch (\Exception $e) {
            return [
                'success' => false,
                'error' => $e->getMessage()
            ];
        }
    }


    /**
     * Check if clinic exists by email
     */
    private function clinicExists($email) {
        try {
            $clinic = KCClinic::query()->where('email', $email)->first();
            return !empty($clinic);
        } catch (\Exception $e) {
            KCErrorLogger::instance()->error("Error checking clinic existence: " . $e->getMessage());
            return false;
        }
    }

    /**
     * Check if admin email is available for clinic creation
     * Returns array with 'available' boolean and 'message' string
     */
    private function checkAdminEmailAvailability($email) {
        $user_id = email_exists($email);
        
        if (!$user_id) {
            // Email doesn't exist, available for new user
            return ['available' => true, 'message' => ''];
        }
        
        // Email exists, check if it's an orphaned clinic admin
        $user = get_user_by('id', $user_id);
        if (!$user) {
            return ['available' => false, 'message' => "User lookup failed for email $email"];
        }
        
        // Check if user is a clinic admin (check both roles and capabilities)
        if (!in_array('clinic_admin', $user->roles) && !user_can($user, 'clinic_admin')) {
            return ['available' => false, 'message' => "Email $email already exists for a non-clinic-admin user"];
        }
        
        // Check if this clinic admin is associated with an existing clinic
        $existing_clinic = KCClinic::query()->where('clinicAdminId', $user_id)->first();
        
        if ($existing_clinic) {
            return ['available' => false, 'message' => "Email $email is already associated with clinic '{$existing_clinic->name}'"];
        }
        
        // This is an orphaned clinic admin (clinic was deleted but user remains)
        // We can reuse this user
        return ['available' => true, 'message' => '', 'existing_user_id' => $user_id];
    }

    /**
     * Process patients import
     */
    private function processPatientsImport($data, $sendEmailNotification, $sendSmsNotification) {
        $total_rows = count($data);
        $inserted_rows = 0;
        $errors = [];
        $required_fields = [
            'first_name', 'last_name', 'email', 'country_calling_code', 
            'country_code', 'contact', 'gender'
        ];

        // Start database transaction
        global $wpdb;
        $wpdb->query('START TRANSACTION');

        try {
            foreach ($data as $index => $row) {
                $row_number = $index + 2; // +2 because index starts at 0 and we skip header row
                
                try {
                    // Validate required fields
                    $validation_result = $this->validatePatientRow($row, $required_fields, $row_number);
                    if (!$validation_result['valid']) {
                        $errors[] = $validation_result['error'];
                        continue;
                    }

                    // Validate clinic exists if specified
                    $clinic_validation = $this->validateClinicById($row, $row_number);
                    if (!$clinic_validation['valid']) {
                        $errors[] = $clinic_validation['error'];
                        continue;
                    }

                    // Prepare patient data
                    $patient_data = $this->preparePatientData($row);
                    
                    // Check if patient already exists
                    if ($this->patientExists($patient_data['email'])) {
                        $errors[] = sprintf(__('Row %d: Patient with email %s already exists', 'kivicare-pro'), $row_number, $patient_data['email']);
                        continue;
                    }

                    // Create patient
                    $result = $this->createPatient($patient_data, $sendEmailNotification, $sendSmsNotification);
                    
                    if ($result['success']) {
                        $inserted_rows++;
                    } else {
                        $errors[] = sprintf(__('Row %d: %s', 'kivicare-pro'), $row_number, $result['error']);
                    }

                } catch (\Exception $e) {
                    $errors[] = sprintf(__('Row %d: %s', 'kivicare-pro'), $row_number, $e->getMessage());
                }
            }

            // Commit transaction if all operations successful
            $wpdb->query('COMMIT');

        } catch (\Exception $e) {
            // Rollback transaction on any error
            $wpdb->query('ROLLBACK');
            $errors[] = sprintf(__('Import failed: %s', 'kivicare-pro'), $e->getMessage());
        }

        // Create a single error message for toast
        $toast_error_message = '';
        if ($inserted_rows === 0 && $total_rows > 0) {
            if (!empty($errors)) {
                // Check for specific error types and create appropriate messages
                $has_duplicate_emails = false;
                $has_required_fields = false;
                $has_invalid_fields = false;
                $has_clinic_errors = false;
                
                foreach ($errors as $error) {
                    if (strpos($error, 'already exists') !== false) {
                        $has_duplicate_emails = true;
                    } elseif (strpos($error, 'is required') !== false) {
                        $has_required_fields = true;
                    } elseif (strpos($error, 'Invalid') !== false) {
                        $has_invalid_fields = true;
                    } elseif (strpos($error, 'Clinic') !== false && strpos($error, 'does not exist') !== false) {
                        $has_clinic_errors = true;
                    }
                }
                
                // Create specific error messages
                $error_parts = [];
                if ($has_duplicate_emails) {
                    $error_parts[] = __('Email already exists', 'kivicare-pro');
                }
                if ($has_required_fields) {
                    $error_parts[] = __('Required fields missing', 'kivicare-pro');
                }
                if ($has_invalid_fields) {
                    $error_parts[] = __('Invalid field format', 'kivicare-pro');
                }
                if ($has_clinic_errors) {
                    $error_parts[] = __('Clinic not found', 'kivicare-pro');
                }
                
                $toast_error_message = !empty($errors) ? $errors[0] : __('Data not imported', 'kivicare-pro');
            } else {
                $toast_error_message = !empty($errors) ? $errors[0] : __('Data not imported', 'kivicare-pro');
            }
        }
        
        return [
            'total_rows' => $total_rows,
            'inserted_rows' => $inserted_rows,
            'errors' => [], // Don't show individual errors
            'error_summary' => [], // Don't show error summary
            'toast_error_message' => $toast_error_message // Single error message for toast
        ];
    }

    /**
     * Validate patient row data
     */
    private function validatePatientRow($row, $required_fields, $row_number) {
        // Check for required fields
        foreach ($required_fields as $field) {
            if (empty($row[$field])) {
                return [
                    'valid' => false,
                    'error' => sprintf(__('Row %d: %s is required', 'kivicare-pro'), $row_number, $field)
                ];
            }
        }

        // Validate email format - strict validation
        $email = trim($row['email']);
        if (!preg_match('/^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/', $email)) {
            return [
                'valid' => false,
                'error' => sprintf(__('Row %d: Invalid email format', 'kivicare-pro'), $row_number)
            ];
        }

        // Validate gender
        $allowed_genders = ['male', 'female', 'other'];
        if (!in_array(strtolower($row['gender']), $allowed_genders)) {
            return [
                'valid' => false,
                'error' => sprintf(__('Row %d: Gender must be male, female, or other', 'kivicare-pro'), $row_number)
            ];
        }

        // Validate contact number
        $contact = trim($row['contact']);
        if (!preg_match('/^[\d\s\-\+\(\)]+$/', $contact)) {
            return [
                'valid' => false,
                'error' => sprintf(__('Row %d: Invalid contact number format', 'kivicare-pro'), $row_number)
            ];
        }

        // Validate date of birth if provided
        if (!empty($row['dob'])) {
            $dob = trim($row['dob']);
            // Try to parse the date
            $date = \DateTime::createFromFormat('m/d/Y', $dob);
            if (!$date || $date->format('m/d/Y') !== $dob) {
                // Try alternative format
                $date = \DateTime::createFromFormat('Y-m-d', $dob);
                if (!$date || $date->format('Y-m-d') !== $dob) {
                    return [
                        'valid' => false,
                        'error' => sprintf(__('Row %d: Invalid date of birth format. Use MM/DD/YYYY or YYYY-MM-DD', 'kivicare-pro'), $row_number)
                    ];
                }
            }
        }

        return ['valid' => true];
    }

    /**
     * Prepare patient data for creation
     */
    private function preparePatientData($row) {
        // Get clinic ID from CSV data or fallback to current user's clinic
        $clinic_id = $this->getClinicIdFromCsvData($row);

        // Format contact number with country codes
        $country_calling_code = $row['country_calling_code'] ?? '';
        $country_code = $row['country_code'] ?? '';
        $contact = $row['contact'] ?? '';
        
        $formatted_contact = $this->formatContactNumber($country_calling_code, $country_code, $contact);

        // Parse date of birth
        $dob = '';
        if (!empty($row['dob'])) {
            $dob_input = trim($row['dob']);
            // Try to parse the date
            $date = \DateTime::createFromFormat('m/d/Y', $dob_input);
            if ($date) {
                $dob = $date->format('Y-m-d');
            } else {
                // Try alternative format
                $date = \DateTime::createFromFormat('Y-m-d', $dob_input);
                if ($date) {
                    $dob = $date->format('Y-m-d');
                }
            }
        }

        // Parse status from CSV (default to active if not provided)
        $csv_status = $this->parseStatus($row['status'] ?? 'active');

        return [
            'first_name' => trim($row['first_name']),
            'last_name' => trim($row['last_name']),
            'email' => trim($row['email']),
            'mobile_number' => $formatted_contact,
            'gender' => strtolower(trim($row['gender'])),
            'clinic_id' => $clinic_id,
            'status' => $csv_status,
            'address' => $row['address'] ?? '',
            'city' => $row['city'] ?? '',
            'country' => $row['country'] ?? '',
            'postal_code' => $row['postal_code'] ?? '',
            'dob' => $dob,
            'blood_group' => $row['blood_group'] ?? '',
            'password' => $row['password'] ?? wp_generate_password(12, false),
            'profile_image' => $row['profile_image'] ?? ''
        ];
    }

    /**
     * Create patient
     */
    private function createPatient($patient_data, $sendEmailNotification, $sendSmsNotification) {
        try {
            // Check if patient with same email already exists
            $existingPatient = KCPatient::table('p')
                ->where('p.user_email', '=', $patient_data['email'])
                ->first();   

            if ($existingPatient) {
                return [
                    'success' => false,
                    'error' => __('A patient with this email already exists. Please use a different email.', 'kivicare-pro')
                ];
            }

            // Check if patient unique ID already exists
            if (!empty($patient_data['patient_unique_id'])) {
                if ($this->isPatientUniqueIdExists($patient_data['patient_unique_id'])) {
                    return [
                        'success' => false,
                        'error' => __('Patient unique ID is already used. Please use a different unique ID.', 'kivicare-pro')
                    ];
                }
            }

            // Clean contact number
            $patient_data['mobile_number'] = preg_replace('/[^0-9+]/', '', $patient_data['mobile_number']);

            // Determine clinic ID based on user role or provided data
            $current_user_role = $this->kcbase->getLoginUserRole();  
            if (isKiviCareProActive()) { 
                if ($current_user_role == $this->kcbase->getClinicAdminRole()) {
                    $clinic_id = KCClinic::getClinicIdOfClinicAdmin();
                } elseif ($current_user_role == $this->kcbase->getReceptionistRole()) {
                    $clinic_id = KCClinic::getClinicIdOfReceptionist();
                } else {
                    $clinic_id = $patient_data['clinic_id'] ?? KCClinic::kcGetDefaultClinicId();
                }
            } else {
                // Default clinic id if pro not active
                $clinic_id = KCClinic::kcGetDefaultClinicId();
            }

            // Create new KCPatient instance
            $patient = new KCPatient();

            // Set patient properties directly (matching PatientController structure)
            $patient->username = kcGenerateUsername($patient_data['first_name']);
            $patient->password = $patient_data['password'] ?? kcGenerateRandomString(12);
            $patient->email = sanitize_email($patient_data['email']);
            $patient->firstName = $patient_data['first_name'];
            $patient->lastName = $patient_data['last_name'];
            $patient->displayName = $patient_data['first_name'] . ' ' . $patient_data['last_name'];
            $patient->status = $patient_data['status'] ?? 1;
            $patient->gender = $patient_data['gender'];
            $patient->bloodGroup = $patient_data['blood_group'] ?? '';
            $patient->contactNumber = $patient_data['mobile_number'];
            $patient->dob = $patient_data['dob'] ?? '';
            $patient->address = $patient_data['address'] ?? '';
            $patient->city = $patient_data['city'] ?? '';
            $patient->country = $patient_data['country'] ?? '';
            $patient->postalCode = $patient_data['postal_code'] ?? '';

            // Handle profile image if provided
            $profile_image_id = null;
            if (!empty($patient_data['profile_image'])) {
                $profile_image_id = $this->handleProfileImageForDoctor($patient_data['profile_image'], 0);
                if ($profile_image_id) {
                    $patient->profileImage = $profile_image_id;
                }
            }

            // Now call save 
            if (!$patient->save()) {
                return [
                    'success' => false,
                    'error' => __('Failed to create patient', 'kivicare-pro')
                ];
            }

            // Save patient clinic mapping
            $this->savePatientClinic($patient->id, $clinic_id);
            
            // Save profile image to user meta if provided
            if ($profile_image_id) {
                update_user_meta($patient->id, 'patient_profile_image', $profile_image_id);
            }

            // Store patient unique ID in usermeta if provided
            if (!empty($patient_data['patient_unique_id'])) {
                update_user_meta($patient->id, 'patient_unique_id', sanitize_text_field($patient_data['patient_unique_id']));
            }

            $patientData = [
                'id' => $patient->id,
                'first_name' => $patient->firstName,
                'last_name' => $patient->lastName,
                'email' => $patient->email,
                'username' => $patient->username,
                'contact_number' => $patient->contactNumber,
                'dob' => $patient->dob,
                'gender' => $patient->gender,
                'blood_group' => $patient->bloodGroup,
                'address' => $patient->address,
                'city' => $patient->city,
                'country' => $patient->country,
                'postal_code' => $patient->postalCode,
                'status' => (int)$patient->status,
                'patient_image_url' => $patient->profileImage,
                'clinics' => $clinic_id,
                'created_at' => current_time('mysql'),
                'temp_password' => $patient->password,
                'patient_unique_id' => $patient_data['patient_unique_id'] ?? null
            ];
            // Send notifications if enabled
            if ($sendEmailNotification) {
                // Fire action hook for patient creation
                do_action('kc_patient_save', $patientData,new WP_REST_Request());
            }

            if ($sendSmsNotification) {
                do_action('kivicare_patient_registered', $patientData); // For patient welcome SMS
            }

            return [
                'success' => true,
                'patient_id' => $patient->id
            ];

        } catch (\Exception $e) {
            return [
                'success' => false,
                'error' => $e->getMessage()
            ];
        }
    }


    /**
     * Check if patient exists by email
     */
    private function patientExists($email) {
        try {
            $user = get_user_by('email', $email);
            if ($user && in_array('kivicare_patient', $user->roles)) {
                return true;
            }
            return false;
        } catch (\Exception $e) {
            KCErrorLogger::instance()->error("Error checking patient existence: " . $e->getMessage());
            return false;
        }
    }

    /**
     * Save patient clinic mapping
     * 
     * @param int $patient_id
     * @param mixed $clinic_id
     */
    private function savePatientClinic($patient_id, $clinics) {
        // Save/update patient clinic mappings
        if (is_array($clinics)) {
            foreach ($clinics as $value) {
                $new_temp = [
                    'patientId' => (int)$patient_id,
                    'clinicId' => (int)$value['value'],
                    'createdAt' => current_time('mysql')
                ];
                // Create patient clinic mappings
                KCPatientClinicMapping::create($new_temp);
            }        
        } else {
            $new_temp = [
                'patientId' => (int)$patient_id,
                'clinicId' => $clinics,
                'createdAt' => current_time('mysql')
            ];
            // Create patient clinic mappings
            KCPatientClinicMapping::create($new_temp);
        }
    }

    /**
     * Check if patient unique ID already exists
     * 
     * @param string $unique_id
     * @param int $exclude_patient_id
     * @return bool
     */
    private function isPatientUniqueIdExists($unique_id, $exclude_patient_id = null) {
        global $wpdb;
        
        $query = "SELECT user_id FROM {$wpdb->usermeta} WHERE meta_key = 'patient_unique_id' AND meta_value = %s";
        $params = [$unique_id];
        
        if ($exclude_patient_id) {
            $query .= " AND user_id != %d";
            $params[] = $exclude_patient_id;
        }
        
        $result = $wpdb->get_var($wpdb->prepare($query, $params));
        
        return !empty($result);
    }

    /**
     * Process services import
     */
    private function processServicesImport($data, $sendEmailNotification = false, $sendSmsNotification = false) {
        $total_rows = count($data);
        $inserted_rows = 0;
        $errors = [];
        $required_fields = ['category', 'name', 'charges', 'doctor_id'];

        // Start database transaction
        global $wpdb;
        $wpdb->query('START TRANSACTION');

        try {
            foreach ($data as $index => $row) {
                $row_number = $index + 2; // +2 because index starts at 0 and we skip header row
                

                
                try {
                    // Validate required fields
                    $validation_result = $this->validateServiceRow($row, $required_fields, $row_number);
                    if (!$validation_result['valid']) {
                        $errors[] = $validation_result['error'];
                        continue;
                    }

                    // Validate category exists
                    $category_validation = $this->validateCategoryById($row, $row_number);
                    if (!$category_validation['valid']) {
                        $errors[] = $category_validation['error'];
                        continue;
                    }

                    // Validate doctor exists
                    $doctor_validation = $this->validateDoctorById($row, $row_number);
                    if (!$doctor_validation['valid']) {
                        $errors[] = $doctor_validation['error'];
                        continue;
                    }

                    // Validate clinic exists if provided
                    if (!empty($row['clinic_id'])) {
                        $clinic_validation = $this->validateClinicByIdForServices($row, $row_number);
                        if (!$clinic_validation['valid']) {
                            $errors[] = $clinic_validation['error'];
                            continue;
                        }
                    }

                    // Prepare service data
                    $service_data = $this->prepareServiceData($row);
                    
                    // Check if service already exists for this doctor
                    if ($this->serviceExistsForDoctor($service_data)) {
                        $errors[] = sprintf(__('Row %d: Service "%s" already exists for this doctor', 'kivicare-pro'), $row_number, $service_data['name']);
                        continue;
                    }

                    // Create service
                    $result = $this->createServiceFromImport($service_data);
                    
                    if ($result['success']) {
                        $inserted_rows++;
                    } else {
                        $errors[] = sprintf(__('Row %d: %s', 'kivicare-pro'), $row_number, $result['error']);
                    }

                } catch (\Exception $e) {
                    $errors[] = sprintf(__('Row %d: %s', 'kivicare-pro'), $row_number, $e->getMessage());
                }
            }

            // Commit transaction if all operations successful
            $wpdb->query('COMMIT');

        } catch (\Exception $e) {
            // Rollback transaction on any error
            $wpdb->query('ROLLBACK');
            $errors[] = sprintf(__('Import failed: %s', 'kivicare-pro'), $e->getMessage());
        }

        // Create a single error message for toast
        $toast_error_message = '';
        if ($inserted_rows === 0 && $total_rows > 0) {
            if (!empty($errors)) {
                $has_duplicate_services = false;
                $has_required_fields = false;
                $has_invalid_category = false;
                $has_invalid_doctor = false;
                
                foreach ($errors as $error) {
                    if (strpos($error, 'already exists') !== false) {
                        $has_duplicate_services = true;
                    } elseif (strpos($error, 'is required') !== false) {
                        $has_required_fields = true;
                    } elseif (strpos($error, 'Category') !== false && strpos($error, 'does not exist') !== false) {
                        $has_invalid_category = true;
                    } elseif (strpos($error, 'Doctor') !== false && strpos($error, 'does not exist') !== false) {
                        $has_invalid_doctor = true;
                    }
                }
                
                $error_parts = [];
                if ($has_duplicate_services) {
                    $error_parts[] = __('Service already exists', 'kivicare-pro');
                }
                if ($has_required_fields) {
                    $error_parts[] = __('Required fields missing', 'kivicare-pro');
                }
                if ($has_invalid_category) {
                    $error_parts[] = __('Invalid category', 'kivicare-pro');
                }
                if ($has_invalid_doctor) {
                    $error_parts[] = __('Doctor not found', 'kivicare-pro');
                }
                
                $toast_error_message = !empty($errors) ? $errors[0] : __('Data not imported', 'kivicare-pro');
            } else {
                $toast_error_message = !empty($errors) ? $errors[0] : __('Data not imported', 'kivicare-pro');
            }
        }
        
        return [
            'total_rows' => $total_rows,
            'inserted_rows' => $inserted_rows,
            'errors' => [],
            'error_summary' => [],
            'toast_error_message' => $toast_error_message
        ];
    }

    /**
     * Validate service row data
     */
    private function validateServiceRow($row, $required_fields, $row_number) {
        // Check for required fields
        foreach ($required_fields as $field) {
            // Check if field exists and has a value (handle both empty strings and null)
            if (!isset($row[$field]) || $row[$field] === null || trim(strval($row[$field])) === '') {
                return [
                    'valid' => false,
                    'error' => sprintf(__('Row %d: %s is required (Available fields: %s)', 'kivicare-pro'), $row_number, $field, implode(', ', array_keys($row)))
                ];
            }
        }

        // Validate charges is numeric
        if (!is_numeric($row['charges']) || floatval($row['charges']) < 0) {
            return [
                'valid' => false,
                'error' => sprintf(__('Row %d: Charges must be a positive number', 'kivicare-pro'), $row_number)
            ];
        }

        return ['valid' => true];
    }

    /**
     * Validate category exists by ID
     */
    private function validateCategoryById(&$row, $row_number) {
    $category_value = trim($row['category']);

    // Skip if empty â€” your required field check handles this already
    if ($category_value === '') {
        return [
            'valid' => false,
            'error' => sprintf(__('Row %d: Category is required', 'kivicare-pro'), $row_number)
        ];
    }

    // Try to find category by value (name) or label
    $category = KCStaticData::table('sd')
        ->select(['*'])
        ->where(function($q) use ($category_value) {
            $q->where('value', '=', $category_value)
              ->orWhere('label', '=', $category_value);
        })
        ->first();

    // If found, replace name with ID and fix if necessary
    if ($category) {
        $needs_update = false;
        if ($category->type !== 'service_type') {
            $category->type = 'service_type';
            $needs_update = true;
        }
        if (empty($category->label)) {
            $category->label = $category_value;
            $needs_update = true;
        }
        
        if ($needs_update) {
            $category->save();
        }

        $row['category'] = $category->id;
        return ['valid' => true];
    }

    // If not found, create a new one
    $newCategoryData = [
        'label' => $category_value,
        'value' => $category_value,
        'type' => 'service_type',
        'status' => 1,
        'createdAt' => current_time('mysql')
    ];

    $newCategoryId = KCStaticData::create($newCategoryData);

        if (!$newCategoryId) {
            return [
                'valid' => false,
                'error' => sprintf(__('Row %d: Failed to create category "%s"', 'kivicare-pro'), $row_number, $category_value)
            ];
        }

    // Replace category name with new ID
    $row['category'] = $newCategoryId;

    return ['valid' => true];
}


    /**
     * Validate doctor exists by ID for services
     */
    private function validateDoctorById($row, $row_number) {
        $doctor_id = trim($row['doctor_id']);
        
        $doctor = get_user_by('ID', $doctor_id);
        if (!$doctor || !in_array($this->kcbase->getDoctorRole(), $doctor->roles)) {
            return [
                'valid' => false,
                'error' => sprintf(__('Row %d: Doctor with ID "%s" does not exist', 'kivicare-pro'), $row_number, $doctor_id)
            ];
        }
        
        return ['valid' => true];
    }

    /**
     * Validate clinic exists by ID for services
     */
    private function validateClinicByIdForServices($row, $row_number) {
        $clinic_id = trim($row['clinic_id']);
        
        $clinic = KCClinic::find($clinic_id);
        if (!$clinic) {
            return [
                'valid' => false,
                'error' => sprintf(__('Row %d: Clinic with ID "%s" does not exist', 'kivicare-pro'), $row_number, $clinic_id)
            ];
        }
        
        return ['valid' => true];
    }

    /**
     * Prepare service data from CSV row
     */
    private function prepareServiceData($row) {
        return [
            'name' => trim($row['name']),
            'category_id' => (int)trim($row['category']),
            'charges' => (float)trim($row['charges']),
            'doctor_id' => (int)trim($row['doctor_id']),
            'clinic_id' => isset($row['clinic_id']) && !empty(trim($row['clinic_id'])) ? (int)trim($row['clinic_id']) : null,
            'multi_selection' => isset($row['multi_selection']) ? trim($row['multi_selection']) : 'no',
            'telemed_service' => isset($row['telemed_service']) ? trim($row['telemed_service']) : 'no',
            'duration' => isset($row['duration']) && !empty(trim($row['duration'])) ? (int)trim($row['duration']) : null,
            'status' => isset($row['status']) && !empty(trim($row['status'])) ? (int)trim($row['status']) : 1,
            'service_image' => isset($row['service_image']) ? trim($row['service_image']) : null
        ];
    }

    /**
     * Check if service already exists for doctor
     */
    private function serviceExistsForDoctor($service_data) {
        // Get category value
        $category = KCStaticData::table('sd')
            ->select(['*'])
            ->where('id', '=', $service_data['category_id'])
            ->first();

        if (!$category) {
            return false;
        }


        // Use provided clinic_id or default
        $clinic_id = $service_data['clinic_id'] ?? KCClinic::kcGetDefaultClinicId();

        $existing = KCServiceDoctorMapping::table('sdm')
            ->leftJoin(KCService::class, 'sdm.service_id', '=', 's.id', 's')
            ->where('s.name', $service_data['name'])
            ->where('s.type', $category->value)
            ->where('sdm.doctor_id', $service_data['doctor_id'])
            ->where('sdm.clinic_id', $clinic_id)
            ->first();

        return !empty($existing);
    }

    /**
     * Create service from import data following createService logic
     */
    private function createServiceFromImport($service_data) {
        try {
            // Get category details
            $category = KCStaticData::table('sd')
                ->select(['*'])
                ->where('id', '=', $service_data['category_id'])
                ->first();

            if (!$category) {
                return [
                    'success' => false,
                    'error' => __('Category not found', 'kivicare-pro')
                ];
            }

            // Determine clinic ID - use provided or default
            $clinic_id = $service_data['clinic_id'] ?? KCClinic::kcGetDefaultClinicId();
            $doctor_id = $service_data['doctor_id'];

            // Create service record (following createService logic)
            $serviceData = [
                'name' => $service_data['name'],
                'type' => $category->value,
                'price' => $service_data['charges'],
                'status' => $service_data['status'],
                'createdAt' => current_time('mysql')
            ];

            $service_id = KCService::create($serviceData);

            if (!$service_id) {
                return ['success' => false, 'error' => __('Failed to create service', 'kivicare-pro')];
            }

            // Check for existing service mappings (following createService logic)
            $existingServiceMappings = KCServiceDoctorMapping::table('sdm')
                ->select(['sdm.id'])
                ->leftJoin(KCService::class, 'sdm.service_id', '=', 's.id', 's')
                ->where('s.type', $category->value)
                ->where('s.name', $service_data['name'])
                ->where('sdm.clinic_id', $clinic_id)
                ->where('sdm.doctor_id', $doctor_id)
                ->first();

            if ($existingServiceMappings) {
                return ['success' => false, 'error' => __('Same Service Already Exists, Please select Different category or service name', 'kivicare-pro')];
            }

            // Check if doctor-clinic mapping exists
            $doctorClinicMapping = KCDoctorClinicMapping::table('dcm')
            ->select(['*'])
            ->where('doctor_id', '=', $doctor_id)
            ->where('clinic_id', '=', $clinic_id)
            ->first();


            if (!$doctorClinicMapping) {
                return ['success' => false, 'error' => __('Doctor is not assigned to this clinic', 'kivicare-pro')];
            }

            // Handle service image (if provided as URL, we'll store it as is for now)
            $image_id = null;
            // Handle service image (URL or ID)
            if (!empty($service_data['service_image'])) {
                $image_id = $this->handleProfileImageForDoctor($service_data['service_image'], $service_id);
                if ($image_id) {
                    update_post_meta($service_id, 'service_image', $image_id);
                }
            }

            // Create service-doctor mapping (following createService logic)
            $serviceMappingData = [
                'serviceId' => $service_id,
                'clinicId' => $clinic_id,
                'doctorId' => $doctor_id,
                'charges' => $service_data['charges'],
                'status' => $service_data['status'],
                'image' => $image_id,
                'multiple' => $service_data['multi_selection'],
                'telemedService' => $service_data['telemed_service'],
                'serviceNameAlias' => $category->value,
                'createdAt' => current_time('mysql'),
            ];

            // Add duration if KiviCare Pro is active and duration is provided
            if (isKiviCareProActive() && !empty($service_data['duration'])) {
                $serviceMappingData['duration'] = $service_data['duration'];
            }

            // Create the service-doctor mapping
            KCServiceDoctorMapping::create($serviceMappingData);

            return ['success' => true];

        } catch (\Exception $e) {
            return ['success' => false, 'error' => $e->getMessage()];
        }
    }

    /**
 
    * Import custom fields from uploaded file
     * 
     * @param WP_REST_Request $request The REST request object
     * @return WP_REST_Response
     */
    public function importCustomFields(WP_REST_Request $request): WP_REST_Response
    {
        try {
            // Validate file upload
            $fileValidation = $this->validateFileUpload();
            if (!$fileValidation['valid']) {
                return $this->response([
                    'success' => false,
                    'message' => $fileValidation['message']
                ], 400);
            }
            
            $uploadedFile = $_FILES['file'];
            $fileFormat = $request->get_param('file_format');

            // Validate file type and format match
            $fileValidation = $this->validateFileTypeAndFormat($uploadedFile, $fileFormat);
            if (!$fileValidation['valid']) {
                return $this->response([
                    'success' => false,
                    'message' => $fileValidation['message']
                ], 400);
            }

            // Parse file based on format
            $data = $this->parseFile($uploadedFile['tmp_name'], $fileFormat);
            
            if (empty($data)) {
                return $this->response([
                    'success' => false,
                    'message' => __('No data found in the uploaded file', 'kivicare-pro')
                ], 400);
            }

            // Process import data
            $result = $this->processCustomFieldsImport($data);

            
            return $this->response([
                'success' => true,
                'message' => __('Import completed successfully', 'kivicare-pro'),
                'data' => [
                    'total_rows' => $result['total_rows'],
                    'inserted_rows' => $result['inserted_rows'],
                    'toast_error_message' => $result['toast_error_message']
                ]
            ], 200);

        } catch (\Exception $e) {
            return $this->response([
                'success' => false,
                'message' => __('Import failed', 'kivicare-pro'),
                'error' => $e->getMessage()
            ], 500);
        }
    }

    /**
     * Process custom fields import data
     * 
     * @param array $data The parsed CSV/Excel data
     * @return array
     */
    private function processCustomFieldsImport($data): array
    {
        global $wpdb;
        
        $total_rows = count($data);
        $inserted_rows = 0;
        $error_messages = [];
        
        // Required fields for custom fields import (matching actual CSV format)
        $required_fields = ['module', 'label', 'input_type'];
        
        // Start database transaction
        $wpdb->query('START TRANSACTION');
        
        try {
            foreach ($data as $row_number => $row) {
                $row_number++; // Start from 1 for user-friendly error messages
                
                // Validate row
                $validation = $this->validateCustomFieldRow($row, $required_fields, $row_number);
                if (!$validation['valid']) {
                    KCErrorLogger::instance()->error("Validation failed for row $row_number: " . $validation['message']);
                    $error_messages[] = $validation['message'];
                    continue;
                }
                
                // Prepare custom field data
                $custom_field_data = $this->prepareCustomFieldData($row);
                
                // Check if custom field already exists
                if ($this->customFieldExists($custom_field_data['module_type'], $custom_field_data['label'])) {
                    KCErrorLogger::instance()->error("Duplicate field found for row $row_number: {$custom_field_data['module_type']} - {$custom_field_data['label']}");
                    $error_messages[] = sprintf(__('Row %d: Custom field already exists for this module', 'kivicare-pro'), $row_number);
                    continue;
                }
                
                // Create custom field
                $result = $this->createCustomFieldFromImport($custom_field_data);
                
                if ($result['success']) {
                    $inserted_rows++;
                } else {
                    KCErrorLogger::instance()->error("Failed to create custom field for row $row_number: " . $result['error']);
                    $error_messages[] = sprintf(__('Row %d: %s', 'kivicare-pro'), $row_number, $result['error']);
                }
            }
            
            // Commit transaction
            $wpdb->query('COMMIT');
            
        } catch (\Exception $e) {
            // Rollback transaction on error
            $wpdb->query('ROLLBACK');
            throw $e;
        }
        
        // Create a single error message for toast
        $toast_error_message = '';
        if ($inserted_rows === 0 && $total_rows > 0) {
            if (!empty($error_messages)) {
                $toast_error_message = !empty($error_messages) ? $error_messages[0] : __('Data not imported', 'kivicare-pro');
            } else {
                $toast_error_message = !empty($error_messages) ? $error_messages[0] : __('Data not imported', 'kivicare-pro');
            }
        }
        
        return [
            'total_rows' => $total_rows,
            'inserted_rows' => $inserted_rows,
            'toast_error_message' => $toast_error_message
        ];
    }

    /**
     * Validate custom field row data
     * 
     * @param array $row The row data
     * @param array $required_fields Required field names
     * @param int $row_number Row number for error messages
     * @return array
     */
    private function validateCustomFieldRow($row, $required_fields, $row_number): array
    {
        // Check required fields
        foreach ($required_fields as $field) {
            if (!isset($row[$field]) || trim($row[$field]) === '') {
                return [
                    'valid' => false,
                    'message' => sprintf(__('Row %d: Required field "%s" is missing or empty', 'kivicare-pro'), $row_number, $field)
                ];
            }
        }
        
        // Validate module type (using 'module' field from CSV)
        $valid_module_types = ['doctor_module', 'patient_module', 'patient_encounter_module', 'appointment_module'];
        $module_type = trim($row['module']);
        if (!in_array($module_type, $valid_module_types)) {
            return [
                'valid' => false,
                'message' => sprintf(__('Row %d: Invalid module type "%s"', 'kivicare-pro'), $row_number, $module_type)
            ];
        }
        
        // Validate field type (using 'input_type' field from CSV)
        $valid_field_types = ['text', 'number', 'textarea', 'file_upload', 'select', 'multi_select', 'radio', 'checkbox', 'calendar'];
        $field_type = trim($row['input_type']);
        if (!in_array($field_type, $valid_field_types)) {
            return [
                'valid' => false,
                'message' => sprintf(__('Row %d: Invalid field type "%s"', 'kivicare-pro'), $row_number, $field_type)
            ];
        }
        
        // Validate options for select/radio/checkbox fields
        if (in_array($field_type, ['select', 'multi_select', 'radio', 'checkbox'])) {
            if (!isset($row['options']) || trim($row['options']) === '') {
                return [
                    'valid' => false,
                    'message' => sprintf(__('Row %d: Options are required for field type "%s"', 'kivicare-pro'), $row_number, $field_type)
                ];
            }
        }
        
        // Validate status if provided
        if (isset($row['status']) && trim($row['status']) !== '') {
            $status = trim($row['status']);
            if (!in_array($status, ['0', '1', 'active', 'inactive', 'true', 'false', 'yes', 'no'])) {
                return [
                    'valid' => false,
                    'message' => sprintf(__('Row %d: Invalid status value "%s"', 'kivicare-pro'), $row_number, $status)
                ];
            }
        }
        
        // Validate required field if provided
        if (isset($row['required']) && trim($row['required']) !== '') {
            $required = trim(strtolower($row['required']));
            if (!in_array($required, ['0', '1', 'true', 'false', 'yes', 'no'])) {
                return [
                    'valid' => false,
                    'message' => sprintf(__('Row %d: Invalid required value "%s"', 'kivicare-pro'), $row_number, $row['required'])
                ];
            }
        }
        
        return ['valid' => true];
    }

    /**
     * Prepare custom field data for database insertion
     * 
     * @param array $row The row data
     * @return array
     */
    private function prepareCustomFieldData($row): array
    {
        // Parse options for select/radio/checkbox fields
        $options = [];
        if (isset($row['options']) && trim($row['options']) !== '') {
            $option_values = explode(',', $row['options']);
            foreach ($option_values as $option) {
                $option = trim($option);
                if ($option !== '') {
                    $options[] = [
                        'label' => $option,
                        'value' => $option
                    ];
                }
            }
        }
        
        // Parse status
        $status = 1; // Default to active
        if (isset($row['status']) && trim($row['status']) !== '') {
            $status_value = trim(strtolower($row['status']));
            if (in_array($status_value, ['0', 'inactive', 'false', 'no'])) {
                $status = 0;
            }
        }
        
        // Parse required field (CSV uses 1/0 format)
        $required = false; // Default to not required
        if (isset($row['required']) && trim($row['required']) !== '') {
            $required_value = trim($row['required']);
            if (in_array($required_value, ['1', 'true', 'yes'])) {
                $required = true;
            }
        }
        
        // Parse module_id from doctor_id field if present
        $module_id = 0; // Default to global
        if (isset($row['doctor_id']) && trim($row['doctor_id']) !== '' && trim($row['doctor_id']) !== '0') {
            $module_id = (int)trim($row['doctor_id']);
        }
        
        return [
            'module_type' => trim($row['module']), // CSV uses 'module' field
            'module_id' => $module_id, // Use doctor_id from CSV or default to 0
            'label' => trim($row['label']),
            'type' => trim($row['input_type']), // CSV uses 'input_type' field
            'placeholder' => isset($row['placeholder']) ? trim($row['placeholder']) : '',
            'options' => $options,
            'required' => $required,
            'status' => $status
        ];
    }

    /**
     * Check if custom field already exists
     * 
     * @param string $module_type The module type
     * @param string $label The field label
     * @return bool
     */
    private function customFieldExists($module_type, $label): bool
    {
        global $wpdb;

        $query = $wpdb->prepare(
            "SELECT id FROM {$wpdb->prefix}kc_custom_fields 
            WHERE module_type = %s 
            AND JSON_UNQUOTE(JSON_EXTRACT(fields, '$.name')) = %s 
            LIMIT 0",
            $module_type,
            $label
        );

        $result = $wpdb->get_var($query);
        return !empty($result);
    }


    /**
     * Create custom field from import data
     * 
     * @param array $custom_field_data The custom field data
     * @return array
     */
    private function createCustomFieldFromImport($custom_field_data): array
    {
        try {
            // Prepare fields JSON
            $fields = [
                'name' => $custom_field_data['label'],
                'type' => $custom_field_data['type'],
                'placeholder' => $custom_field_data['placeholder'],
                'options' => $custom_field_data['options'],
                'isRequired' => $custom_field_data['required'],
                'status' => $custom_field_data['status']
            ];
            
            // Create custom field record
            $custom_field = KCCustomField::create([
                'moduleType' => $custom_field_data['module_type'],
                'moduleId' => $custom_field_data['module_id'],
                'fields' => json_encode($fields),
                'status' => $custom_field_data['status'],
                'createdAt' => current_time('Y-m-d H:i:s')
            ]);


            if (!$custom_field) {
                KCErrorLogger::instance()->error("KCCustomField::create returned false/null");
                return ['success' => false, 'error' => __('Failed to create custom field', 'kivicare-pro')];
            }

            return ['success' => true];

        } catch (\Exception $e) {
            KCErrorLogger::instance()->error("Exception in createCustomFieldFromImport: " . $e->getMessage());
            KCErrorLogger::instance()->error("Exception trace: " . $e->getTraceAsString());
            return ['success' => false, 'error' => $e->getMessage()];
        }
    }
    /**
     * Import appointments from uploaded file
     * 
     * @param WP_REST_Request $request The REST request object
     * @return WP_REST_Response
     */
    public function importAppointments(WP_REST_Request $request): WP_REST_Response
    {
        try {
            // Validate file upload
            $fileValidation = $this->validateFileUpload();
            if (!$fileValidation['valid']) {
                return $this->response([
                    'success' => false,
                    'message' => $fileValidation['message']
                ], 400);
            }
            
            $uploadedFile = $_FILES['file'];
            $fileFormat = $request->get_param('file_format');

            // Validate file type and format match
            $fileValidation = $this->validateFileTypeAndFormat($uploadedFile, $fileFormat);
            if (!$fileValidation['valid']) {
                return $this->response([
                    'success' => false,
                    'message' => $fileValidation['message']
                ], 400);
            }

            // Parse file based on format
            $data = $this->parseFile($uploadedFile['tmp_name'], $fileFormat);
            

            
            if (empty($data)) {
                return $this->response([
                    'success' => false,
                    'message' => __('No data found in the uploaded file', 'kivicare-pro')
                ], 400);
            }

            // Process import data
            $result = $this->processAppointmentsImport($data);


            
            return $this->response([
                'success' => true,
                'message' => __('Import completed successfully', 'kivicare-pro'),
                'data' => [
                    'total_rows' => $result['total_rows'],
                    'inserted_rows' => $result['inserted_rows'],
                    'toast_error_message' => $result['toast_error_message']
                ]
            ], 200);

        } catch (\Exception $e) {
            return $this->response([
                'success' => false,
                'message' => __('Import failed', 'kivicare-pro'),
                'error' => $e->getMessage()
            ], 500);
        }
    }

    public function importPrescriptions(WP_REST_Request $request): WP_REST_Response
    {
        try {
            // Validate file upload
            $fileValidation = $this->validateFileUpload();
            if (!$fileValidation['valid']) {
                return $this->response([
                    'success' => false,
                    'message' => $fileValidation['message']
                ], 400);
            }
            
            $uploadedFile = $_FILES['file'];
            $fileFormat = $request->get_param('file_format');
            $encounterId = $request->get_param('encounter_id');

            // Validate file type and format match
            $fileValidation = $this->validateFileTypeAndFormat($uploadedFile, $fileFormat);
            if (!$fileValidation['valid']) {
                return $this->response([
                    'success' => false,
                    'message' => $fileValidation['message']
                ], 400);
            }

            // Parse file based on format
            $data = $this->parseFile($uploadedFile['tmp_name'], $fileFormat);
            
            if (empty($data)) {
                return $this->response([
                    'success' => false,
                    'message' => __('No data found in the uploaded file', 'kivicare-pro')
                ], 400);
            }

            // Process import data
            $result = $this->processPrescriptionsImport($data, $encounterId);
            
            return $this->response([
                'success' => true,
                'message' => __('Import completed successfully', 'kivicare-pro'),
                'data' => [
                    'total_rows' => $result['total_rows'],
                    'inserted_rows' => $result['inserted_rows'],
                    'toast_error_message' => $result['toast_error_message']
                ]
            ], 200);

        } catch (\Exception $e) {
            return $this->response([
                'success' => false,
                'message' => __('Import failed', 'kivicare-pro'),
                'error' => $e->getMessage()
            ], 500);
        }
    }

    /**
     * Process appointments import data
     * 
     * @param array $data The parsed CSV/Excel data
     * @return array
     */
    private function processAppointmentsImport($data): array
    {
        global $wpdb;
        
        $total_rows = count($data);
        $inserted_rows = 0;
        $error_messages = [];
        
        // Required fields for appointments import (matching CSV format)
        $required_fields = ['date', 'start_time', 'end_time', 'service', 'clinic_name', 'doctor_name', 'patient_name'];
        
        // Start database transaction
        $wpdb->query('START TRANSACTION');
        
        try {
            foreach ($data as $row_number => $row) {
                $row_number++; // Start from 1 for user-friendly error messages
                

                
                // Validate row
                $validation = $this->validateAppointmentRow($row, $required_fields, $row_number);
                if (!$validation['valid']) {
                    $error_messages[] = $validation['message'];
                    continue;
                }
                
                // Prepare appointment data
                $appointment_data = $this->prepareAppointmentData($row, $row_number);
                if (!$appointment_data['success']) {
                    $error_messages[] = sprintf(__('Row %d: %s', 'kivicare-pro'), $row_number, $appointment_data['error']);
                    continue;
                }
                
                // Create appointment
                $result = $this->createAppointmentFromImport($appointment_data['data']);
                
                if ($result['success']) {
                    $inserted_rows++;
                } else {
                    $error_messages[] = sprintf(__('Row %d: %s', 'kivicare-pro'), $row_number, $result['error']);
                }
            }
            
            // Commit transaction
            $wpdb->query('COMMIT');
            
        } catch (\Exception $e) {
            // Rollback transaction on error
            $wpdb->query('ROLLBACK');
            throw $e;
        }
        
        // Create a single error message for toast
        $toast_error_message = '';
        if ($inserted_rows === 0 && $total_rows > 0) {
            $toast_error_message = !empty($error_messages) ? $error_messages[0] : __('Data not imported', 'kivicare-pro');
        }
        
        return [
            'total_rows' => $total_rows,
            'inserted_rows' => $inserted_rows,
            'toast_error_message' => $toast_error_message
        ];
    }

    /**
     * Validate appointment row data
     * 
     * @param array $row The row data
     * @param array $required_fields Required field names
     * @param int $row_number Row number for error messages
     * @return array
     */
    private function validateAppointmentRow($row, $required_fields, $row_number): array
    {
        // Check required fields
        foreach ($required_fields as $field) {
            if (!isset($row[$field]) || trim($row[$field]) === '') {
                return [
                    'valid' => false,
                    'message' => sprintf(__('Row %d: Required field "%s" is missing or empty', 'kivicare-pro'), $row_number, $field)
                ];
            }
        }
        
        // Validate date format
        $date = trim($row['date']);
        $parsed_date = $this->parseDate($date);
        if (!$parsed_date) {
            return [
                'valid' => false,
                'message' => sprintf(__('Row %d: Invalid date format "%s". Expected formats: MM/DD/YY, DD/MM/YYYY, YYYY-MM-DD', 'kivicare-pro'), $row_number, $date)
            ];
        }
        
        // Validate time formats
        $start_time = trim($row['start_time']);
        if (!$this->validateTimeFormat($start_time)) {
            return [
                'valid' => false,
                'message' => sprintf(__('Row %d: Invalid start time format "%s". Expected format: HH:MM:SS', 'kivicare-pro'), $row_number, $start_time)
            ];
        }
        
        $end_time = trim($row['end_time']);
        if (!$this->validateTimeFormat($end_time)) {
            return [
                'valid' => false,
                'message' => sprintf(__('Row %d: Invalid end time format "%s". Expected format: HH:MM:SS', 'kivicare-pro'), $row_number, $end_time)
            ];
        }
        
        // Validate status if provided
        if (isset($row['status']) && trim($row['status']) !== '') {
            $status = trim($row['status']);
            if (!in_array($status, ['0', '1', '2', '3', '4'])) {
                return [
                    'valid' => false,
                    'message' => sprintf(__('Row %d: Invalid status "%s". Valid values: 0-4', 'kivicare-pro'), $row_number, $status)
                ];
            }
        }
        
        return ['valid' => true];
    }

    /**
     * Prepare appointment data for database insertion
     * 
     * @param array $row The row data
     * @param int $row_number Row number for error messages
     * @return array
     */
    private function prepareAppointmentData($row, $row_number): array
    {
        try {
            // 1. Validate and parse date
            $appointment_date = $this->parseDate(trim($row['date']));
            if (!$appointment_date) {
                return ['success' => false, 'error' => 'Invalid date format'];
            }

            // 1.1 Check if date is in the past (restrict future/today imports)
            $current_date = current_time('Y-m-d');
            if ($appointment_date >= $current_date) {
                return ['success' => false, 'error' => __('Data not imported', 'kivicare-pro')];
            }
            
            // 2. Parse times
            $start_time = trim($row['start_time']);
            $end_time = trim($row['end_time']);
            
            // 3. Find clinic - improved approach
            $clinic_name = trim($row['clinic_name']);
            $clinic = $this->findClinicByName($clinic_name);
            if (!$clinic) {
                return ['success' => false, 'error' => "Clinic '$clinic_name' not found"];
            }
            
            // 4. Find doctor - simple approach  
            $doctor_name = trim($row['doctor_name']);
            $doctor = $this->findDoctorByName($doctor_name);
            if (!$doctor) {
                return ['success' => false, 'error' => "Doctor '$doctor_name' not found"];
            }
            
            // 4.1. Validate doctor exists in doctor table (required for custom fields)
            $doctor_exists = KCDoctor::query()
                ->where('id', '=', $doctor->id)
                ->first();
            
            if (!$doctor_exists) {
                return ['success' => false, 'error' => "Doctor ID {$doctor->id} does not exist in the doctor table. Valid doctor ID is required for appointment custom fields."];
            }
            
            // 5. Find patient - simple approach
            $patient_name = trim($row['patient_name']);
            $patient = $this->findPatientByName($patient_name);
            if (!$patient) {
                return ['success' => false, 'error' => "Patient '$patient_name' not found"];
            }
            
            // 5.1. Check if doctor is present in the clinic (doctor-clinic mapping)
            $doctor_clinic_mapping = KCDoctorClinicMapping::query()
                ->where('doctorId', '=', $doctor->id)
                ->where('clinicId', '=', $clinic->id)
                ->first();
            
            if (!$doctor_clinic_mapping) {
                return ['success' => false, 'error' => "Doctor '$doctor_name' is not assigned to clinic '$clinic_name'"];
            }
            
            // 5.2. Check if doctor has sessions configured for the appointment date
            $appointment_day = strtolower(date('D', strtotime($appointment_date))); // Get day abbreviation (mon, tue, etc.)
            $doctor_session = KCClinicSession::query()
                ->where('doctorId', '=', $doctor->id)
                ->where('clinicId', '=', $clinic->id)
                ->where('day', '=', $appointment_day)
                ->where('startTime', '<=', $start_time)
                ->where('endTime', '>=', $start_time)
                ->first();
            
            if (!$doctor_session) {
                return ['success' => false, 'error' => "Doctor '$doctor_name' does not have a session configured for $appointment_day at $start_time in clinic '$clinic_name'"];
            }
            
            // 6. Find service - simple approach
            $service_name = trim($row['service']);
            if (strpos($service_name, ',') !== false) {
                return [
                    'success' => false,
                    'error' => "Multiple services not allowed '$service_name'"
                ];
            }

            $service = $this->findServiceByName($service_name);
            if (!$service) {
                return ['success' => false, 'error' => "Service '$service_name' not found"];
            }
            
            // 7. Check if service is available for doctor at clinic (enhanced validation)
           $service_mapping = KCServiceDoctorMapping::query()
            ->from('wp_kc_service_doctor_mapping as sdm')
            ->join(KCService::class, 'sdm.service_id', '=', 's.id', 's')
            ->select(['sdm.*'])
            ->where('s.name', '=', $service_name)
            ->where('sdm.doctor_id', '=', $doctor->id)
            ->where('sdm.clinic_id', '=', $clinic->id)
            ->where('sdm.status', '=', 1)
            ->first();

            if (!$service_mapping) {
                return ['success' => false, 'error' => "Service '$service_name' is not available for doctor '$doctor_name' at clinic '$clinic_name' or is inactive"];
            }
            
            // 8. Check doctor session availability and calculate proper end time
            // For imports, we'll be more flexible with session validation
            try {
                // Get doctor sessions for the day (same logic as createAppointment)
                $slotData = KCAppointmentDataService::prepareSlotGenerationData([
                    'doctor_id' => $doctor->id,
                    'clinic_id' => $clinic->id,
                    'date' => $appointment_date,
                    'service_id' => [$service_mapping->id] // Use service mapping ID array
                ]);
                
                // Calculate proper end time based on service duration
                $startDateTime = new \DateTime($appointment_date . ' ' . $start_time);
                $endDateTime = clone $startDateTime;
                $serviceDuration = $slotData['service_duration_sum'] ?? 30; // Default 30 minutes if not found
                $endDateTime->add(new \DateInterval('PT' . $serviceDuration . 'M'));
                $calculated_end_time = $endDateTime->format('H:i:s');
                
                // For imports, we'll use calculated end time but won't strictly enforce slot availability
                // This allows importing historical data where sessions might not be configured
                $end_time = $calculated_end_time;
                
                // Optional: Check slot availability but only warn, don't fail
                $slotGenerator = new KCTimeSlotService($slotData);
                if (!$slotGenerator->isSlotAvailable($appointment_date . ' ' . $start_time)) {
                    KCErrorLogger::instance()->error("Import warning: Time slot $start_time may not be available for doctor '$doctor_name' on $appointment_date, but continuing with import");
                }
                
            } catch (\Exception $e) {
                // If slot validation fails, still allow import but log warning
                KCErrorLogger::instance()->error("Import warning: Slot validation failed for doctor '$doctor_name' on $appointment_date at $start_time: " . $e->getMessage());
                // Continue with original end time from CSV if calculation fails
            }
            
            // 9. Parse status
            $status = isset($row['status']) && trim($row['status']) !== '' ? (int)trim($row['status']) : 1;
            
            // 10. Check for duplicate appointment
            $existing_appointment = KCAppointment::query()
                ->where('appointment_start_date', '=', $appointment_date)
                ->where('appointment_start_time', '=', $start_time)
                ->where('doctor_id', '=', $doctor->id)
                ->where('clinic_id', '=', $clinic->id)
                ->first();
                
            if ($existing_appointment) {
                return ['success' => false, 'error' => "Appointment already exists for doctor '$doctor_name' on $appointment_date at $start_time"];
            }
            
            return [
                'success' => true,
                'data' => [
                    'appointment_date' => $appointment_date,
                    'start_time' => $start_time,
                    'end_time' => $end_time,
                    'clinic_id' => $clinic->id,
                    'doctor_id' => $doctor->id,
                    'patient_id' => $patient->id,
                    'service_mapping_id' => $service_mapping->id,
                    'service_id' => $service->id,
                    'status' => $status,
                    'description' => isset($row['description']) ? trim($row['description']) : ''
                ]
            ];
            
        } catch (\Exception $e) {
            return ['success' => false, 'error' => $e->getMessage()];
        }
    }

    /**
     * Find clinic by name - improved matching
     */
    private function findClinicByName($name)
    {
        $name = trim($name);
        
        // Get all clinics and search through them
        $clinics = KCClinic::query()->get();
        
        // First try exact match (case insensitive)
        foreach ($clinics as $clinic) {
            if (strcasecmp($clinic->name, $name) === 0) {
                return $clinic;
            }
        }
        
        // Then try partial match
        foreach ($clinics as $clinic) {
            if (stripos($clinic->name, $name) !== false || 
                stripos($name, $clinic->name) !== false) {
                return $clinic;
            }
        }

        return null;
    }


    /**
     * Find doctor by name - improved matching
     */
    private function findDoctorByName($name)
    {
        $name = trim($name);
        $all_doctors = KCDoctor::query()->get();
        
        // First pass: exact matches
        foreach ($all_doctors as $doctor) {
            // Check display name exact match
            if (strcasecmp($doctor->displayName, $name) === 0) {
                return $doctor;
            }
            
            // Check user meta names exact match
            $first_name = get_user_meta($doctor->id, 'first_name', true);
            $last_name = get_user_meta($doctor->id, 'last_name', true);
            $full_name = trim($first_name . ' ' . $last_name);
            
            if (strcasecmp($full_name, $name) === 0) {
                return $doctor;
            }
        }
        
        // Second pass: partial matches
        foreach ($all_doctors as $doctor) {
            // Check display name partial match
            if (stripos($doctor->displayName, $name) !== false || stripos($name, $doctor->displayName) !== false) {
                return $doctor;
            }
            
            // Check user meta names partial match
            $first_name = get_user_meta($doctor->id, 'first_name', true);
            $last_name = get_user_meta($doctor->id, 'last_name', true);
            $full_name = trim($first_name . ' ' . $last_name);
            
            if (stripos($full_name, $name) !== false || stripos($name, $full_name) !== false) {
                return $doctor;
            }
            
            // Check individual name parts
            if (stripos($name, $first_name) !== false && stripos($name, $last_name) !== false) {
                return $doctor;
            }
        }
        
        return null;
    }

    /**
     * Find patient by name - improved matching
     */
    private function findPatientByName($name)
    {
        $name = trim($name);

        if (empty($name)) {
            return null;
        }
        // Exact match on display name
        $patient = KCPatient::query()
            ->where('display_name', '=', $name)
            ->first();

        if ($patient) {
            return $patient;
        }
        return null;
    }


    /**
     * Find service by name - improved matching
     */
    private function findServiceByName($name)
    {
        $name = trim($name);
        
        // Get all services and search through them
        $services = KCService::query()->get();

        $matchedServices = collect();
        
        // First try exact match (case insensitive)
        foreach ($services as $service) {
            if (strcasecmp($service->name, $name) === 0) {
                $matchedServices->push($service);
            }
        }
        
        // Then try partial match
        if ($matchedServices->isEmpty()) {
            foreach ($services as $service) {
                if (
                    stripos($service->name, $name) !== false ||
                    stripos($name, $service->name) !== false
                ) {
                    $matchedServices->push($service);
                }
            }
        }

        return $matchedServices;
    }

    /**
     * Create appointment from import data
     * 
     * @param array $appointment_data The appointment data
     * @return array
     */
    private function createAppointmentFromImport($appointment_data): array
    {
        try {
            // Create appointment record
            $appointment = KCAppointment::create([
                'appointmentStartDate' => $appointment_data['appointment_date'],
                'appointmentStartTime' => $appointment_data['start_time'],
                'appointmentEndDate' => $appointment_data['appointment_date'],
                'appointmentEndTime' => $appointment_data['end_time'],
                'clinicId' => $appointment_data['clinic_id'],
                'doctorId' => $appointment_data['doctor_id'],
                'patientId' => $appointment_data['patient_id'],
                'description' => $appointment_data['description'],
                'status' => $appointment_data['status'],
                'visitType' => (string)$appointment_data['service_mapping_id'], 
                'createdAt' => current_time('Y-m-d H:i:s')
            ]);

            if (!$appointment) {
                return ['success' => false, 'error' => 'Failed to create appointment'];
            }

            $appointment_id = is_object($appointment) ? $appointment->id : $appointment;
            
            // Create appointment-service mapping
            KCAppointmentServiceMapping::create([
                'appointmentId' => $appointment_id,
                'serviceId' => $appointment_data['service_id'], // Use service mapping ID, not service ID
                'status' => 1
            ]);

            return ['success' => true, 'appointment_id' => $appointment_id];

        } catch (\Exception $e) {
            return ['success' => false, 'error' => $e->getMessage()];
        }
    }

    /**
     * Parse date from various formats
     * 
     * @param string $date_string The date string to parse
     * @return string|false The parsed date in Y-m-d format or false if invalid
     */
    private function parseDate($date_string)
    {
        $formats = [
            'Y-m-d',     // 2022-05-10
            'm/d/y',     // 10/05/22
            'd/m/Y',     // 10/05/2022
            'm/d/Y',     // 05/10/2022
            'd-m-Y',     // 10-05-2022
            'm-d-Y',     // 05-10-2022
        ];
        
        foreach ($formats as $format) {
            $date = \DateTime::createFromFormat($format, $date_string);
            if ($date && $date->format($format) === $date_string) {
                return $date->format('Y-m-d');
            }
        }
        
        return false;
    }

    /**
     * Validate time format
     * 
     * @param string $time_string The time string to validate
     * @return bool True if valid time format
     */
    private function validateTimeFormat($time_string)
    {
        return (bool)preg_match('/^([01]?[0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/', $time_string);
    }

    private function processPrescriptionsImport($data, $encounterId = null): array
    {
        global $wpdb;
        
        $total_rows = count($data);
        $inserted_rows = 0;
        $error_messages = [];
        
        $required_fields = ['name', 'frequency', 'duration'];
        
        $wpdb->query('START TRANSACTION');
        
        try {
            foreach ($data as $row_number => $row) {
                $row_number++; 
                
                $validation = $this->validatePrescriptionRow($row, $required_fields, $row_number);
                if (!$validation['valid']) {
                    $error_messages[] = $validation['message'];
                    continue;
                }
                
                $prescription_data = $this->preparePrescriptionData($row, $row_number, $encounterId);
                if (!$prescription_data['success']) {
                    $error_messages[] = $prescription_data['error'];
                    continue;
                }
                
                $result = $this->createPrescriptionFromImport($prescription_data['data']);
                
                if ($result['success']) {
                    $inserted_rows++;
                } else {
                    $error_messages[] = $result['error'];
                }
            }
            
            $wpdb->query('COMMIT');
            
        } catch (\Exception $e) {
            $wpdb->query('ROLLBACK');
            throw $e;
        }
        
        $toast_error_message = '';
        if ($inserted_rows === 0 && $total_rows > 0) {
            $toast_error_message = !empty($error_messages) ? $error_messages[0] : __('Data not imported', 'kivicare-pro');
        }
        
        return [
            'total_rows' => $total_rows,
            'inserted_rows' => $inserted_rows,
            'toast_error_message' => $toast_error_message
        ];
    }

    private function validatePrescriptionRow($row, $required_fields, $row_number): array
    {
        foreach ($required_fields as $field) {
            if (!isset($row[$field]) || trim(strval($row[$field])) === '') {
                return [
                    'valid' => false,
                    'message' => sprintf(__('Required field "%s" is missing or empty', 'kivicare-pro'), $field)
                ];
            }
        }
        
        return ['valid' => true];
    }

    private function preparePrescriptionData($row, $row_number, $encounterId = null): array
    {
        try {
            // Use encounter_id from context or CSV
            $encounter_id = $encounterId ?? (isset($row['encounter_id']) ? trim($row['encounter_id']) : null);
            
            if (!$encounter_id) {
                return ['success' => false, 'error' => 'Encounter ID is required'];
            }
            
            // Validate encounter exists
            $encounter = KCPatientEncounter::query()->where('id', $encounter_id)->first();
            if (!$encounter) {
                return ['success' => false, 'error' => "Encounter ID '$encounter_id' not found"];
            }
            
            // Get patient_id from encounter (try both camelCase and snake_case)
            $patient_id = $encounter->patientId ?? $encounter->patient_id ?? null;
            
            if (!$patient_id) {
                return ['success' => false, 'error' => 'Invalid patient ID'];
            }
            
            return [
                'success' => true,
                'data' => [
                    'encounter_id' => $encounter_id,
                    'patient_id' => $patient_id,
                    'name' => !empty($row['name']) ? trim($row['name']) : '',
                    'frequency' => trim($row['frequency']),
                    'duration' => trim($row['duration']),
                    'instruction' => isset($row['instruction']) ? trim($row['instruction']) : '',
                    'added_by' => get_current_user_id(),
                ]
            ];
            
        } catch (\Exception $e) {
            return ['success' => false, 'error' => $e->getMessage()];
        }
    }

    private function createPrescriptionFromImport($prescription_data): array
    {
        global $wpdb;
        
        try {
            $wpdb->query('START TRANSACTION');
            
            // Check if prescription already exists
            $existing = KCPrescription::query()
                ->where('encounter_id', $prescription_data['encounter_id'])
                ->where('name', $prescription_data['name'])
                ->where('frequency', $prescription_data['frequency'])
                ->where('duration', $prescription_data['duration'])
                ->where('instruction', $prescription_data['instruction'])
                ->first();
            
            if ($existing) {
                $wpdb->query('ROLLBACK');
                return ['success' => false, 'error' => 'Prescription already exists'];
            }
            
            $prescription = KCPrescription::create([
                'encounterId' => $prescription_data['encounter_id'],
                'patientId' => $prescription_data['patient_id'],
                'name' => $prescription_data['name'],
                'frequency' => $prescription_data['frequency'],
                'duration' => $prescription_data['duration'],
                'instruction' => $prescription_data['instruction'],
                'addedBy' => $prescription_data['added_by'],
                'createdAt' => current_time('Y-m-d H:i:s')
            ]);

            if (!$prescription) {
                $wpdb->query('ROLLBACK');
                return ['success' => false, 'error' => 'Failed to create prescription'];
            }

            $wpdb->query('COMMIT');
            return ['success' => true];

        } catch (\Exception $e) {
            $wpdb->query('ROLLBACK');
            return ['success' => false, 'error' => $e->getMessage()];
        }
    }

    /**
     * Import listings from uploaded file
     * 
     * @param WP_REST_Request $request The REST request object
     * @return WP_REST_Response
     */
    public function importListings(WP_REST_Request $request): WP_REST_Response
    {
        try {
            $params = $request->get_params();
            $fileFormat = $params['file_format'] ?? 'csv';
            
            // Validate file upload
            $fileValidation = $this->validateFileUpload();
            if (!$fileValidation['valid']) {
                return $this->response([
                    'success' => false,
                    'message' => $fileValidation['message']
                ], $fileValidation['message'], false, 400);
            }
            
            $uploadedFile = $_FILES['file'];
            $filePath = $uploadedFile['tmp_name'];

            // Validate file type and format
            $formatValidation = $this->validateFileTypeAndFormat($uploadedFile, $fileFormat);
            if (!$formatValidation['valid']) {
                return $this->response([
                    'success' => false,
                    'message' => $formatValidation['message']
                ], $formatValidation['message'], false, 400);
            }

            // Parse file
            $data = $this->parseFile($filePath, $fileFormat);
            
            if (empty($data)) {
                return $this->response([
                    'success' => false,
                    'message' => __('No data found in the uploaded file', 'kivicare-pro')
                ], __('No data found', 'kivicare-pro'), false, 400);
            }

            // Process import
            $result = $this->processListingsImport($data);

            // Clean up
            unset($data);
            @unlink($filePath);
            
            return $this->response([
                'success' => true,
                'message' => __('Import completed successfully', 'kivicare-pro'),
                'data' => [
                    'total_rows' => $result['total_rows'] ?? 0,
                    'inserted_rows' => $result['inserted_rows'] ?? 0,
                    'toast_error_message' => $result['toast_error_message'] ?? ''
                ]
            ], __('Import completed', 'kivicare-pro'), true, 200);

        } catch (\Exception $e) {
            return $this->response([
                'success' => false,
                'message' => __('Import failed', 'kivicare-pro') . ': ' . $e->getMessage()
            ], __('Import failed', 'kivicare-pro'), false, 500);
        }
    }

    /**
     * Process listings import
     * 
     * @param array $data Parsed data from file
     * @return array Import results
     */
    private function processListingsImport($data): array
    {
        global $wpdb;
        
        $total_rows = count($data);
        $inserted_rows = 0;
        $errors = [];
        $required_fields = ['Name', 'Type'];
        
        $wpdb->query('START TRANSACTION');
        
        try {
            foreach ($data as $index => $row) {
                $row_number = $index + 1;
                
                try {
                    // Validate required fields (case-insensitive)
                    $validation_errors = [];
                    foreach ($required_fields as $field) {
                        $fieldValue = $row[$field] ?? $row[strtolower($field)] ?? '';
                        if (empty(trim($fieldValue))) {
                            $validation_errors[] = "$field is required";
                        }
                    }
                    
                    if (!empty($validation_errors)) {
                        $errors[] = "Row $row_number: " . implode(', ', $validation_errors);
                        continue;
                    }
                    
                    // Get values (case-insensitive)
                    $name = trim($row['Name'] ?? $row['name'] ?? '');
                    $type = trim($row['Type'] ?? $row['type'] ?? '');
                    $value = !empty($row['Value'] ?? $row['value'] ?? '') 
                        ? trim($row['Value'] ?? $row['value']) 
                        : strtolower(str_replace(' ', '_', $name));
                    $status = isset($row['Status']) || isset($row['status']) 
                        ? (int)($row['Status'] ?? $row['status']) 
                        : 1;
                    
                    // Normalize type
                    $type = strtolower(str_replace(' ', '_', $type));
                    
                    // Check if exists
                    $existing = KCStaticData::query()
                        ->where('type', $type)
                        ->where('value', $value)
                        ->first();
                    
                    if ($existing) {
                        $errors[] = "Row $row_number: Already exists (Type: $type, Value: $value)";
                        continue;
                    }
                    
                    // Insert
                    KCStaticData::create([
                        'label' => $name,
                        'value' => $value,
                        'type' => $type,
                        'status' => $status,
                        'createdAt' => current_time('mysql')
                    ]);
                    
                    $inserted_rows++;
                    
                } catch (\Exception $e) {
                    $errors[] = "Row $row_number: " . $e->getMessage();
                }
            }
            
            $wpdb->query('COMMIT');
            
        } catch (\Exception $e) {
            $wpdb->query('ROLLBACK');
            throw $e;
        }
        
        // Error message
        $toast_error_message = '';
        if ($inserted_rows === 0 && $total_rows > 0) {
            $toast_error_message = !empty($error_messages) ? $error_messages[0] : __('Data not imported', 'kivicare-pro');
        }
        
        return [
            'total_rows' => $total_rows,
            'inserted_rows' => $inserted_rows,
            'toast_error_message' => $toast_error_message
        ];
    }
    
}
