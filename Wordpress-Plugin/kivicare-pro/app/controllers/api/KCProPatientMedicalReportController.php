<?php namespace KCProApp\controllers\api;

use App\baseClasses\KCBaseController;
use App\controllers\api\PatientMedicalReportController;
use App\models\KCPatientMedicalReport;
use App\models\KCPatient;
use App\emails\KCEmailTemplateManager;
use App\emails\KCEmailTemplateProcessor;
use WP_REST_Request;
use WP_REST_Response;
use WP_Error;

defined('ABSPATH') or die('Something went wrong');

/**
 * Class KCProPatientMedicalReportController
 *
 **/
class KCProPatientMedicalReportController extends KCBaseController
{
    protected $route = 'patient-medical-reports';

    /**
     * Register routes for this controller
     */
    public function registerRoutes()
    {
        // List all reports for a patient
        $this->registerRoute('/' . $this->route, [
            'methods' => 'GET',
            'callback' => [$this, 'getReports'],
            'permission_callback' => [$this, 'checkReportPermission'],
            'args' => $this->getListEndpointArgs()
        ]);

        // Get single report
        $this->registerRoute('/' . $this->route . '/(?P<id>\d+)', [
            'methods' => 'GET',
            'callback' => [$this, 'getReport'],
            'permission_callback' => [$this, 'checkReportViewPermission'],
            'args' => $this->getSingleEndpointArgs()
        ]);

        // Create report
        $this->registerRoute('/' . $this->route, [
            'methods' => 'POST',
            'callback' => [$this, 'createReport'],
            'permission_callback' => [$this, 'checkCreatePermission'],
            'args' => $this->getCreateEndpointArgs()
        ]);

        // Update report
        $this->registerRoute('/' . $this->route . '/(?P<id>\d+)', [
            'methods' => 'PUT',
            'callback' => [$this, 'updateReport'],
            'permission_callback' => [$this, 'checkEditPermission'],
            'args' => $this->getUpdateEndpointArgs()
        ]);

        // Delete report
        $this->registerRoute('/' . $this->route . '/(?P<id>\d+)', [
            'methods' => 'DELETE',
            'callback' => [$this, 'deleteReport'],
            'permission_callback' => [$this, 'checkDeletePermission'],
            'args' => $this->getSingleEndpointArgs()
        ]);

        // Print report file (for Blob download)
        $this->registerRoute('/' . $this->route . '/print/(?P<id>\d+)', [
            'methods' => 'GET',
            'callback' => [$this, 'printReport'],
            'permission_callback' => [$this, 'checkReportViewPermission'],
            'args' => $this->getSingleEndpointArgs()
        ]);

        // Send reports via email
        $this->registerRoute('/' . $this->route . '/send-email', [
            'methods' => 'POST',
            'callback' => [$this, 'sendReportsViaEmail'],
            'permission_callback' => [$this, 'checkReportViewPermission'],
            'args' => $this->getSendEmailEndpointArgs()
        ]);

        // Fetch report file
        $this->registerRoute('/' . $this->route . '/fetch', [
            'methods' => 'GET',
            'callback' => [$this, 'downloadReport'],
            'permission_callback' => '__return_true',
        ]);

        // Preview report and generate secure link
        $this->registerRoute('/' . $this->route . '/preview', [
            'methods' => 'GET',
            'callback' => [$this, 'viewReport'],
            'permission_callback' => [$this, 'checkReportViewPermission'],
        ]);
    }

    /**
     * Get arguments for list endpoint
     */
    private function getListEndpointArgs()
    {
        return [
            'patient_id' => [
                'description' => 'Patient ID',
                'type' => 'integer',
                'required' => true,
                'validate_callback' => function ($param) {
                    return is_numeric($param) && $param > 0;
                },
                'sanitize_callback' => 'absint',
            ],
            'page' => [
                'description' => 'Current page of results',
                'type' => 'integer',
                'default' => 1,
                'sanitize_callback' => 'absint',
            ],
            'perPage' => [
                'description' => 'Number of results per page',
                'type' => 'string',
                'default' => 10,
                'sanitize_callback' => function($param) {
                    return strtolower($param) === 'all' ? 'all' : absint($param);
                },
            ],
            'search' => [
                'description' => 'Search term for report name',
                'type' => 'string',
                'required' => false,
                'sanitize_callback' => 'sanitize_text_field',
            ]
        ];
    }

