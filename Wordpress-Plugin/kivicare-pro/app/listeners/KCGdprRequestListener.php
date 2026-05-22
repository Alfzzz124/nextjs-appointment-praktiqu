<?php

namespace KCProApp\listeners;

use KCProApp\services\KCGdprAuditService;
use WP_REST_Request;

defined('ABSPATH') or die('Something went wrong');

class KCGdprRequestListener
{
    private const AUDIT_MODE_DISABLED = 'disabled';
    private const ROUTE_PREFIX = '/kivicare/v1/';
    private const METHOD_GET = 'GET';

    private const ALWAYS_SKIP_CONTAINS = [
        'static_data',
        'config/user_preferences',
        'custom_fields',
        'sidebar',
        'permission',
        'calculate_tax',
        'google_event_template',
    ];

    private const ALLOWED_READ_BASES = [
        'patients',
        'doctors',
        'receptionists',
        'appointments',
        'encounters',
        'encounter_templates',
        'prescriptions',
        'billings',
        'taxes',
        'clinics',
        'services',
        'doctor_services',
        'doctor_sessions',
        'calendar',
        'dashboard',
        'reports',
        'settings',
        'config',
        'webhooks',
        'webhook_logs',
        'custom_forms',
        'body_chart',
        'push_templates',
        'gdpr_settings',
        'gdpr_audit_settings',
        'gdpr_consent',
        'holidays',
        'rating',
        'ratings',
        'followups',
    ];

    private const LIST_INTENT_KEYS = [
        'page',
        'per_page',
        'search',
        'orderby',
        'order',
        'sort',
        'status',
        'date_from',
        'date_to',
        'perPage',
        'startDate',
        'endDate',
    ];

    private const BASE_ALIAS_MAP = [
        'doctor_services' => 'services',
        'doctor_service' => 'services',
        'doctor_sessions' => 'doctor_sessions',
        'doctor_session' => 'doctor_sessions',
        'medical_reports' => 'reports',
        'patient_medical_reports' => 'reports',
        'patient_medical_report' => 'reports',
        'medical' => 'encounters',
        'billing' => 'billings',
        'bills' => 'billings',
        'bill' => 'billings',
        'encounter_template' => 'encounter_templates',
        'encounter_templates' => 'encounter_templates',
        'setting' => 'settings',
        'config' => 'settings',
        'custom_forms' => 'settings',
        'custom_form' => 'settings',
        'body_chart' => 'settings',
        'push_templates' => 'settings',
        'gdpr_settings' => 'settings',
        'gdpr_audit_settings' => 'settings',
        'gdpr_consent' => 'settings',
        'holidays' => 'settings',
        'configurations' => 'settings',
    ];

    private const CONTEXT_PATH_MAP = [
        '/setting' => 'settings',
        '/settings' => 'settings',
        '/configuration' => 'settings',
        '/consent' => 'settings',
        '/consent-completed' => 'settings',
        '/holiday' => 'settings',
        '/webhook' => 'settings',
        '/custom-field' => 'settings',
        '/custom-form' => 'settings',
        '/listing' => 'settings',
        '/body-chart' => 'settings',
        '/encounter-body-chart' => 'settings',
        '/gdpr' => 'settings',
        '/webhooks/events-log' => 'settings',
        '/encounter-template' => 'encounter_templates',
        '/encounter_template' => 'encounter_templates',
        '/doctor-session' => 'doctor_sessions',
        '/doctor-service' => 'doctor_services',
        '/service' => 'services',
        '/patient' => 'patients',
        '/doctor' => 'doctors',
        '/receptionist' => 'receptionists',
        '/encounter' => 'encounters',
        '/appointment' => 'appointments',
        '/clinic' => 'clinics',
        '/billing' => 'billings',
        '/tax' => 'taxes',
        '/calendar' => 'calendar',
        '/dashboard' => 'dashboard',
        '/report' => 'reports',
        '/followup' => 'followups',
        '/follow-up-treatment' => 'settings',
    ];

    private const SETTINGS_BASES = [
        'settings',
        'config',
        'webhooks',
        'webhook_logs',
        'custom_forms',
        'body_chart',
        'push_templates',
        'gdpr_settings',
        'gdpr_audit_settings',
        'gdpr_consent',
        'holidays',
    ];

    private const PLAIN_LIST_BASES = [
        'taxes',
        'rating',
        'ratings',
    ];

    private const LOOKUP_BASES = [
        'doctors',
        'receptionists',
        'patients',
        'clinics',
        'services',
        'doctor_services',
    ];

    private const RESOURCE_TYPE_MAP = [
        'appointments' => 'appointment',
        'patients' => 'patient',
        'patient_medical_reports' => 'patient_report',
        'encounters' => 'encounter',
        'encounter-templates' => 'encounter_template',
        'encounter_templates' => 'encounter_template',
        'prescriptions' => 'prescription',
        'billing' => 'bill',
        'billings' => 'bill',
        'bills' => 'bill',
        'taxes' => 'tax',
        'doctors' => 'doctor',
        'receptionists' => 'receptionist',
        'doctor-services' => 'service',
        'doctor_services' => 'service',
        'services' => 'service',
        'settings' => 'setting',
        'setting' => 'setting',
        'config' => 'configuration',
        'webhooks' => 'webhook',
        'webhook_logs' => 'webhook_event_log',
        'webhook-logs' => 'webhook_event_log',
        'webhook-log' => 'webhook_event_log',
        'custom_forms' => 'custom_form',
        'body_chart' => 'body_chart',
        'push_templates' => 'notification_template',
        'gdpr_settings' => 'gdpr_setting',
        'gdpr_audit_settings' => 'gdpr_audit_setting',
        'gdpr_consent' => 'gdpr_consent',
        'holidays' => 'holiday',
        'dashboard' => 'system',
        'calendar' => 'calendar',
        'rating' => 'review',
        'ratings' => 'review',
        'followups' => 'followup',
    ];

    private const DASHBOARD_CANDIDATE_BASES = [
        'dashboard',
        'appointments',
        'patients',
        'doctors',
        'clinics',
        'encounters',
        'billings',
        'reports',
        'audit',
    ];

