<?php

namespace KCProApp\controllers\api;

use App\baseClasses\KCBaseController;
use KCProApp\models\KCGdprConsent;
use App\models\KCPatient;
use App\models\KCOption;
use App\baseClasses\KCBase;
use WP_REST_Request;
use WP_Error;

defined('ABSPATH') or die('Something went wrong');

class KCProGdprConsentController extends KCBaseController
{
    protected $route = 'pro/gdpr-consent';

    public function registerRoutes()
    {
        // Store a new consent record
        $this->registerRoute('/' . $this->route, [
            'methods'             => 'POST',
            'callback'            => [$this, 'storeConsent'],
            'permission_callback' => [$this, 'checkPermission'],
            'args'                => [
                'user_id'            => ['required' => true,  'type' => 'integer'],
                'consent_type'       => ['required' => true,  'type' => 'string'],
                'consent_version_id' => ['required' => true,  'type' => 'string'],
                'status'             => ['required' => false, 'type' => 'string'],
            ],
        ]);

        // Get consents for the current user
        $this->registerRoute('/' . $this->route, [
            'methods'             => 'GET',
            'callback'            => [$this, 'getUserConsents'],
            'permission_callback' => [$this, 'checkPermission'],
        ]);

        // Admin-only: list ALL consents (Consent Completed page)
        $this->registerRoute('/' . $this->route . '/all', [
            'methods'             => 'GET',
            'callback'            => [$this, 'getAllConsents'],
            'permission_callback' => [$this, 'checkAdminPermission'],
        ]);

        // DSR requests (Delete only)
        $this->registerRoute('/' . $this->route . '/gdpr-dsr', [
            'methods'             => 'POST',
            'callback'            => [$this, 'handleDsrRequest'],
            'permission_callback' => [$this, 'checkPermission'],
        ]);

        // Export patient data
        $this->registerRoute('/' . 'pro/patient' . '/export-data', [
            'methods'             => 'POST',
            'callback'            => [$this, 'exportPatientData'],
            'permission_callback' => [$this, 'checkPermission'],
        ]);
    }

    public function checkAdminPermission(): bool|\WP_Error
    {
        if (!current_user_can('manage_options')) {
            return new WP_Error(
                'rest_forbidden',
                __('You do not have permission to view all consents.', 'kivicare-pro'),
                ['status' => 403]
            );
        }
        return true;
    }

