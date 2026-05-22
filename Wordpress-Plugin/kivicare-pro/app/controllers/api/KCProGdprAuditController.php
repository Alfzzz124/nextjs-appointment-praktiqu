<?php

namespace KCProApp\controllers\api;

use App\baseClasses\KCBaseController;
use App\baseClasses\KCPermissions;
use KCProApp\models\KCGdprAuditLog;
use WP_REST_Request;
use WP_REST_Response;

defined('ABSPATH') or die('Something went wrong');

/**
 * Class KCProGdprAuditController
 *
 * API controller for GDPR audit log listing, filtering and summary counters.
 *
 * @package KCProApp\controllers\api
 */
class KCProGdprAuditController extends KCBaseController
{
    /**
     * @var string
     */
    protected $route = 'gdpr/audit';

    /**
     * Event groups used by priority summary cards.
     */
    private const CRITICAL_EVENTS = ['login_failed', 'security', 'incident', 'error'];
    private const HIGH_EVENTS     = ['login', 'logout', 'data_export', 'data_delete'];
    private const MEDIUM_EVENTS   = ['data_create', 'data_modify'];
    private const TIER_EVENTS     = ['login_failed', 'security', 'incident', 'error', 'login', 'logout', 'data_export', 'data_delete', 'data_create', 'data_modify'];

    public function registerRoutes()
    {
        $this->registerRoute('/' . $this->route, [
            'methods'             => \WP_REST_Server::READABLE,
            'callback'            => [$this, 'getAuditLogs'],
            'permission_callback' => [$this, 'checkPermissions'],
            'args'                => $this->getAuditLogsArgs(),
        ]);
    }

    /**
     * Get arguments for the audit logs list endpoint
     *
     * @return array
     */
    private function getAuditLogsArgs(): array
    {
        return [
            'page' => [
                'description' => 'Current page of results',
                'type'        => 'integer',
                'default'     => 1,
                'sanitize_callback' => 'absint',
            ],
            'per_page' => [
                'description' => 'Number of results per page',
                'type'        => 'string',
                'default'     => 10,
                'validate_callback' => [$this, 'validatePerPage'],
                'sanitize_callback' => function ($param) {
                    return strtolower($param) === 'all' ? 'all' : absint($param);
                },
            ],
            'start_date' => [
                'description' => 'Filter by start date',
                'type'        => 'string',
                'sanitize_callback' => 'sanitize_text_field',
            ],
            'end_date' => [
                'description' => 'Filter by end date',
                'type'        => 'string',
                'sanitize_callback' => 'sanitize_text_field',
            ],
            'actor_id' => [
                'description' => 'Filter by actor user ID',
                'type'        => 'integer',
                'sanitize_callback' => 'absint',
            ],
            'patient_id' => [
                'description' => 'Filter by patient (subject) user ID',
                'type'        => 'integer',
                'sanitize_callback' => 'absint',
            ],
            'event_type' => [
                'description' => 'Filter by event type',
                'type'        => 'string',
                'sanitize_callback' => 'sanitize_text_field',
            ],
            'resource_type' => [
                'description' => 'Filter by resource type',
                'type'        => 'string',
                'sanitize_callback' => 'sanitize_text_field',
            ],
            'category' => [
                'description' => 'Filter by category',
                'type'        => 'string',
                'sanitize_callback' => 'sanitize_text_field',
            ],
            'priority' => [
                'description' => 'Filter by priority level',
                'type'        => 'string',
                'sanitize_callback' => 'sanitize_text_field',
            ],
            'status' => [
                'description' => 'Filter by status',
                'type'        => 'string',
                'sanitize_callback' => 'sanitize_text_field',
            ],
            'search' => [
                'description' => 'Search term to filter results',
                'type'        => 'string',
                'sanitize_callback' => 'sanitize_text_field',
            ],
            'role' => [
                'description' => 'Filter by user role',
                'type'        => 'string',
                'sanitize_callback' => 'sanitize_text_field',
            ],
            'orderby' => [
                'description' => 'Sort results by specified field',
                'type'        => 'string',
                'default'     => 'created_at',
                'validate_callback' => [$this, 'validateOrderBy'],
                'sanitize_callback' => 'sanitize_text_field',
            ],
            'order' => [
                'description' => 'Sort direction (asc or desc)',
                'type'        => 'string',
                'default'     => 'desc',
                'validate_callback' => [$this, 'validateOrder'],
                'sanitize_callback' => function ($param) {
                    return strtolower(sanitize_text_field($param));
                },
            ],
        ];
    }