    private const NESTED_PATIENT_MODULES = [
        'appointments',
        'encounters',
        'prescriptions',
        'billings',
        'reports',
    ];

    private const ALLOW_ALWAYS_PATHS = [
        'import/custom_fields',
        'import/custom_fields',
        'settings/permission',
        'settings/sidebar',
        'settings/sidebar-setting',
        'settings/sidebar_settings',
        'settings/webhook',
        'webhooks',
        'settings/pro_settings',
        'settings/listing',
        'settings/listings',
        'settings/custom_form',
        'settings/custom_forms',
        'custom-form',
        'custom-forms',
        'custom_form',
        'custom_forms',
        'webhook-log',
        'webhook-logs',
        'webhook_log',
        'webhook_logs',
        'settings/configurations',
    ];

    private const ALLOW_ALWAYS_CONTAINS = [
        'email_template', 'email-template',
        'sms_whatsapp_template', 'sms-whatsapp-template',
        'google_event_template', 'google-event-template',
        'google_meet', 'google-meet',
        'zoom_telemed', 'zoom-telemed'
    ];

    private const SETTINGS_SCREEN_MAP = [
        'holiday' => 'holidays',
        'doctor-session' => 'doctor_sessions',
        'doctor_service' => 'doctor_services',
        'doctor-service' => 'doctor_services',
        'webhook' => 'webhooks',
        'app-configuration' => 'configuration',
        'permission' => 'permission',
        'sidebar' => 'sidebar',
        'google-calendar' => 'google_calendar',
        'google-event-template' => 'google_event_templates',
        'google-meet-configuration' => 'google_meet_integration',
        'google-meet' => 'google_meet',
        'googlemeet' => 'google_meet',
        'zoom-configuration' => 'zoom_telemed',
        'zoom-telemed' => 'zoom_telemed',
        'custom-field' => 'custom_fields',
        'custom-form' => 'custom_forms',
        'webhook-logs' => 'webhook_logs',
        'custom-notification' => 'custom_notifications',
        'email-template' => 'email_templates',
        'email_template' => 'email_templates',
        'sms-whatsapp-template' => 'sms_whatsapp_templates',
        'sms' => 'sms_whatsapp_templates',
        'widget-setting' => 'widget_settings',
        'widget_setting' => 'widget_settings',
        'payment' => 'payment',
        'appointment-setting' => 'appointment_settings',
        'appointment-settings' => 'appointment_settings',
        'patient-setting' => 'patient_settings',
        'body-chart' => 'body_chart',
        'encounter-body-chart' => 'body_chart',
        'gdpr' => 'consent_settings',
        'consent-completed' => 'consent_completed',
        'consent' => 'consent',
        'listing' => 'listings',
        'pro-settings' => 'pro_settings',
        'configuration' => 'configuration',
        'setting' => 'settings',
    ];

    /**
     * Log PDF print actions that call exit() inside their callback.
     * Hooked to rest_request_before_callbacks so it fires BEFORE the callback runs,
     * which is the only opportunity to log before exit() terminates the process.
     * All non-print routes are ignored immediately at the top.
     */
    public static function logPrintRequest($response, $handler, $request)
    {
        try {
            if (!($request instanceof WP_REST_Request)) {
                return $response;
            }

            $route = (string) $request->get_route();

            // Fast check: if it doesn't even contain the word 'print', it's definitely not a print route.
            if (strpos($route, '/print') === false) {
                return $response;
            }

            // Match any print route variant:
            // - bills/107768/print
            // - encounters/1368/print
            // - prescriptions/encounter/868/print
            // - patient-medical-reports/print/42
            // - appointments/12659/print-invoice
            // Ignore everything else entirely — zero cost for normal routes.
            if (!preg_match('#/(bills/[^/]+/print|encounters/[^/]+/print|prescriptions/encounter/[^/]+/print|patient-medical-reports/print/[^/]+|appointments/[^/]+/print-invoice)#', $route)) {
                return $response;
            }

            // Delegate to the regular logger so the same label/category/priority
            // resolution pipeline is used (resolveEventAction, resolveResourceType, etc.).
            self::logRestRequest($response, $handler, $request);

            // Flush immediately — exit() will terminate shutdown hooks, so we cannot
            // rely on the normal shutdown flush for this route.
            KCGdprAuditService::commitLogs();

        } catch (\Throwable $e) {
            error_log('GDPR Print Listener Error: ' . $e->getMessage());
        }

        return $response;
    }