    /**
     * GET pro/gdpr-consent/all
     *
     * Admin endpoint: paginated + filterable list of all consent records.
     */
    public function getAllConsents(WP_REST_Request $request)
    {
        $params = $request->get_params();

        $search = sanitize_text_field($params['search'] ?? '');
        $status = sanitize_text_field($params['status'] ?? '');
        $consentType = sanitize_text_field($params['consent_type'] ?? '');
        $page = max(1, (int) ($params['page'] ?? 1));
        $perPageParam = $params['per_page'] ?? '10';
        
        // Handle "Show All" option for perPage
        $showAll = strtolower($perPageParam) === 'all';
        $perPage = $showAll ? null : (int) $perPageParam;

        $export = sanitize_text_field($params['export'] ?? '');
        $sortBy = sanitize_text_field($params['sort_by'] ?? '');
        $order = strtolower(sanitize_text_field($params['order'] ?? 'desc')) === 'asc' ? 'asc' : 'desc';
        
        // Use query builder pattern starting from KCGdprConsent
        $query = KCGdprConsent::table('c')
            ->select([
                "c.user_id AS id",
                "u.display_name AS patient_name",
                "u.user_email AS email",
                "GROUP_CONCAT(DISTINCT c.consent_type ORDER BY c.consent_type SEPARATOR ', ') AS consent_type",
                "c.consent_version_id AS version",
                "c.status",
                "c.method",
                "MAX(c.granted_at) AS granted_at",
                "MAX(c.withdrawn_at) AS withdrawn_at",
                "c.ip_address"
            ])
            ->leftJoin(\App\models\KCUser::class, 'c.user_id', '=', 'u.ID', 'u');

        if ($search !== '') {
            $query->where(function ($q) use ($search) {
                $q->where("u.user_login", 'LIKE', "%{$search}%")
                  ->orWhere("u.user_email", 'LIKE', "%{$search}%")
                  ->orWhere("u.display_name", 'LIKE', "%{$search}%");
            });
        }

        if ($status !== '') {
            $query->where("c.status", '=', $status);
        }

        if ($consentType !== '') {
            $query->where("c.consent_type", '=', $consentType);
        }

        // Clone query for total count before applying GROUP BY
        $totalQuery = clone $query;
        $total = $totalQuery->countDistinct('c.user_id, c.consent_version_id, c.status');

        // Apply grouping
        $query->groupBy(['c.user_id', 'c.consent_version_id', 'c.status']);
        
        // Apply sorting
        $sortColumn = $this->getSortColumn($sortBy);
        if ($sortColumn) {
            $query->orderBy($sortColumn, $order);
        } else {
            // Default sorting
            $query->orderBy('MAX(c.id)', 'DESC');
        }

        if ($export === 'json') {
            $results = $query->get();
            $exportData = [];
            foreach ($results as $item) {
                $raw_timestamp = ($item->status === 'revoked') ? ($item->withdrawn_at ?? '') : ($item->granted_at ?? '');
                $formatted_timestamp = kcGetFormatedDateTimeWithTimezone($raw_timestamp, ' ');
                
                $exportData[] = [
                    'id' => $item->id ?? '',
                    'patient_name' => $item->patient_name ?? '',
                    'email' => $item->email ?? '',
                    'consent_type' => $item->consent_type ?? '',
                    'version' => $item->version ?? '',
                    'status' => $item->status ?? '',
                    'method' => $item->method ?? '',
                    'granted_at' => $item->granted_at ?? '',
                    'withdrawn_at' => $item->withdrawn_at ?? '',
                    'timestamp' => $formatted_timestamp,
                    'ip_address' => $item->ip_address ?? '',
                ];
            }
            return $this->response([
                'data' => $exportData,
            ], __('Consents exported successfully', 'kivicare-pro'));
        }

        // Apply pagination only if not showing all
        if (!$showAll) {
            $offset = ($page - 1) * $perPage;
            $query->limit($perPage)->offset($offset);
        }

        $results = $query->get();
        $rows = [];
        foreach ($results as $item) {
            $raw_timestamp = ($item->status === 'revoked') ? ($item->withdrawn_at ?? '') : ($item->granted_at ?? '');
            $formatted_timestamp = kcGetFormatedDateTimeWithTimezone($raw_timestamp, ' ');
            
            // Get profile image URL
            $profileImageUrl = '';
            $profileImageId  = get_user_meta($item->id,'patient_profile_image',true);
            if (!empty($profileImageId)) {
                $profileImageUrl = wp_get_attachment_url($profileImageId);
            }
            $rows[] = [
                'id' => $item->id ?? '',
                'patient_name' => $item->patient_name ?? '',
                'email' => $item->email ?? '',
                'consent_type' => $item->consent_type ?? '',
                'version' => $item->version ?? '',
                'status' => $item->status ?? '',
                'method' => $item->method ?? '',
                'granted_at' => $item->granted_at ?? '',
                'withdrawn_at' => $item->withdrawn_at ?? '',
                'timestamp' => $formatted_timestamp,
                'ip_address' => $item->ip_address ?? '',
                'patient_image_url' =>  $profileImageUrl,
            ];
        }

        return $this->response([
            'data' => $rows,
            'total' => $total,
            'page' => $page,
            'per_page' => $showAll ? $total : $perPage,
            'last_page' => $perPage > 0 ? ceil($total / $perPage) : 1,
        ], __('Consents retrieved successfully', 'kivicare-pro'));
    }

    public function checkPermission($request)
    {
        return is_user_logged_in();
    }

    /**
     * POST pro/gdpr-dsr
     * Handle Data Subject Access Requests (DSAR) for deletion only.
     */
    public function handleDsrRequest(WP_REST_Request $request)
    {
        $userId = get_current_user_id();

        if (!$userId) {
            return new WP_Error(
                'unauthorized',
                __('User not authenticated.', 'kivicare-pro'),
                ['status' => 401]
            );
        }

        try {
            $deleted = $this->deleteUserData($userId);
            return $this->response(
                ['success' => true, 'type' => 'deletion', 'deleted' => $deleted],
                __('Your data has been deleted successfully.', 'kivicare-pro')
            );
        } catch (\Exception $e) {
            return new WP_Error(
                'gdpr_deletion_failed',
                __('Failed to delete user data.', 'kivicare-pro'),
                ['status' => 500, 'error' => $e->getMessage()]
            );
        }
    }

    /**
     * POST pro/patient/request-data
     * Export patient data and send download link via email
     */
    public function exportPatientData(WP_REST_Request $request)
    {
        $userId = get_current_user_id();

        if (!$userId) {
            return new WP_Error(
                'unauthorized',
                __('User not authenticated.', 'kivicare-pro'),
                ['status' => 401]
            );
        }

        $user = get_userdata($userId);
        if (!$user) {
            return new WP_Error(
                'user_not_found',
                __('User not found.', 'kivicare-pro'),
                ['status' => 404]
            );
        }

        // Create a WordPress personal data export request
        $request_id = wp_create_user_request($user->user_email, 'export_personal_data');

        if (is_wp_error($request_id)) {
            return new WP_Error(
                'export_request_failed',
                $request_id->get_error_message(),
            );
        }

        /**
         * Send confirmation email only if request is pending
         */
        $request_post = get_post($request_id);

        if ($request_post && $request_post->post_status === 'request-pending') {
            if (function_exists('wp_send_user_request')) {
                wp_send_user_request($request_id);
            }
        }

        return $this->response(
            ['success' => true, 'request_id' => $request_id],
            __('Your data export request has been submitted. Please check your email to confirm the request.', 'kivicare-pro')
        );
    }