    /**
     * Validate order direction
     *
     * @param string $param
     * @return bool|\WP_Error
     */
    public function validateOrder($param)
    {
        if (!in_array(strtolower($param), ['asc', 'desc'], true)) {
            return new \WP_Error('invalid_order', __('Order must be asc or desc', 'kivicare-pro'));
        }
        return true;
    }

    /**
     * Validate orderby field
     *
     * @param string $param
     * @return bool|\WP_Error
     */
    public function validateOrderBy($param)
    {
        $allowed = ['created_at', 'id', 'event_type', 'actor_id', 'priority', 'status'];
        if (!in_array($param, $allowed, true)) {
            return new \WP_Error('invalid_orderby', __('Invalid sort field', 'kivicare-pro'));
        }
        return true;
    }

    /**
     * Validate per page parameter
     *
     * @param mixed $param
     * @return bool|\WP_Error
     */
    public function validatePerPage($param)
    {
        if (strtolower($param) === 'all') {
            return true;
        }
        if (!is_numeric($param) || (int) $param <= 0) {
            return new \WP_Error('invalid_per_page', __('Invalid per page value', 'kivicare-pro'));
        }
        return true;
    }

    public function checkPermissions()
    {
        if (!is_user_logged_in()) {
            return false;
        }

        if (current_user_can('administrator')) {
            return true;
        }

        return (
            KCPermissions::has_permission('dpo_dashboard') ||
            in_array('dpo', (array) wp_get_current_user()->roles)
        );
    }

    /**
     * Fetch GDPR Audit Logs with filtering and pagination
     *
     * @param WP_REST_Request $request
     * @return WP_REST_Response
     */
    public function getAuditLogs(WP_REST_Request $request)
    {
        try {
            $page         = (int) $request->get_param('page');
            $rawPerPage   = $request->get_param('per_page');
            $isAllPerPage = $rawPerPage === 'all';

            $totalQuery = KCGdprAuditLog::query();
            $logsQuery  = KCGdprAuditLog::query();

            $this->applyAuditFilters($totalQuery, $request);
            $this->applyAuditFilters($logsQuery, $request);

            $totalRecords = (int) $totalQuery->count();
            $perPage      = $isAllPerPage
                ? (int) max(1, $totalRecords)
                : (int) max(1, (int) ($rawPerPage ?: 20));
            $offset = $isAllPerPage ? 0 : ($page - 1) * $perPage;

            if ($isAllPerPage) {
                $page = 1;
            }

            $orderBy = $request->get_param('orderby');
            $order   = $request->get_param('order');

            $summary    = $this->calculateSummaryCounts($request);
            $logsData   = $this->getPaginatedLogs($logsQuery, $offset, $perPage, $orderBy, $order);
            $usersData  = $this->getAuditUsers();
            $totalPages = $isAllPerPage ? 1 : (int) ceil($totalRecords / $perPage);

            return $this->response([
                'logs'       => $logsData,
                'users'      => $usersData,
                'summary'    => $summary,
                'pagination' => [
                    'total_records' => $totalRecords,
                    'total_pages'   => $totalPages,
                    'current_page'  => $page,
                    'per_page'      => $perPage,
                ],
            ], esc_html__('Audit logs retrieved successfully', 'kivicare-pro'), true, 200);

        } catch (\Throwable $e) {
            error_log('KC GDPR Audit Controller Error: ' . $e->getMessage());
            return $this->response(null, esc_html__('Error retrieving audit logs: ', 'kivicare-pro') . $e->getMessage(), false, 500);
        }
    }