    /**
     * Log KiviCare REST calls for active audit modes.
     * Mode-specific write rules are enforced inside KCGdprAuditService::log().
     *
     * @param mixed $response
     * @param array $handler
     * @param WP_REST_Request $request
     * @return mixed
     */
    public static function logRestRequest($response, $handler, $request)
    {
        try {
            if (!is_user_logged_in() || !($request instanceof WP_REST_Request)) {
                return $response;
            }

            if (KCGdprAuditService::getAuditLogMode() === self::AUDIT_MODE_DISABLED) {
                return $response;
            }

            $statusCode = 200;
            if (is_wp_error($response)) {
                $errorData = $response->get_error_data();
                $statusCode = isset($errorData['status']) ? $errorData['status'] : 500;
            } elseif (is_object($response) && method_exists($response, 'get_status')) {
                $statusCode = $response->get_status();
            }

            // Skip logging if the request failed (e.g. validation errors, 400 Bad Request, 500 Internal Error)
            // We DO want to log 403 Forbidden errors as security incidents.
            if ($statusCode >= 400 && $statusCode !== 403) {
                return $response;
            }

        $route = (string) $request->get_route();
            if (strpos($route, self::ROUTE_PREFIX) !== 0) {
                return $response;
            }

            // Avoid logging audit/settings endpoints to reduce feedback noise.
            if (self::isInternalAuditRoute($route, $request)) {
                return $response;
            }

            $method    = strtoupper((string) $request->get_method());
            $routeMeta = self::parseRouteMeta($route);

            if (self::shouldSkipNoisyRoute($routeMeta, $method, $request)) {
                return $response;
            }

            [$eventType, $action] = self::resolveEventAction($method, $routeMeta, $request);

            // Override event type and action if it's an unauthorized access attempt
            if ($statusCode === 403) {
                $eventType = 'security';
                $action    = 'unauthorized_access';
            }

            $viewPath             = sanitize_text_field((string) $request->get_header('x-kc-view-path'));
            $normalizedContextBase = self::normalizeBaseAlias(self::resolveContextBaseFromViewPath($viewPath));

            $routeForLog = self::resolveRouteForLog(
                $route,
                $method,
                $viewPath,
                $routeMeta,
                $normalizedContextBase
            );

            $resourceType = self::resolveResourceType($route);
            $resourceId = self::resolveResourceId($request);
            if (empty($resourceId) && $method !== self::METHOD_GET) {
                $resourceId = self::resolveResourceIdFromResponse($response, $resourceType);
            }
            $subjectUserId = ($resourceType === 'patient' && !empty($resourceId)) ? $resourceId : null;

            $detailsPayload = [
                'route' => $routeForLog,
                'method' => $method,
                'view_path' => $viewPath,
                'setting_context' => self::resolveSettingContext($request, $routeForLog),
            ];
            if (!empty($resourceId)) {
                $detailsPayload['resource_id'] = $resourceId;
            }

            if ($routeMeta['normalized_base'] === 'webhook_logs') {
                $verb = $action === 'delete' ? 'Deleted' : 'Viewed';
                $noun = $action === 'delete' ? 'webhook event log' : 'webhook event logs';
                $detailsPayload['message'] = "$verb $noun" . ($resourceId ? " #$resourceId" : "");
                // Unset route to prevent old frontend JS from incorrectly matching 'webhook' in route
                unset($detailsPayload['route']);
            }

            if ($statusCode === 403) {
                $detailsPayload['message'] = 'Attempted to access forbidden data';
            }

            // Pass image_action_type for body-chart/config mutations so the JS helper
            // can distinguish add / edit / delete template operations.
            $imageActionType = $request->get_param('image_action_type');
            if (!empty($imageActionType)) {
                $detailsPayload['image_action_type'] = sanitize_text_field((string) $imageActionType);
            }

            // For body-chart mutations, store body_chart_id explicitly so the JS helper
            // can distinguish create (no body_chart_id) from update (has body_chart_id).
            if ($routeMeta['base_raw'] === 'body_chart') {
                $bodyChartId = $request->get_param('body_chart_id');
                if (!empty($bodyChartId) && is_numeric($bodyChartId)) {
                    $detailsPayload['body_chart_id'] = (int) $bodyChartId;
                }
            }

            // For gdpr-consent POST, pass the consent status so the JS helper
            // can distinguish "Create Consent Setting" from "Revoke Consent".
            if (strpos($routeForLog, 'gdpr-consent') !== false && $method === 'POST') {
                $consentStatus = sanitize_text_field((string) $request->get_param('status'));
                if (!empty($consentStatus)) {
                    $detailsPayload['consent_status'] = $consentStatus;
                }
            }

            // For medical history POST/PUT, pass the type (problem, observation, note) so the JS helper
            // can distinguish the specific medical history action.
            if ((strpos($routeForLog, 'medical-history') !== false || strpos($routeForLog, 'prescriptions') !== false) && in_array($method, ['POST', 'PUT'], true)) {
                $historyType = sanitize_text_field((string) $request->get_param('type'));
                if (empty($historyType)) {
                    $historyType = sanitize_text_field((string) $request->get_param('staticType'));
                }
                if (!empty($historyType)) {
                    $detailsPayload['history_type'] = $historyType;
                }
            }

            if ($resourceType === 'service' && !empty($resourceId) && in_array($method, ['PUT', 'PATCH'], true)) {
                $detailsPayload['message'] = 'Updated doctor service #' . $resourceId;
            }

            if (strpos($route, 'static-data') !== false && $method === 'POST') {
                $staticType = sanitize_text_field((string) $request->get_param('type'));
                if (empty($staticType)) {
                    $staticType = sanitize_text_field((string) $request->get_param('staticType'));
                }
                $staticLabel = sanitize_text_field((string) $request->get_param('label'));
                if (!empty($staticType)) {
                    $detailsPayload['static_type'] = $staticType;
                    $detailsPayload['static_label'] = $staticLabel;
                }
            }

            // Detect bill create/update with paid status (means encounter is also being closed).
            $isBillRoute = in_array($routeMeta['normalized_base'], ['billings', 'bills'], true);
            $isBillPaid  = $isBillRoute && strtolower((string) $request->get_param('status')) === 'paid';

            KCGdprAuditService::log(
                $eventType,
                $subjectUserId,
                $resourceType,
                $resourceId,
                $action,
                $detailsPayload
            );

            // When the bill is paid, the encounter is closed in the same request.
            // Emit a second, distinct audit entry so both actions are visible in the activity log.
            if ($isBillPaid) {
                KCGdprAuditService::log(
                    $eventType,
                    $subjectUserId,
                    $resourceType,
                    $resourceId,
                    $action,
                    array_merge($detailsPayload, ['close_encounter' => true])
                );
            }
        } catch (\Throwable $e) {
            error_log('GDPR Request Listener Error: ' . $e->getMessage());
        }

        return $response;
    }