    private function deleteUserData(int $userId): array
    {
        $deleted = [
            'usermeta_deleted' => 0,
            'user_anonymized'  => 0,
            'user_not_found'   => 0,
            'password_changed' => 0,
        ];

        $user = get_user_by('ID', $userId);

        // User not found
        if (!$user) {
            $deleted['user_not_found'] = 1;
            return $deleted;
        }

        // Generate unique anonymized values using sequence
        $next_seq    = $this->getNextAnonymizedSequence();
        $anon_login  = 'deleted_user_' . $next_seq;
        $anon_email  = 'deleted_user_' . $next_seq . '@example.invalid';
        $anon_pass   = wp_generate_password(32, true, true);

        global $wpdb;

        $wpdb->query(
            $wpdb->prepare(
                "UPDATE {$wpdb->users} SET user_login = %s WHERE ID = %d",
                $anon_login,
                $userId
            )
        );

        clean_user_cache($userId);

        // Suppress password and email change notification emails
        add_filter('send_password_change_email', '__return_false');
        add_filter('send_email_change_email', '__return_false');

        // Update core WordPress user
        $user_update = wp_update_user([
            'ID'            => $userId,
            'user_email'    => $anon_email,
            'display_name'  => $anon_login,
            'nickname'      => $anon_login,
            'user_nicename' => $anon_login,
            'first_name'    => '',
            'last_name'     => '',
            'user_pass'     => $anon_pass,
        ]);

        // Restore filters
        remove_filter('send_password_change_email', '__return_false');
        remove_filter('send_email_change_email', '__return_false');

        if (!is_wp_error($user_update)) {
            $deleted['user_anonymized'] = 1;
            $deleted['password_changed'] = 1;
        }

        // Meta keys saved by KCPatient
        $metaKeys = [
            'first_name',
            'last_name',
            'basic_data',
            'patient_profile_image',
            'patient_unique_id',
            'timezone',
            'kc_timezone',
            'patient_added_by',
        ];

        foreach ($metaKeys as $metaKey) {
            $deleted['usermeta_deleted'] += (int) delete_user_meta($userId, $metaKey);
        }

        return $deleted;
    }

    /**
     * Get the next available sequence number for anonymized users
     * 
     * @return int
     */
    private function getNextAnonymizedSequence(): int
    {
        global $wpdb;
        $users = $wpdb->get_results("SELECT user_login FROM {$wpdb->users} WHERE user_login LIKE 'deleted_user_%' OR user_login = 'deleted_user'");
        $max_num = 0;
        foreach ($users as $u) {
            $login = $u->user_login;
            if ($login === 'deleted_user') {
                $max_num = max($max_num, 0); 
            } else {
                $parts = explode('_', $login);
                $num = (int) end($parts);
                $max_num = max($max_num, $num);
            }
        }
        return $max_num + 1;
    }