    private function getPaginatedLogs($logsQuery, int $offset, int $perPage, string $orderBy = 'created_at', string $order = 'DESC'): array
    {
        $sortMap = [
            'created_at' => 'created_at',
            'id'         => 'id',
            'event_type' => 'event_type',
            'actor_id'   => 'actor_user_id',
            'priority'   => 'event_type',
            'status'     => 'event_type',
        ];

        $sortColumn = $sortMap[$orderBy] ?? 'created_at';

        // phpcs:ignore Squiz.NamingConventions.ValidVariableName.MemberNotCamelCaps
        $logs = $logsQuery->orderBy($sortColumn, $order)
            ->orderBy('id', 'DESC')
            ->offset($offset)
            ->limit($perPage)
            ->get();

        if (empty($logs)) {
            return [];
        }

        $logsData = [];
        foreach ($logs as $log) {
            $logArray = $log->toArray();
            $logArray['actor_display_name'] = $this->resolveActorDisplayName((int) ($logArray['actor_user_id'] ?? 0));
            $logArray['created_at_formatted'] = kcGetFormatedDateTimeWithTimezone($logArray['created_at'] ?? '');
            $logsData[] = $logArray;
        }

        return $logsData;
    }

    private function resolveActorDisplayName(int $actorUserId): string
    {
        if ($actorUserId > 0) {
            $userData = get_userdata($actorUserId);
            if ($userData) {
                return self::resolveDisplayName($userData);
            }
        }

        return 'System';
    }

    private static function resolveDisplayName(\WP_User $user): string
    {
        return !empty($user->display_name) ? $user->display_name : $user->user_login;
    }

    private function getAuditUsers(): array
    {
        try {
            $allUsers  = get_users([
                'number'  => 2000,
                'orderby' => 'display_name',
                'order'   => 'ASC',
            ]);
            $usersData = [];

            foreach ($allUsers as $user) {
                $roles       = isset($user->roles) && is_array($user->roles) ? $user->roles : [];
                $usersData[] = [
                    'id'           => (int) $user->ID,
                    'display_name' => self::resolveDisplayName($user),
                    'user_login'   => $user->user_login,
                    'role'         => !empty($roles) ? $roles[0] : 'unknown',
                    'roles'        => $roles,
                ];
            }

            return $usersData;
        } catch (\Throwable $e) {
            return [];
        }
    }

    private function calculateSummaryCounts(WP_REST_Request $request): array
    {
        $summary = [
            'critical' => 0,
            'high'     => 0,
            'medium'   => 0,
            'lower'    => 0,
        ];

        try {
            $query = KCGdprAuditLog::query();
            // KCQueryBuilder::select() places column expressions verbatim in the SELECT clause,
            // so a raw COUNT expression is supported here without a selectRaw helper.
            $rows = $query->select(['event_type', 'COUNT(*) as cnt'])
                ->groupBy('event_type')
                ->get();

            foreach ($rows as $row) {
                $eventType = (string) ($row->event_type ?? '');
                $count     = (int) ($row->cnt ?? 0);

                if (in_array($eventType, self::CRITICAL_EVENTS, true)) {
                    $summary['critical'] += $count;
                } elseif (in_array($eventType, self::HIGH_EVENTS, true)) {
                    $summary['high'] += $count;
                } elseif (in_array($eventType, self::MEDIUM_EVENTS, true)) {
                    $summary['medium'] += $count;
                } else {
                    $summary['lower'] += $count;
                }
            }
        } catch (\Throwable $e) {
            error_log('KC GDPR Audit Summary Error: ' . $e->getMessage());
        }

        return $summary;
    }