    /**
     * Skip noisy helper endpoints (metadata/support calls) in all-events mode.
     * These are frequently auto-fetched during page rendering and create duplicate noise.
     *
     * The caller must pass the already-parsed $routeMeta so it is not re-computed here.
     *
     * @param array<string,string> $routeMeta Pre-parsed route metadata from parseRouteMeta()
     * @param string               $method
     * @param WP_REST_Request|null $request
     * @return bool
     */
    private static function shouldSkipNoisyRoute(array $routeMeta, string $method, ?WP_REST_Request $request = null): bool
    {
        $normalizedPath = $routeMeta['normalized_path'];
        $baseRaw        = $routeMeta['base_raw'];
        $normalizedBase = $routeMeta['normalized_base'];

        // Always skip known helper/background endpoints (for all methods)
        foreach (self::ALWAYS_SKIP_CONTAINS as $needle) {
            if (strpos($normalizedPath, $needle) !== false) {
                // Allow POST to static-data/add-specialty (normalized: add_specialty) so we can capture "Create Problem/Observation"
                if ($needle === 'static_data' && $method === 'POST' && strpos($normalizedPath, 'add_specialty') !== false) {
                    return false;
                }
                // Allow POST/PUT to permission settings so updates are logged
                if ($needle === 'permission' && in_array($method, ['POST', 'PUT'])) {
                    return false;
                }
                return true;
            }
        }

        foreach (self::ALLOW_ALWAYS_PATHS as $path) {
            if (strpos($normalizedPath, $path) === 0) {
                return false;
            }
        }

        foreach (self::ALLOW_ALWAYS_CONTAINS as $needle) {
            if (strpos($normalizedPath, $needle) !== false) {
                return false;
            }
        }

        // Deduplicate follow-up reads: /pro/followups/chains is a secondary fetch for treatment chains.
        // Skip the log for chains list-read to avoid duplicate "View Follow Ups" entries.
        if ($normalizedBase === 'followups') {
            if (strpos($normalizedPath, 'followups/chains') !== false && $method === self::METHOD_GET) {
                return true;
            }
        }

        if ($baseRaw === 'config') {
            return true;
        }

        // Auth/session helpers are already covered by dedicated auth listeners.
        $viewPath              = (string) $request->get_header('x-kc-view-path');
        $normalizedContextBase = self::normalizeBaseAlias(self::resolveContextBaseFromViewPath($viewPath));
        // But keep critical account actions like change-password and delete-account.
        if ($baseRaw === 'auth') {
            // Allow logging for change-password/delete-account
            if (preg_match('#(change_password|delete_account)$#', $normalizedPath)) {
                return false;
            }
            // Allow logging for 'user' (profile view) when on specific screens
            if (strpos($normalizedPath, 'auth/user') !== false) {
                if (strpos($viewPath, '/change-password') !== false || strpos($viewPath, '/profile') !== false) {
                    return false;
                }
            }
            return true;
        }


        // Custom Fields/Forms are often fetched as background helpers on many screens (e.g. book appointment).
        // Only log when the user is actually on the settings screen.
        if ($baseRaw === 'custom_forms' || strpos($normalizedPath, 'custom_field') !== false) {
            if ($normalizedContextBase !== 'settings') {
                return true;
            }
        }

        // Data exports (e.g. /prescriptions/export) or explicit export actions should always be logged.
        if (
            preg_match('#/export$#', $normalizedPath) ||
            ($request !== null && $request->get_param('action') === 'export')
        ) {
            return false;
        }

        // Print routes (PDF generation) or explicit print actions should always be logged.
        if (
            preg_match('#/print(-invoice)?$#', $normalizedPath) ||
            ($request !== null && $request->get_param('action') === 'print')
        ) {
            return false;
        }

        if ($method !== self::METHOD_GET) {
            return false;
        }

        // For read actions, keep only primary business modules.
        if (!in_array($normalizedBase, self::ALLOWED_READ_BASES, true)) {
            return true;
        }

        // Config endpoint is a helper fetch used across settings screens (feature flags, UI toggles).
        // Skip it to avoid duplicate "View General Setting" logs when /settings/* and /config fire together.
        if ($method === self::METHOD_GET && $normalizedContextBase === 'settings' && $baseRaw === 'config') {
            return true;
        }

        // When viewing the encounter dashboard, prevent noisy logs for sub-resources
        // until the user actually interacts with their dedicated tabs.
        if ($normalizedContextBase === 'encounters' && $normalizedBase !== 'encounters') {
            if (in_array($normalizedBase, ['billings', 'bills', 'reports', 'prescriptions'])) {
                // Allow only requests targeting a specific resource directly (e.g. bills/107768
                // or billings/107768/print). Suppress list/filter calls like bills/by_encounter/107768.
                $hasResourceInRoute = (bool) preg_match('#^(' . $normalizedBase . '|bills|billings|reports|prescriptions)/\d+#', $normalizedPath);
                return !$hasResourceInRoute;
            }
        }

        // Encounter template dashboard loads several sub-resource requests:
        // GET /encounter-templates/{id}/prescriptions
        // GET /encounter-templates/{id}/medical-history
        // Only log the base template read; skip all nested sub-paths.
        if ($normalizedBase === 'encounter_templates') {
            // Skip sub-resource loads — they all resolve to route encounter-templates/{id}
            // and produce duplicate "View Encounter Template Details" entries.
            if (preg_match('#^encounter_templates/\d+/.+#', $normalizedPath)) {
                return true;
            }
        }

        // Patient profile loads multiple sub-resource requests:
        // GET /patients/{id}/statistics
        // Only log the base profile read; skip nested sub-paths like statistics.
        if ($normalizedBase === 'patients') {
            if (preg_match('#^patients/\d+/statistics$#', $normalizedPath)) {
                return true;
            }
        }

        // For core modules, keep GET logs only when it is a detail view
        // (resource id present) or an explicit list-view request (pagination/search/sort).
        $resourceId = ($request instanceof WP_REST_Request) ? self::resolveResourceId($request) : null;
        if (!empty($resourceId) || !($request instanceof WP_REST_Request)) {
            return false;
        }

        // Dashboard pages can fetch appointment-calendar data via appointments endpoint.
        // Keep one synthetic dashboard read log and suppress obvious background noise.
        if ($normalizedContextBase === 'dashboard') {
            if (!in_array($normalizedBase, self::DASHBOARD_CANDIDATE_BASES, true)) {
                return true;
            }

            if ($normalizedBase === 'appointments') {
                $isCalendarRequest = self::isDashboardCalendarRequest($request);
                if ($isCalendarRequest) {
                    return false;
                }
            }

            // Dashboard loads multiple widget requests (e.g. /dashboard/upcoming_appointments, /dashboard/statistics/...).
            // Keep only one stable dashboard read endpoint to avoid duplicate "View Dashboard" logs.
            if ($normalizedBase === 'dashboard') {
                $isPrimaryDashboardView = $normalizedPath === 'dashboard'
                    || strpos($normalizedPath, 'dashboard/upcoming_appointments') === 0;

                return !$isPrimaryDashboardView;
            }

            // Keep at least one module read on dashboard; burst dedupe will collapse repeats.
            return false;
        }

        // Calendar page primarily uses appointments endpoint with date range/perPage=all.
        if ($normalizedContextBase === 'calendar') {
            if ($normalizedBase === 'calendar') {
                return false;
            }

            if ($normalizedBase === 'appointments') {
                return !self::isDashboardCalendarRequest($request);
            }

            return true;
        }

        // Rating/review endpoints are cross-screen (e.g. Doctor Reviews modal opens from the Doctors list page
        // but calls /rating/list). Let them pass regardless of page context.
        if ($normalizedBase === 'rating' || $normalizedBase === 'ratings') {
            return false;
        }

        // Body Chart is a cross-screen setting (e.g. shown in Encounter dashboard) — always log.
        if ($baseRaw === 'body_chart') {
            return false;
        }

        // Strict mode: for list reads, only keep logs that match the active screen module.
        if (!empty($normalizedContextBase) && $normalizedBase !== $normalizedContextBase) {
            return true;
        }

        // Tax screen can trigger extra helper/detail fetches; keep only main list endpoint.
        // Tax screen can trigger extra helper/detail fetches; keep only main list endpoint.
        if ($normalizedBase === 'taxes') {
            if ($normalizedContextBase !== 'taxes') {
                return true;
            }

            // Keep main list and any detail/action routes (e.g. taxes/13 or taxes/bulk/status).
            // Skip only if the path is something else (like helper lookup).
            return $normalizedPath !== 'taxes' && !preg_match('#^taxes/(\d+|bulk|export|import)#', $normalizedPath);
        }

        if ($normalizedBase === 'webhooks') {
            if ($normalizedContextBase !== 'webhook' && $normalizedContextBase !== 'settings') {
                return true;
            }

            // Skip noisy stats/config routes during page load; keep only main list or detail.
            return $normalizedPath !== 'webhooks' && !preg_match('#^webhooks/(\d+)#', $normalizedPath);
        }

        if ($normalizedBase === 'webhook_logs') {
            if ($normalizedContextBase !== 'webhook' && $normalizedContextBase !== 'settings') {
                return true;
            }

            // Skip noisy stats routes; keep only main list or detail.
            return $normalizedPath !== 'webhook-logs' && !preg_match('#^webhook-logs/(\d+)#', $normalizedPath);
        }



        // Reports tab triggers several chart data calls.
        // Keep only the initial setup request so one clean "View Reports" log is written.
        // Reports tab triggers several chart data calls.
        // Keep only the initial setup request or specific report reads.
        if ($normalizedBase === 'reports') {
            if ($normalizedContextBase !== 'reports') {
                return true;
            }

            return $normalizedPath !== 'reports/initial_data' && !preg_match('#^reports/(\d+|export)#', $normalizedPath);
        }

        // Settings module calls usually don't carry list/search params.
        // Keep only when the active screen is settings.
        if (self::isSettingsModuleBase($normalizedBase)) {
            return $normalizedContextBase !== 'settings';
        }

        // Skip helper lookup calls (typically used for dropdown options on other screens).
        if (self::isLookupRequest($normalizedBase, $request)) {
            return true;
        }

        // Some modules legitimately load list view without explicit query params.
        // Keep these only when screen context already matches.
        if (self::isPlainListModule($normalizedBase)) {
            return false;
        }

        return !self::hasListIntent($request);
    }