    /**
     * Get arguments for single item endpoints
     */
    private function getSingleEndpointArgs()
    {
        return [
            'id' => [
                'description' => 'Report ID',
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
            'patient_id' => [
                'description' => 'Patient ID',
                'type' => 'integer',
                'required' => true,
                'validate_callback' => function ($param) {
                    return is_numeric($param) && $param > 0;
                },
                'sanitize_callback' => 'absint',
            ],
            'name' => [
                'description' => 'Report name',
                'type' => 'string',
                'required' => true,
                'sanitize_callback' => 'sanitize_text_field',
            ],
            'upload_report' => [
                'description' => 'File URL or attachment ID (if not uploading a file)',
                'type' => 'string',
                'required' => false,
                'sanitize_callback' => 'sanitize_text_field',
            ],
            'file' => [
                'description' => 'Uploaded file (for mobile apps)',
                'type' => 'file',
                'required' => false,
            ],
            'date' => [
                'description' => 'Report date (Y-m-d or Y-m-d H:i:s)',
                'type' => 'string',
                'required' => false,
                'sanitize_callback' => 'sanitize_text_field',
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
            'description' => 'Report ID',
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
     * Get arguments for send email endpoint
     */
    private function getSendEmailEndpointArgs()
    {
        return [
            'report_ids' => [
                'description' => 'Array of report IDs to send',
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
            'patient_id' => [
                'description' => 'Patient ID for verification',
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
     * Permission checks (customize as needed)
     */
    public function checkReportPermission($request)
    {
        return $this->checkResourceAccess('patient','report');
    }
    public function checkCreatePermission($request)
    {
        return $this->checkResourceAccess('patient_report', 'add');
    }
    public function checkEditPermission($request)
    {
        return $this->checkResourceAccess('patient_report', 'edit');
    }
    public function checkDeletePermission($request)
    {
        return $this->checkResourceAccess('patient_report','delete');
    }

    public function checkReportViewPermission($request)
    {
        return $this->checkResourceAccess('patient_report', 'view');
    }


    /**
     * List all reports for a patient.
     *
     * Retrieves all medical reports associated with a given patient ID.
     *
     * @param WP_REST_Request $request The REST API request object. Expects 'patient_id' as a parameter.
     * @return WP_REST_Response Returns a response containing an array of formatted report data on success,
     *                          or an error message and status code on failure.
     *
     */
    public function getReports(WP_REST_Request $request): WP_REST_Response
    {
        try {
            $patient_id = $request->get_param('patient_id');
            $params = $request->get_params();
            // Set defaults
            $page = isset($params['page']) ? (int)$params['page'] : 1;
            $perPageParam = isset($params['perPage']) ? $params['perPage'] : 10;

            // Handle "all" option for perPage
            $showAll = (strtolower($perPageParam) === 'all');

            // Build query
            $query = KCPatientMedicalReport::query()->where('patient_id', $patient_id);

            // Apply search filter if provided
            if (!empty($params['search'])) {
                $query->where('name', 'like', '%' . $params['search'] . '%');
            }

            $total = $query->count();
            $query->orderBy('id', 'DESC');
            // Apply pagination only if not showing all
            if (!$showAll) {
                $page = max(1, intval($params['page'] ?? 1));
                $perPage = intval($params['perPage'] ?? 10);
                $query->limit($perPage)->offset(($page - 1) * $perPage);
            } else {
                // When showing all, set page to 1 and perPage to total
                $page = 1;
                $perPage = $total;
            }
            $reports = $query->get();

            $data = [];
            foreach ($reports as $report) {
                $data[] = $this->formatReport($report);
            }

            $totalPages = ceil($total / $perPage);

            $responseData = [
                'reports' => $data,
                'pagination' => [
                    'total' => $total,
                    'per_page' => $perPage,
                    'current_page' => $page,
                    'total_pages' => $totalPages,
                    'has_more' => $page < $totalPages,
                ]
            ];

            return $this->response($responseData, __('Reports retrieved successfully', 'kivicare-pro'));
        } catch (\Exception $e) {
            return $this->response(['error' => $e->getMessage()], __('Failed to retrieve reports', 'kivicare-pro'), false, 500);
        }
    }

    /**
     * Get a single report.
     *
     * Retrieves a single medical report by its ID.
     *
     * @param WP_REST_Request $request The REST API request object. Expects 'id' as a parameter.
     * @return WP_REST_Response Returns a response containing the formatted report data on success,
     *                          or an error message and status code on failure.
     *
     */
    public function getReport(WP_REST_Request $request): WP_REST_Response
    {
        try {
            $id = $request->get_param('id');
            $report = KCPatientMedicalReport::find($id);

            if (!$report) {
                return $this->response(null, __('Report not found', 'kivicare-pro'), false, 404);
            }

            return $this->response($this->formatReport($report), __('Report retrieved successfully', 'kivicare-pro'));
        } catch (\Exception $e) {
            return $this->response(['error' => $e->getMessage()], __('Failed to retrieve report', 'kivicare-pro'), false, 500);
        }
    }

    /**
     * Create a new report.
     *
     * Creates a new medical report for a patient.
     *
     * @param WP_REST_Request $request The REST API request object. Expects 'patient_id', 'name', 'upload_report' or 'file', and optionally 'date'.
     * @return WP_REST_Response Returns a response containing the formatted report data on success,
     *                          or an error message and status code on failure.
     *
     */
    public function createReport(WP_REST_Request $request): WP_REST_Response
    {
        try {
            $params = $request->get_params();
            $files = $request->get_file_params();

            $report = new KCPatientMedicalReport();
            $report->patientId = $params['patient_id'];
            $report->name = $params['name'];
            $report->date = !empty($params['date']) ? $params['date'] : current_time('mysql');

            // Handle file upload if provided
            if (!empty($files['file'])) {
                $uploaded_file = $files['file'];
                $upload_overrides = ['test_form' => false];

                // Randomize filename for security
                add_filter('wp_handle_upload_prefilter', function ($file) {
                    $ext = pathinfo($file['name'], PATHINFO_EXTENSION);
                    $file['name'] = 'report_' . wp_generate_password(16, false) . '.' . $ext;
                    return $file;
                });

                $movefile = wp_handle_upload($uploaded_file, $upload_overrides);

                if ($movefile && !isset($movefile['error'])) {
                    // Check file type
                    $allowed_mime_types = [
                        'application/pdf',
                        'image/jpeg',
                        'image/png',
                        'image/gif',
                        'application/msword',
                        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                        'text/plain'
                    ];
                    if (!in_array($movefile['type'], $allowed_mime_types)) {
                        return $this->response(null, __('Invalid file type. Only PDF, images, DOC, DOCX, and TXT files are allowed.', 'kivicare-pro'), false, 400);
                    }

                    // Insert attachment
                    $attachment = [
                        'guid' => $movefile['url'],
                        'post_mime_type' => $movefile['type'],
                        'post_title' => basename($movefile['file']),
                        'post_content' => '',
                        'post_status' => 'inherit'
                    ];
                    $attach_id = wp_insert_attachment($attachment, $movefile['file']);

                    if (!is_wp_error($attach_id)) {
                        require_once(ABSPATH . 'wp-admin/includes/image.php');
                        $attach_data = wp_generate_attachment_metadata($attach_id, $movefile['file']);
                        wp_update_attachment_metadata($attach_id, $attach_data);
                        $report->uploadReport = $attach_id;
                    } else {
                        return $this->response(null, __('Failed to create attachment', 'kivicare-pro'), false, 500);
                    }
                } else {
                    return $this->response(null, $movefile['error'], false, 400);
                }
            } elseif (isset($params['upload_report'])) {
                $report->uploadReport = $params['upload_report'];
            }

            if (!$report->save()) {
                return $this->response(null, __('Failed to create report', 'kivicare-pro'), false, 500);
            }

            return $this->response($this->formatReport($report), __('Report created successfully', 'kivicare-pro'), true, 201);
        } catch (\Exception $e) {
            return $this->response(['error' => $e->getMessage()], __('Failed to create report', 'kivicare-pro'), false, 500);
        }
    }

    /**
     * Update an existing report.
     *
     * Updates the details of an existing medical report.
     *
     * @param WP_REST_Request $request The REST API request object. Expects 'id' and any fields to update ('name', 'upload_report' or 'file', 'date', 'patient_id').
     * @return WP_REST_Response Returns a response containing the updated formatted report data on success,
     *                          or an error message and status code on failure.
     *
     */
    public function updateReport(WP_REST_Request $request): WP_REST_Response
    {
        try {
            $id = $request->get_param('id');
            $params = $request->get_params();
            $files = $request->get_file_params();

            $report = KCPatientMedicalReport::find($id);
            if (!$report) {
                return $this->response(null, __('Report not found', 'kivicare-pro'), false, 404);
            }

            if (isset($params['name']))
                $report->name = $params['name'];
            if (isset($params['date']))
                $report->date = $params['date'];
            if (isset($params['patient_id'])) {
                $report->patientId = $params['patient_id'];
            }

            // Handle file upload if provided
            if (!empty($files['file'])) {
                $uploaded_file = $files['file'];
                $upload_overrides = ['test_form' => false];

                // Randomize filename for security
                add_filter('wp_handle_upload_prefilter', function ($file) {
                    $ext = pathinfo($file['name'], PATHINFO_EXTENSION);
                    $file['name'] = 'report_' . wp_generate_password(16, false) . '.' . $ext;
                    return $file;
                });

                $movefile = wp_handle_upload($uploaded_file, $upload_overrides);

                if ($movefile && !isset($movefile['error'])) {
                    // Check file type
                    $allowed_mime_types = [
                        'application/pdf',
                        'image/jpeg',
                        'image/png',
                        'image/gif',
                        'application/msword',
                        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                        'text/plain'
                    ];
                    if (!in_array($movefile['type'], $allowed_mime_types)) {
                        return $this->response(null, __('Invalid file type. Only PDF, images, DOC, DOCX, and TXT files are allowed.', 'kivicare-pro'), false, 400);
                    }

                    // Insert attachment
                    $attachment = [
                        'guid' => $movefile['url'],
                        'post_mime_type' => $movefile['type'],
                        'post_title' => basename($movefile['file']),
                        'post_content' => '',
                        'post_status' => 'inherit'
                    ];
                    $attach_id = wp_insert_attachment($attachment, $movefile['file']);

                    if (!is_wp_error($attach_id)) {
                        require_once(ABSPATH . 'wp-admin/includes/image.php');
                        $attach_data = wp_generate_attachment_metadata($attach_id, $movefile['file']);
                        wp_update_attachment_metadata($attach_id, $attach_data);
                        $report->uploadReport = $attach_id;
                    } else {
                        return $this->response(null, __('Failed to create attachment', 'kivicare-pro'), false, 500);
                    }
                } else {
                    return $this->response(null, $movefile['error'], false, 400);
                }
            } elseif (isset($params['upload_report'])) {
                $report->uploadReport = $params['upload_report'];
            }

            if (!$report->save()) {
                return $this->response(null, __('Failed to update report', 'kivicare-pro'), false, 500);
            }

            return $this->response($this->formatReport($report), __('Report updated successfully', 'kivicare-pro'));
        } catch (\Exception $e) {
            return $this->response(['error' => $e->getMessage()], __('Failed to update report', 'kivicare-pro'), false, 500);
        }
    }

    /**
     * Delete a report.
     *
     * Deletes a medical report by its ID.
     *
     * @param WP_REST_Request $request The REST API request object. Expects 'id' as a parameter.
     * @return WP_REST_Response Returns a response with the deleted report ID on success,
     *                          or an error message and status code on failure.
     *
     */
    public function deleteReport(WP_REST_Request $request): WP_REST_Response
    {
        try {
            $id = $request->get_param('id');
            $report = KCPatientMedicalReport::find($id);

            if (!$report) {
                return $this->response(null, __('Report not found', 'kivicare-pro'), false, 404);
            }

            if (!$report->delete()) {
                return $this->response(null, __('Failed to delete report', 'kivicare-pro'), false, 500);
            }

            return $this->response(['id' => $id], __('Report deleted successfully', 'kivicare-pro'));
        } catch (\Exception $e) {
            return $this->response(['error' => $e->getMessage()], __('Failed to delete report', 'kivicare-pro'), false, 500);
        }
    }

    /**
     * Format report data for API response.
     *
     * Helper function to format a KCPatientMedicalReport model instance into an array suitable for API responses.
     *
     * @param KCPatientMedicalReport $report The report model instance.
     * @return array Formatted report data.
     *
     */
    private function formatReport($report)
    {
        $attachment_id = $report->uploadReport;
        $secure_url = $this->getEncryptedUrl($attachment_id);

        return [
            'id' => $report->id,
            'patient_id' => $report->patientId,
            'name' => $report->name,
            'file' => array(
                'url' => !empty($secure_url) ? $secure_url : wp_get_attachment_url($attachment_id),
                'id' => $attachment_id,
                'filename' => basename(wp_get_attachment_url($attachment_id)),
            ),
            'upload_report' => $attachment_id,
            'date' => !empty($report->date) ? kcGetFormatedDate($report->date) : null,
        ];
    }

    /**
     * Generate an encrypted URL for a report attachment.
     *
     * @param int $attachment_id The WordPress attachment ID.
     * @return string The fetch URL.
     */
    private function getEncryptedUrl($attachment_id)
    {
        if (empty($attachment_id)) {
            return '';
        }

        $ivlen = openssl_cipher_iv_length($cipher = "AES-128-CBC");
        $iv = openssl_random_pseudo_bytes($ivlen);
        $ciphertext_raw = openssl_encrypt($attachment_id, $cipher, AUTH_KEY, $options = OPENSSL_RAW_DATA, $iv);
        $hmac = hash_hmac('sha256', $ciphertext_raw, AUTH_KEY, $as_binary = true);
        $ciphertext = base64_encode($iv . $hmac . $ciphertext_raw);

        return rest_url($this->namespace . '/patient-medical-reports/fetch?key=' . urlencode($ciphertext));
    }

    /**
     * View a report.
     *
     * Generates a fetch URL for viewing/downloading a report file.
     *
     * @param WP_REST_Request $request The REST API request object. Expects 'patient_id' and 'report_id'.
     * @return WP_REST_Response Returns a response containing the encrypted download URL on success,
     *                          or an error message and status code on failure.
     *
     */
    public function viewReport(WP_REST_Request $request): WP_REST_Response
    {
        $patient_id = $request->get_param('patient_id');
        $report_id = $request->get_param('report_id');

        $attachment = KCPatientMedicalReport::table('p')
            ->where('patient_id', $patient_id)
            ->where('id', $report_id)
            ->first();

        $attachment_id = $attachment ? $attachment->uploadReport : null;

        $ivlen = openssl_cipher_iv_length($cipher = "AES-128-CBC");
        $iv = openssl_random_pseudo_bytes($ivlen);
        $ciphertext_raw = openssl_encrypt($attachment_id, $cipher, AUTH_KEY, $options = OPENSSL_RAW_DATA, $iv);
        $hmac = hash_hmac('sha256', $ciphertext_raw, AUTH_KEY, $as_binary = true);
        $ciphertext = base64_encode($iv . $hmac . $ciphertext_raw);

        // Generate REST API URL
        $url = rest_url($this->namespace . '/patient-medical-reports/fetch?key=' . urlencode($ciphertext));

        return $this->response(['url' => $url], __('Encrypted report URL generated', 'kivicare-pro'), true, 200);
    }

    /**
     * Download a report.
     *
     * Serves the actual report file after validating the request key.
     *
     * @param WP_REST_Request $request The REST API request object. Expects 'key' as a parameter.
     * @return void|WP_Error Outputs the file directly to the browser or returns an error if invalid.
     *
     */
    public function downloadReport(WP_REST_Request $request)
    {
        $key = $request->get_param('key');
        if (!$key) {
            return new WP_Error('invalid_key', __('Missing key', 'kivicare-pro'), ['status' => 400]);
        }

        $c = base64_decode($key);
        $ivlen = openssl_cipher_iv_length($cipher = "AES-128-CBC");
        $iv = substr($c, 0, $ivlen);
        $hmac = substr($c, $ivlen, $sha2len = 32);
        $ciphertext_raw = substr($c, $ivlen + $sha2len);
        $original = openssl_decrypt($ciphertext_raw, $cipher, AUTH_KEY, $options = OPENSSL_RAW_DATA, $iv);
        $calcmac = hash_hmac('sha256', $ciphertext_raw, AUTH_KEY, $as_binary = true);

        if (!hash_equals($hmac, $calcmac)) {
            return new WP_Error('invalid_key', __('Invalid key', 'kivicare-pro'), ['status' => 403]);
        }

        $attachment_id = $original;
        if (!$attachment_id) {
            return new WP_Error('not_found', __('Report not found', 'kivicare-pro'), ['status' => 404]);
        }

        $file_path = get_attached_file($attachment_id);
        $file_name = basename($file_path);

        if (!file_exists($file_path)) {
            return new WP_Error('not_found', __('File not found', 'kivicare-pro'), ['status' => 404]);
        }

        $mime_type = mime_content_type($file_path);

        // Send file headers
        header('Content-Description: File Transfer');
        header('Content-Type: ' . $mime_type);
        header('Content-Disposition: inline; filename="' . $file_name . '"');
        header('Content-Length: ' . filesize($file_path));
        header('Cache-Control: private, max-age=86400');
        header('Pragma: public');
        header('Expires: 0');
        readfile($file_path);
        exit;
    }

    /**
     * Print (stream) a report file for blob usage.
     *
     * @param WP_REST_Request $request
     * @return WP_REST_Response|WP_Error
     */
    public function printReport(WP_REST_Request $request) {
        $id = $request->get_param('id');

        // Fetch report record
        $report = KCPatientMedicalReport::find($id);
        if (!$report) {
            return new WP_Error('not_found', __('Report not found', 'kivicare-pro'), ['status' => 404]);
        }

        // Get file path
        $file_path = get_attached_file((int)$report->uploadReport);
        if (!$file_path) {
            return new WP_Error('not_found', __('File not found', 'kivicare-pro'), ['status' => 404]);
        }
        $mime_type = mime_content_type($file_path);
        $file_name = basename($file_path);

        // Proper headers for file stream
        header('Access-Control-Allow-Origin: *');
        header('Access-Control-Expose-Headers: Content-Type, Content-Length, Content-Disposition');
        header('Content-Description: File Transfer');
        header('Content-Type: ' . $mime_type);
        header('Content-Disposition: inline; filename="' . $file_name . '"');
        header('Content-Length: ' . filesize($file_path));
        // Prevent browser caching to ensure updated files are always fetched
        header('Cache-Control: no-cache, no-store, must-revalidate');
        header('Pragma: no-cache');
        header('Expires: 0');
        readfile($file_path);
        exit;
    }

    /**
     * Send reports via email.
     *
     * Sends selected medical reports as attachments to the specified email address.
     *
     * @param WP_REST_Request $request The REST API request object. Expects 'report_ids', 'email', and 'patient_id'.
     * @return WP_REST_Response Returns a success message on successful email send,
     *                          or an error message and status code on failure.
     */
    public function sendReportsViaEmail(WP_REST_Request $request): WP_REST_Response
    {
        $params = $request->get_params();
        $report_ids = $params['report_ids'];

        if(empty($report_ids) || !is_array($report_ids)) {
            return $this->response(['error' => []], __('No reports selected', 'kivicare-pro'), false, 400);
        }
        $patient = KCPatient::find($params['patient_id']);
        $user_email = $patient->email ?: '';
        if (empty($user_email)) {
            return $this->response(['error' => []], __('Patient email not found', 'kivicare-pro'), false, 400);
        }

        $attachements = [];
        foreach ($report_ids as $report_id) {
            $report = KCPatientMedicalReport::find($report_id);
            if ($report) {
                $file_path = get_attached_file($report->uploadReport);
                if ($file_path && file_exists($file_path)) {
                    $attachements[] = $file_path;
                }
            }
        }

        $templateManager = KCEmailTemplateManager::getInstance();
        $template = $templateManager->getTemplate(KIVI_CARE_PREFIX . 'patient_report');
        
        if ($template) {
            $templateProcessor = new KCEmailTemplateProcessor();
            $emailData = [
                'current_date' => current_time('Y-m-d'),
                'current_date_time' => current_time('Y-m-d H:i:s')
            ];
            $subject = $templateProcessor->processTemplate($template->post_title, $emailData);
            $message = $templateProcessor->processTemplate($template->post_content, $emailData);
        } else {
            $subject = __('Reports', 'kivicare-pro');
            $message = __('Please find attached your reports.', 'kivicare-pro');
        }

        $headers = ['Content-Type: text/html; charset=UTF-8'];
        $sent = wp_mail($user_email, $subject, $message, $headers, $attachements);
        if ($sent) {
            return $this->response(true, __('Reports sent successfully', 'kivicare-pro'));
        }
        return $this->response(['error' => []], __('Failed to send reports', 'kivicare-pro'), false, 500);
    }


}