    private function applyAuditFilters($query, WP_REST_Request $request): void
    {
        $startDate    = $request->get_param('start_date');
        $endDate      = $request->get_param('end_date');
        $actorId      = (int) $request->get_param('actor_id');
        $patientId    = (int) $request->get_param('patient_id');
        $eventType    = $request->get_param('event_type');
        $resourceType = $request->get_param('resource_type');
        $category     = $request->get_param('category');
        $priority     = $request->get_param('priority');
        $status       = $request->get_param('status');
        $searchStr    = $request->get_param('search');
        $role         = $request->get_param('role');

        if (!empty($startDate)) {
            $query->where('created_at', '>=', $startDate . ' 00:00:00');
        }
        if (!empty($endDate)) {
            $query->where('created_at', '<=', $endDate . ' 23:59:59');
        }
        if ($actorId > 0) {
            $query->where('actor_user_id', $actorId);
        }
        if ($patientId > 0) {
            $query->where('subject_user_id', $patientId);
        }
        if (!empty($eventType)) {
            $query->where('event_type', $eventType);
        }
        if (!empty($resourceType)) {
            $query->where('resource_type', $resourceType);
        }

        if (!empty($role)) {
            $roleUsers = get_users(['role' => $role, 'fields' => 'ID']);

            // Fallback for KiviCare prefixed roles
            if (empty($roleUsers) && $role !== 'administrator') {
                $roleUsers = get_users(['role' => 'kiviCare_' . $role, 'fields' => 'ID']);
            }

            if (!empty($roleUsers)) {
                $query->whereIn('actor_user_id', $roleUsers);
            } else {
                $query->where('actor_user_id', 0);
            }
        }

        $this->applyCategoryFilter($query, $category);
        $this->applyPriorityFilter($query, $priority);
        $this->applyStatusFilter($query, $status);

        if (!empty($searchStr)) {
            $query->where(function ($searchQuery) use ($searchStr) {
                $searchQuery->where('action', 'LIKE', '%' . $searchStr . '%')
                    ->orWhere('details', 'LIKE', '%' . $searchStr . '%');
            });
        }
    }

    private function applyCategoryFilter($query, $category): void
    {
        if (empty($category)) {
            return;
        }

        switch ($category) {
            case 'authentication':
                $query->whereIn('event_type', ['login', 'logout', 'login_failed']);
                return;
            case 'patient_record':
                $query->where('event_type', 'data_access')->where('resource_type', 'patient');
                return;
            case 'clinical':
                $query->whereIn('resource_type', ['encounter', 'followup']);
                return;
            case 'prescription':
                $query->where('resource_type', 'prescription');
                return;
            case 'appointment':
                $query->where('resource_type', 'appointment');
                return;
            case 'user_role':
                $query->whereIn('event_type', ['data_create', 'data_modify'])
                      ->where(function ($q) {
                          $q->whereIn('resource_type', ['patient', 'doctor', 'clinic', 'receptionist', 'clinic_admin'])
                              ->orWhere(function ($subQ) {
                                  $subQ->where('resource_type', 'setting')
                                      ->where('details', 'LIKE', '%permission%');
                              });
                      });
                return;
            case 'security':
                $query->whereIn('event_type', ['error', 'incident', 'security']);
                return;
            case 'data_export':
                $query->where('event_type', 'data_export');
                return;
            case 'billing':
                $query->whereIn('resource_type', ['bill', 'payment', 'tax']);
                return;
            case 'system':
                $query->whereIn('resource_type', ['system', 'setting', 'configuration', 'custom_form', 'body_chart', 'notification_template', 'gdpr_setting', 'gdpr_audit_setting', 'gdpr_activity_setting', 'gdpr_consent', 'holiday', 'review'])
                      ->where(function ($q) {
                          $q->where('resource_type', '!=', 'setting')
                            ->orWhere('event_type', 'data_access')
                            ->orWhere('details', 'NOT LIKE', '%permission%');
                      });
                return;
        }
    }

    private function applyPriorityFilter($query, $priority): void
    {
        if (empty($priority)) {
            return;
        }

        switch ($priority) {
            case 'critical':
                $query->whereIn('event_type', self::CRITICAL_EVENTS);
                return;
            case 'high':
                $query->whereIn('event_type', self::HIGH_EVENTS);
                return;
            case 'medium':
                $query->whereIn('event_type', self::MEDIUM_EVENTS);
                return;
            case 'lower':
                $query->whereNotIn('event_type', self::TIER_EVENTS);
                return;
        }
    }

    private function applyStatusFilter($query, $status): void
    {
        if (empty($status)) {
            return;
        }

        if ($status === 'success') {
            $query->where('event_type', '!=', 'login_failed');
            return;
        }

        if ($status === 'failure') {
            $query->where('event_type', 'login_failed');
        }
    }
}