    /**
     * Parse common route metadata once and reuse.
     *
     * @param string $route
     * @return array<string,string>
     */
    private static function parseRouteMeta(string $route): array
    {
        $path = str_replace('/kivicare/v1/', '', $route);
        $rawPath = strtolower(str_replace('-', '_', trim((string) $path, '/')));
        $segments = array_values(array_filter(explode('/', $rawPath)));

        $baseRaw = $segments[0] ?? '';
        $base = $baseRaw;
        $baseIndex = 0;

        if (!empty($segments) && $segments[0] === 'pro' && count($segments) > 1) {
            $baseIndex = 1;
            $base = $segments[1];
        }

        // Normalize base segment ASAP so subsequent logic sees the alias-resolved name.
        if (isset($segments[$baseIndex])) {
            $segments[$baseIndex] = self::normalizeBaseAlias($segments[$baseIndex]);
            if ($baseIndex === 1) {
                // If pro, also update the alias-resolved base variable.
                $base = $segments[1];
            }
        }

        // Handle duplicate base segments (e.g. appointments/appointments) or pro/base/base.
        if ($baseIndex === 1 && count($segments) > 2) {
             if ($segments[1] === self::normalizeBaseAlias((string) $segments[2])) {
                 array_splice($segments, 1, 1);
             }
        } elseif (count($segments) > 1) {
             if (self::normalizeBaseAlias((string) $segments[0]) === self::normalizeBaseAlias((string) $segments[1])) {
                 array_shift($segments);
                 $baseIndex = 0; // effectively shifted
             }
        }

        // Extract ID from second segment if numeric (backup for resolveResourceId).
        $resourceId = null;
        if (isset($segments[$baseIndex + 1]) && is_numeric($segments[$baseIndex + 1])) {
            $resourceId = (int) $segments[$baseIndex + 1];
        }

        // Some routes are nested under /patients/* while the real business module is in segment[1].
        if (!empty($segments) && $segments[0] === 'patients' && !empty($segments[1])) {
            $secondBase = self::normalizeBaseAlias((string) $segments[1]);
            if (in_array($secondBase, self::NESTED_PATIENT_MODULES, true)) {
                $segments[0] = (string) $segments[1];
                $base = $segments[0];
            }
        }

        $normalizedPath = implode('/', $segments);

        return [
            'path' => $path,
            'normalized_path' => $normalizedPath,
            'base_raw' => $baseRaw,
            'base' => $base,
            'normalized_base' => self::normalizeBaseAlias($base),
            'id' => $resourceId,
        ];
    }

    /**
     * Check whether request includes explicit list intent params.
     *
     * @param WP_REST_Request $request
     * @return bool
     */
    private static function hasListIntent(WP_REST_Request $request): bool
    {
        foreach (self::LIST_INTENT_KEYS as $key) {
            $value = $request->get_param($key);
            if ($value !== null && $value !== '' && $value !== []) {
                return true;
            }
        }

        return false;
    }

    /**
     * Normalize route bases that represent the same logical module.
     *
     * @param string $base
     * @return string
     */
    private static function normalizeBaseAlias(string $base): string
    {
        return self::BASE_ALIAS_MAP[$base] ?? $base;
    }