    /**
     * POST pro/gdpr-consent
     * Store a new consent record for the given user and consent type.
     */
    public function storeConsent(WP_REST_Request $request)
    {
        $params           = $request->get_params();
        $userId           = intval($params['user_id'] ?? 0);
        $consentType      = sanitize_text_field($params['consent_type'] ?? '');
        $consentVersionId = sanitize_text_field($params['consent_version_id'] ?? '');
        $status           = sanitize_text_field($params['status'] ?? 'granted');

        if (!$userId || !$consentType || $consentVersionId === '') {
            return new WP_Error(
                'invalid_params',
                __('user_id, consent_type, and consent_version_id are required.', 'kivicare-pro'),
                ['status' => 400]
            );
        }

        $currentUserId = get_current_user_id();
        if ($userId !== $currentUserId && !current_user_can('manage_options')) {
            return new WP_Error(
                'forbidden',
                __('You do not have permission to store consent for this user.', 'kivicare-pro'),
                ['status' => 403]
            );
        }

        try {
            // Upsert: update existing record for this user/type/version, or create a new one
            $consent = KCGdprConsent::table('c')
                ->where('user_id', $userId)
                ->where('consent_type', $consentType)
                ->where('consent_version_id', $consentVersionId)
                ->first();

            if (!$consent) {
                $consent                     = new KCGdprConsent();
                $consent->user_id            = $userId;
                $consent->consent_type       = $consentType;
                $consent->consent_version_id = $consentVersionId;
                $consent->created_at         = current_time('mysql');
            }

            $consent->status = $status;

            if ($status === 'granted') {
                $consent->granted_at   = current_time('mysql');
                $consent->withdrawn_at = null;
            } else {
                $consent->granted_at   = null;
                $consent->withdrawn_at = current_time('mysql');
            }

            $consent->ip_address      = $_SERVER['REMOTE_ADDR'] ?? null;
            $consent->user_agent      = $_SERVER['HTTP_USER_AGENT'] ?? null;
            $consent->method          = 'api';
            $consent->proof_reference = null;
            $consent->save();

            // When a patient revokes their GDPR confirmation, their status should be inactivation. 
            if ($status === 'revoked') {
                $patient = KCPatient::find($userId);
                if ($patient) {
                    // Update only user_status without touching patient meta/basic_data
                    $patient->updateStatus(1);
                }
            }

            $rows = $this->fetchConsents(['c.id' => $consent->id]);
            $data = $rows->isNotEmpty() ? $this->formatConsent($rows->first()) : ['id' => $consent->id];

            // Get redirect url from general settings
            $role = KCBase::get_instance()->getLoginUserRole();
            $logout_redirects = KCOption::get('logout_redirect', []);
            $redirect_url = !empty($logout_redirects[$role]) ? apply_filters('kc_logout_redirect_url', $logout_redirects[$role], $role) : '';

            return $this->response(
                [
                    'consent' => $data,
                    'redirect_url' => $redirect_url
                ],
                __('Consent stored successfully', 'kivicare-pro')
            );
        } catch (\Exception $e) {
            return new WP_Error(
                'kc_gdpr_store_failed',
                __('Failed to store consent.', 'kivicare-pro'),
                ['status' => 500, 'error' => $e->getMessage()]
            );
        }
    }

    /**
     * GET pro/gdpr-consent
     * Returns all consent records for the currently authenticated user.
     */
    public function getUserConsents(WP_REST_Request $request)
    {
        $currentUserId = get_current_user_id();

        try {
            $rows = $this->fetchConsents(['user_id' => $currentUserId]);

            // Since fetchConsents orders by id desc, unique('consent_type') will keep the latest record for each type
            $uniqueConsents = $rows->unique('consent_type')->values();

            return $this->response(
                ['consents' => $uniqueConsents->map(fn($row) => $this->formatConsent($row))->toArray()],
                __('Consents retrieved successfully', 'kivicare-pro')
            );
        } catch (\Exception $e) {
            return new WP_Error(
                'kc_gdpr_consents_fetch_failed',
                __('Failed to fetch consents.', 'kivicare-pro'),
                ['status' => 500, 'error' => $e->getMessage()]
            );
        }
    }

    /**
     * Fetch consent rows from the DB with optional WHERE filters.
     */
    private function fetchConsents(array $where)
    {
        $query = KCGdprConsent::table('c')
            ->select([
                'c.id',
                'c.consent_type',
                'c.consent_version_id',
                'c.status',
                'c.granted_at',
                'c.withdrawn_at',
                'c.method',
                'c.ip_address',
            ])
            ->orderBy('c.id', 'desc');

        foreach ($where as $col => $val) {
            $qualifiedCol = str_contains($col, '.') ? $col : 'c.' . $col;
            $query->where($qualifiedCol, '=', $val);
        }

        return $query->get();
    }

    /**
     * Map frontend column names to database columns for sorting
     */
    private function getSortColumn($sortBy)
    {
        $sortMap = [
            'id' => 'c.user_id',
            'patient_name' => 'u.display_name',
            'email' => 'u.user_email',
            'consent_type' => 'c.consent_type',
            'version' => 'c.consent_version_id',
            'status' => 'c.status',
            'timestamp' => ($sortBy === 'timestamp') ? "CASE WHEN c.status = 'revoked' THEN c.withdrawn_at ELSE c.granted_at END" : 'MAX(c.id)',
            'ip_address' => 'c.ip_address',
        ];

        return $sortMap[$sortBy] ?? null;
    }

    /**
     * Map a raw DB row (stdClass) to the structured frontend format.
     */
    private function formatConsent(object $row): array
    {
        return [
            'id'                 => (int) $row->id,
            'consent_type'       => $row->consent_type,
            'consent_version_id' => $row->consent_version_id,
            'status'             => $row->status,
            'granted_at'         => $row->granted_at,
            'withdrawn_at'       => $row->withdrawn_at,
            'method'             => $row->method,
            'ip_address'         => $row->ip_address,
        ];
    }
}