    /**
     * Infer the active dashboard module from frontend view path.
     *
     * @param string $viewPath
     * @return string
     */
    private static function resolveContextBaseFromViewPath(string $viewPath): string
    {
        $path = strtolower(trim($viewPath));
        if ($path === '') {
            return '';
        }

        $pathOnly = preg_replace('/[?#].*$/', '', $path);
        $segments = array_values(array_filter(explode('/', trim((string) $pathOnly, '/'))));
        $lastSegment = !empty($segments) ? (string) end($segments) : '';

        // Role dashboard URLs look like "/receptionist/dashboard" and must resolve as dashboard.
        if ($lastSegment === 'dashboard') {
            return 'dashboard';
        }

        // Normalize separators so legacy slugs like "patient-medical-report_id"
        // still map to the correct module context.
        $normalizedPath = str_replace(['-', '_'], '/', $path);

        if (
            strpos($normalizedPath, 'encounter/template') !== false
            || strpos($normalizedPath, 'template') !== false
        ) {
            return 'encounter_templates';
        }
        if (strpos($normalizedPath, 'doctor/session') !== false) {
            return 'doctor_sessions';
        }
        if (strpos($normalizedPath, 'doctor/service') !== false) {
            return 'doctor_services';
        }
        if (strpos($normalizedPath, 'appointment') !== false) {
            return 'appointments';
        }
        if (strpos($normalizedPath, 'body/chart') !== false) {
            // Encounter dashboard body chart tab: /encounter/dashboard/{id}/body-chart
            // should resolve as encounters context, not settings.
            if (strpos($normalizedPath, 'encounter') !== false) {
                return 'encounters';
            }
            return 'settings';
        }
        if (strpos($normalizedPath, 'encounter') !== false) {
            return 'encounters';
        }
        if (strpos($normalizedPath, 'billing') !== false || strpos($normalizedPath, 'bill') !== false) {
            return 'billings';
        }
        if (strpos($normalizedPath, 'report') !== false) {
            return 'reports';
        }
        if (strpos($normalizedPath, 'prescription') !== false) {
            return 'prescriptions';
        }

        // Use declared map order so module routes like "/patient" win over
        // role dashboard slug fragments like "...-dashboard/...".
        foreach (self::CONTEXT_PATH_MAP as $needle => $base) {
            if (strpos($path, $needle) !== false) {
                return $base;
            }
        }

        return '';
    }

    /**
     * Settings-related route families that are allowed only on settings screens.
     *
     * @param string $base
     * @return bool
     */
    private static function isSettingsModuleBase(string $base): bool
    {
        return in_array($base, self::SETTINGS_BASES, true);
    }

    /**
     * Modules where list page fetch may not include page/search/sort params.
     *
     * @param string $base
     * @return bool
     */
    private static function isPlainListModule(string $base): bool
    {
        return in_array($base, self::PLAIN_LIST_BASES, true);
    }

    /**
     * Detect helper/lookup fetches used to populate select options.
     *
     * @param string $base
     * @param WP_REST_Request $request
     * @return bool
     */
    private static function isLookupRequest(string $base, WP_REST_Request $request): bool
    {
        if (!in_array($base, self::LOOKUP_BASES, true)) {
            return false;
        }

        $perPageRaw = self::getFirstStringParam($request, ['per_page', 'perPage']);
        $perPage = is_numeric($perPageRaw) ? (int) $perPageRaw : 0;

        $search = self::getFirstStringParam($request, ['search']);
        $orderby = self::getFirstStringParam($request, ['orderby']);
        $order = self::getFirstStringParam($request, ['order']);
        $sort = self::getFirstStringParam($request, ['sort']);

        // Common lookup signature in UI: large page-size, no search/sort.
        return $perPage >= 100
            && $search === ''
            && $orderby === ''
            && $order === ''
            && $sort === '';
    }

    /**
     * Detect appointments request used by dashboard calendar widget.
     *
     * @param WP_REST_Request $request
     * @return bool
     */
    private static function isDashboardCalendarRequest(WP_REST_Request $request): bool
    {
        $perPage = self::getFirstStringParam($request, ['perPage', 'per_page']);
        $dateFrom = self::getFirstStringParam($request, ['date_from', 'startDate']);
        $dateTo = self::getFirstStringParam($request, ['date_to', 'endDate']);

        return strtolower($perPage) === 'all' || ($dateFrom !== '' && $dateTo !== '');
    }

    /**
     * Resolve a stable settings screen key from the dashboard view path.
     *
     * @param string $viewPath
     * @return string
     */
    private static function resolveSettingsScreenKeyFromViewPath(string $viewPath): string
    {
        $path = strtolower(trim($viewPath));
        if ($path === '') {
            return '';
        }

        foreach (self::SETTINGS_SCREEN_MAP as $needle => $key) {
            if (strpos($path, $needle) !== false) {
                return $key;
            }
        }

        return '';
    }

    /**
     * Infer the settings screen key from the REST route when view path is unknown.
     * Useful for redirect callbacks (e.g. Google Meet OAuth).
     *
     * @param string $route
     * @return string
     */
    private static function resolveSettingsScreenKeyFromRoute(string $route): string
    {
        $route = strtolower(trim($route, '/'));
        
        // Remove known prefix to better match slugs
        if (strpos($route, self::ROUTE_PREFIX) === 0) {
            $route = substr($route, strlen(self::ROUTE_PREFIX));
        }

        foreach (self::SETTINGS_SCREEN_MAP as $needle => $key) {
            if (strpos($route, $needle) !== false) {
                return $key;
            }
        }

        return '';
    }

    /**
     * Normalize noisy internal routes that should not be logged.
     *
     * @param string $route
     * @return bool
     */
    private static function isInternalAuditRoute(string $route, WP_REST_Request $request): bool
    {
        if (strpos($route, '/gdpr/audit') === false) {
            return false;
        }

        // Allow logging if it is an explicit export action.
        return $request->get_param('action') !== 'export';
    }

    private static function resolveEventAction(string $method, array $routeMeta = [], ?WP_REST_Request $request = null): array
    {
        $normalizedPath = $routeMeta['normalized_path'] ?? '';

        // Google Meet connection specific actions
        if (strpos($normalizedPath, 'googlemeet/callback') !== false || strpos($normalizedPath, 'googlemeet/authorize') !== false) {
            return ['data_modify', 'connect'];
        }
        if (strpos($normalizedPath, 'googlemeet/disconnect') !== false) {
            return ['data_modify', 'disconnect'];
        }

        // Google Calendar connection specific actions
        if (strpos($normalizedPath, 'google_calendar_integration/callback') !== false || strpos($normalizedPath, 'google_calendar_integration/connect') !== false) {
            return ['data_modify', 'connect'];
        }
        if (strpos($normalizedPath, 'google_calendar_integration/disconnect') !== false) {
            return ['data_modify', 'disconnect'];
        }

        if ($method === 'POST') {
            if (isset($routeMeta['base_raw']) && $routeMeta['base_raw'] === 'import') {
                return ['data_create', 'import'];
            }
            if (isset($routeMeta['normalized_path']) && preg_match('#/(email|send-email|send_email|resend-credentials|resend_credentials)$#', $routeMeta['normalized_path'])) {
                return ['data_export', 'share'];
            }
            // POST body-chart/delete or body-chart/bulk-delete = delete
            if (isset($routeMeta['base_raw']) && $routeMeta['base_raw'] === 'body_chart'
                && isset($routeMeta['path']) && preg_match('#/bulk.delete|/delete$#i', $routeMeta['path'])
            ) {
                return ['data_delete', 'delete'];
            }
            // POST body-chart with body_chart_id = update existing chart
            if (
                $request !== null
                && isset($routeMeta['base_raw'])
                && $routeMeta['base_raw'] === 'body_chart'
                && !preg_match('#/bulk.delete|/delete$#i', $routeMeta['path'] ?? '')
                && !empty($request->get_param('body_chart_id'))
            ) {
                return ['data_modify', 'update'];
            }
            return ['data_create', 'create'];
        }

        if ($method === 'PUT' || $method === 'PATCH') {
            return ['data_modify', 'update'];
        }

        if ($method === 'DELETE') {
            return ['data_delete', 'delete'];
        }

        if (
            (isset($routeMeta['normalized_path']) && preg_match('#/export$#', $routeMeta['normalized_path']))
            || ($request !== null && $request->get_param('action') === 'export')
        ) {
            return ['data_export', 'export'];
        }

        // Print/invoice download routes — classify as export so they bypass the read-dedup window
        // and always produce a log entry (shouldSkipBurstDuplicate only deduplicates data_access/read).
        if (isset($routeMeta['normalized_path']) && preg_match('#/print(_invoice)?$|/print-invoice$#', $routeMeta['normalized_path'])) {
            return ['data_export', 'print'];
        }

        return ['data_access', 'read'];
    }

    /**
     * Build a normalized route string used for audit dedupe.
     *
     * @param string $route
     * @param string $method
     * @param string $viewPath
     * @param array<string,string> $routeMeta
     * @param string $normalizedContextBase
     * @return string
     */
    private static function resolveRouteForLog(
        string $route,
        string $method,
        string $viewPath,
        array $routeMeta,
        string $normalizedContextBase
    ): string {
        if ($method !== self::METHOD_GET) {
            return $route;
        }

        // Collapse dashboard-page GET calls into one dashboard-view audit event.
        if ($normalizedContextBase === 'dashboard') {
            return self::ROUTE_PREFIX . 'dashboard';
        }

        // Collapse encounter template dashboard GET calls into one template-view audit event.
        if ($normalizedContextBase === 'encounter_templates' && $routeMeta['normalized_base'] === 'encounter_templates') {
            if (preg_match('#^encounter_templates/(\d+)#', $routeMeta['normalized_path'], $matches)) {
                return self::ROUTE_PREFIX . 'encounter-templates/' . $matches[1];
            }
        }

        // Calendar page reads are usually served by appointments endpoint.
        // Normalize them as one calendar-view event.
        if (
            $normalizedContextBase === 'calendar'
            && in_array($routeMeta['normalized_base'], ['calendar', 'appointments'], true)
        ) {
            return self::ROUTE_PREFIX . 'calendar';
        }

        // Collapse settings-page GET calls into one screen-specific route
        // so helper/background calls dedupe cleanly.
        if ($normalizedContextBase !== 'settings') {
            return $route;
        }

        $settingsScreenKey = self::resolveSettingsScreenKeyFromViewPath($viewPath);
        if ($settingsScreenKey === '') {
            // Fallback for redirects/callbacks where x-kc-view-path is missing
            $settingsScreenKey = self::resolveSettingsScreenKeyFromRoute($route);
        }

        if ($settingsScreenKey === '') {
            return self::ROUTE_PREFIX . 'settings';
        }

        return self::ROUTE_PREFIX . 'settings/' . $settingsScreenKey;
    }

    /**
     * Get first non-empty request param as a trimmed string.
     *
     * @param WP_REST_Request $request
     * @param array<int,string> $keys
     * @return string
     */
    private static function getFirstStringParam(WP_REST_Request $request, array $keys): string
    {
        foreach ($keys as $key) {
            $value = $request->get_param($key);
            if ($value === null || $value === '' || is_array($value) || is_object($value)) {
                continue;
            }

            return trim((string) $value);
        }

        return '';
    }

    /**
     * Infer resource type from KiviCare route.
     *
     * @param string $route
     * @return string
     */
    private static function resolveResourceType(string $route): string
    {
        $routeMeta = self::parseRouteMeta($route);
        $raw = sanitize_text_field($routeMeta['base']);

        // body-chart sub-routes (delete, bulk-delete, email, get, edit) alias base to 'settings'
        // via BASE_ALIAS_MAP, but the real resource type is body_chart.
        if ($routeMeta['base_raw'] === 'body_chart') {
            return 'body_chart';
        }

        if ($raw === 'import') {
            $segments = array_values(array_filter(explode('/', $routeMeta['normalized_path'])));
            if (isset($segments[1])) {
                $raw = sanitize_text_field($segments[1]);
            }
        }

        return self::RESOURCE_TYPE_MAP[$raw] ?? rtrim($raw, 's');
    }

    /**
     * Infer resource ID from common route/request params.
     *
     * @param WP_REST_Request $request
     * @return int|null
     */
    private static function resolveResourceId(WP_REST_Request $request): ?int
    {
        $candidateKeys = [
            'id',
            'appointment_id',
            'patient_id',
            'encounter_id',
            'prescription_id',
            'bill_id',
            'billing_id',
            'tax_id',
            'body_chart_id',
            'chain_id',
            'ids',
        ];
        foreach ($candidateKeys as $key) {
            $value = $request->get_param($key);
            if (!empty($value)) {
                if (is_array($value)) {
                    $firstId = reset($value);
                    if (is_numeric($firstId)) {
                        return (int) $firstId;
                    }
                } elseif (is_numeric($value)) {
                    return (int) $value;
                }
            }
        }

        // Fallback: check if parseRouteMeta already extracted an ID from URL segments.
        $routeMeta = self::parseRouteMeta($request->get_route());
        if (!empty($routeMeta['id'])) {
            return (int) $routeMeta['id'];
        }

        return null;
    }

    /**
     * Extract lightweight setting context for generic /settings reads.
     * This improves action labels (General/Holidays/Configuration/etc)
     * without increasing log volume.
     *
     * @param WP_REST_Request $request
     * @param string $route
     * @return array<string,string>|null
     */
    private static function resolveSettingContext(WP_REST_Request $request, string $route): ?array
    {
        $routeMeta = self::parseRouteMeta($route);
        if ($routeMeta['normalized_base'] !== 'settings') {
            return null;
        }

        $keys = ['module', 'key', 'tab', 'type', 'section', 'screen'];
        $context = [];
        foreach ($keys as $key) {
            $value = $request->get_param($key);
            if ($value !== null && $value !== '' && !is_array($value) && !is_object($value)) {
                $context[$key] = sanitize_text_field((string) $value);
            }
        }

        return empty($context) ? null : $context;
    }

    /**
     * Infer resource ID from a successful REST response payload.
     *
     * @param mixed  $response
     * @param string $resourceType
     * @return int|null
     */
    private static function resolveResourceIdFromResponse($response, string $resourceType): ?int
    {
        if (!is_object($response) || !method_exists($response, 'get_data')) {
            return null;
        }

        $payload = $response->get_data();
        if (!is_array($payload)) {
            return null;
        }

        $data = array_key_exists('data', $payload) ? $payload['data'] : $payload;
        
        // Try direct ID extraction first (most common case)
        if (isset($data['id']) && is_numeric($data['id'])) {
            return (int) $data['id'];
        }
        
        return self::findResourceIdInData($data, $resourceType);
    }

    /**
     * Search response data for a numeric ID using resource-specific keys.
     * Simplified approach: direct key lookup first, then simple recursive search.
     *
     * @param mixed  $data
     * @param string $resourceType
     * @return int|null
     */
    private static function findResourceIdInData($data, string $resourceType): ?int
    {
        $preferredKeys = self::getResponseIdKeys($resourceType);
        
        // Direct lookup in current level
        foreach ($preferredKeys as $key) {
            if (isset($data[$key])) {
                $value = $data[$key];
                if (is_numeric($value)) {
                    return (int) $value;
                }
                // Handle nested arrays like ['appointment_id' => 123]
                if (is_array($value) && !empty($value)) {
                    $first = reset($value);
                    if (is_numeric($first)) {
                        return (int) $first;
                    }
                }
            }
        }
        
        // Simple recursive search for nested structures
        if (is_array($data)) {
            foreach ($data as $item) {
                if (is_array($item) || is_object($item)) {
                    $result = self::findResourceIdInData($item, $resourceType);
                    if ($result !== null) {
                        return $result;
                    }
                }
            }
        } elseif (is_object($data)) {
            foreach ((array) $data as $value) {
                if (is_array($value) || is_object($value)) {
                    $result = self::findResourceIdInData($value, $resourceType);
                    if ($result !== null) {
                        return $result;
                    }
                }
            }
        }

        return null;
    }

    /**
     * Response ID key map by resource type.
     *
     * @param string $resourceType
     * @return array<int,string>
     */
    private static function getResponseIdKeys(string $resourceType): array
    {
        $map = [
            'appointment' => ['appointment_id', 'appointmentId'],
            'patient' => ['patient_id', 'patientId', 'user_id', 'userId'],
            'doctor' => ['doctor_id', 'doctorId', 'user_id', 'userId'],
            'receptionist' => ['receptionist_id', 'receptionistId', 'user_id', 'userId'],
            'clinic' => ['clinic_id', 'clinicId'],
            'encounter' => ['encounter_id', 'encounterId'],
            'encounter_template' => ['encounter_template_id', 'encounterTemplateId'],
            'prescription' => ['prescription_id', 'prescriptionId'],
            'bill' => ['bill_id', 'billId', 'billing_id', 'billingId'],
            'tax' => ['tax_id', 'taxId', 'ids', 'tax_ids'],
            'service' => ['service_id', 'serviceId'],
            'custom_form' => ['custom_form_id', 'customFormId', 'form_id', 'formId'],
            'body_chart' => ['body_chart_id', 'bodyChartId'],
            'webhook' => ['webhook_id', 'webhookId'],
            'webhook_event_log' => ['webhook_log_id', 'webhookLogId', 'event_id'],
            'notification_template' => ['notification_template_id', 'notificationTemplateId'],
            'gdpr_setting' => ['gdpr_setting_id', 'setting_id', 'settingId'],
            'gdpr_audit_setting' => ['gdpr_audit_setting_id', 'setting_id', 'settingId'],
            'gdpr_activity_setting' => ['gdpr_activity_setting_id', 'setting_id', 'settingId'],
            'gdpr_consent' => ['gdpr_consent_id', 'consent_id', 'consentId'],
            'holiday' => ['holiday_id', 'holidayId'],
            'review' => ['rating_id', 'review_id'],
            'followup' => ['followup_id', 'followupId'],
            'configuration' => ['config_id', 'configId'],
            'setting' => ['setting_id', 'settingId'],
        ];

        $keys = $map[$resourceType] ?? [];
        $keys[] = 'id';
        return $keys;
    }
}

