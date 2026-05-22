<?php

namespace KCProApp\services;

use App\models\KCOption;
use KCProApp\models\KCGdprAuditLog;

defined('ABSPATH') or die('Something went wrong');

class KCGdprAuditService
{
    private static $logBuffer = [];
    private static $auditModeCache = null;

    /**
     * Get current audit log mode from saved GDPR audit settings.
     *
     * @return string
     */
    public static function getAuditLogMode(): string
    {
        if (self::$auditModeCache !== null) {
            return self::$auditModeCache;
        }

        $settings = KCOption::get('gdpr_audit_settings', [
            'audit_log_mode' => 'all_events',
        ]);

        $mode = sanitize_text_field($settings['audit_log_mode'] ?? 'all_events');
        $allowed = ['disabled', 'preview', 'significant_events', 'all_events'];
        self::$auditModeCache = in_array($mode, $allowed, true) ? $mode : 'all_events';

        return self::$auditModeCache;
    }

    /**
     * Decide if an event should be written for the configured audit mode.
     *
     * @param string $eventType
     * @return bool
     */
    private static function shouldWriteEventByMode(string $eventType): bool
    {
        $mode = self::getAuditLogMode();

        if ($mode === 'disabled') {
            return false;
        }

        if ($mode === 'all_events') {
            return true;
        }

        $criticalAuthEvents = ['login', 'logout', 'login_failed'];
        if (in_array($eventType, $criticalAuthEvents, true)) {
            return true;
        }

        if ($mode === 'preview') {
            return in_array($eventType, ['data_access', 'data_create', 'data_modify', 'data_delete'], true);
        }

        // significant_events mode: keep meaningful mutations/incidents, skip generic reads
        if ($mode === 'significant_events') {
            return in_array($eventType, ['data_create', 'data_modify', 'data_delete', 'security', 'incident', 'error', 'data_export'], true);
        }

        return true;
    }

    /**
     * Burst de-duplication across close consecutive requests.
     * Prevents duplicated "view" logs for the same entity fired by page-side parallel calls.
     *
     * @param int $actorUserId
     * @param string $eventType
     * @param string|null $resourceType
     * @param int|null $resourceId
     * @param string $action
     * @param array $details
     * @return bool
     */
    private static function shouldSkipBurstDuplicate(
        int $actorUserId,
        string $eventType,
        ?string $resourceType,
        ?int $resourceId,
        string $action,
        array $details = []
    ): bool {
        $isMutation = in_array($eventType, ['data_create', 'data_modify', 'data_delete', 'data_export'], true);

        // Set a silence transient on mutations to absorb immediate post-save page refreshes (like React Query cache invalidations)
        if ($isMutation) {
            if ($actorUserId && $resourceType) {
                $silenceKey = 'kc_gdpr_mutated_' . $actorUserId . '_' . $resourceType;
                set_transient($silenceKey, 1, 30);
            }
            return false;
        }

        // Keep mutations always logged; dedupe only noisy reads.
        if ($eventType !== 'data_access' || strtolower($action) !== 'read') {
            return false;
        }

        // Suppress reads if the user just mutated this resource type recently.
        // Exempt body_chart settings views — navigating to the settings page after a
        // template mutation should still produce a "View Encounter Body Chart Setting" log.
        if ($actorUserId && $resourceType && $resourceType !== 'body_chart') {
            $silenceKey = 'kc_gdpr_mutated_' . $actorUserId . '_' . $resourceType;
            if (get_transient($silenceKey)) {
                return true;
            }
        }

        $route = sanitize_text_field((string) ($details['dedupe_route'] ?? $details['route'] ?? ''));
        $method = sanitize_text_field((string) ($details['method'] ?? ''));
        $resourceIdForDedupe = $resourceId;
        if ($route !== '' && !preg_match('#/\d+($|/)#', $route)) {
            // Synthetic/summary routes (dashboard/calendar/settings) should dedupe
            // even if a widget request carries resource params.
            $resourceIdForDedupe = null;
        }

        $fingerprint = md5(wp_json_encode([
            'actor' => $actorUserId,
            'event' => $eventType,
            'resource_type' => $resourceType,
            'resource_id' => $resourceIdForDedupe,
            'action' => $action,
            'route' => $route,
            'method' => $method,
        ]));

        $transientKey = 'kc_gdpr_audit_dedupe_' . $fingerprint;
        if (get_transient($transientKey)) {
            return true;
        }

        // 15-second deduplication window to absorb immediate background refetches (e.g., React Query window focus)
        // and identical calls from the same UI session, while still allowing explicit re-navigation shortly after.
        set_transient($transientKey, 1, 15);
        return false;
    }

    /**
     * Check if GDPR sampling flag is enabled (e.g. log only 1 in 100 reads to save space).
     * If enabled, we conditionally skip generic data_access writes.
     * 
     * @param string $eventType
     * @return bool
     */
    private static function shouldSampleWrite(string $eventType): bool
    {
        // Future feature: Optional sampling flag settings
        $kivicareSettings = get_option('kivicare_settings', []);
        $gdprSettings = $kivicareSettings['gdpr'] ?? [];
        $samplingRate = (int) ($gdprSettings['audit_sampling_rate'] ?? 100);

        // Only sample read/data_access events. Mutations and logins must always be 100% recorded.
        if ($eventType === 'data_access' && $samplingRate > 0 && $samplingRate < 100) {
            return wp_rand(1, 100) <= $samplingRate;
        }

        return true;
    }

    /**
     * Resolve the real client IP address.
     * Checks common proxy/reverse-proxy headers before falling back to REMOTE_ADDR.
     *
     * @return string
     */
    private static function resolveClientIp(): string
    {
        $ip_keys = [
            'HTTP_CLIENT_IP',
            'HTTP_X_FORWARDED_FOR',
            'HTTP_X_FORWARDED',
            'HTTP_X_CLUSTER_CLIENT_IP',
            'HTTP_FORWARDED_FOR',
            'HTTP_FORWARDED',
            'REMOTE_ADDR',
        ];

        foreach ($ip_keys as $key) {
            // phpcs:ignore WordPress.Security.ValidatedSanitizedInput.InputNotSanitized, WordPress.Security.ValidatedSanitizedInput.MissingUnslash
            if (array_key_exists($key, $_SERVER) === true) {
                // phpcs:ignore WordPress.Security.ValidatedSanitizedInput.InputNotSanitized, WordPress.Security.ValidatedSanitizedInput.MissingUnslash
                foreach (explode(',', $_SERVER[$key]) as $ip) {
                    $ip = trim($ip);
                    if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE) !== false) {
                        return sanitize_text_field($ip);
                    }
                }
            }
        }

        // phpcs:ignore WordPress.Security.ValidatedSanitizedInput.InputNotSanitized, WordPress.Security.ValidatedSanitizedInput.MissingUnslash
        return sanitize_text_field($_SERVER['REMOTE_ADDR'] ?? '0.0.0.0');
    }

    /**
     * Initialize the background job to flush logs
     */
    public static function init()
    {
        // Add action to flush buffer at the end of execution to avoid blocking the main thread
        add_action('shutdown', [self::class, 'commitLogs']);
    }

    /**
     * Central writer for adding a new GDPR audit log entry.
     * Queues items up for batch insert at shutdown. No joins happen here.
     *
     * @param string $eventType Event type (e.g., 'auth', 'data_access')
     * @param int|null $subjectUserId The user being acted upon (if applicable)
     * @param string|null $resourceType The type of resource being accessed/modified
     * @param int|null $resourceId The ID of the resource
     * @param string $action The specific action taken
     * @param array $details Additional context or payload details
     * @return void
     */
    public static function log(
        string $eventType,
        ?int $subjectUserId,
        ?string $resourceType,
        ?int $resourceId,
        string $action,
        array $details = [],
        ?int $actorUserIdOverride = null
    ): void {
        try {
            // 1. Resolve Actor inline natively without any extra DB joins
            $actorUserId = 0;
            $actorRole = 'system';
            
            if (is_user_logged_in()) {
                $currentUser = wp_get_current_user();
                $actorUserId = $currentUser->ID;
                if (!empty($currentUser->roles) && is_array($currentUser->roles)) {
                    $actorRole = $currentUser->roles[0];
                } else {
                    $actorRole = 'user';
                }
            }

            if ($actorUserIdOverride) {
                $actorUserId = (int) $actorUserIdOverride;
                $actorRole = 'user';
                $actorUser = get_user_by('id', $actorUserId);
                if ($actorUser && !empty($actorUser->roles) && is_array($actorUser->roles)) {
                    $actorRole = $actorUser->roles[0];
                }
            }

            // 2. Suppression and Mutated Transient Logic (moved up so it runs even if mode skips logging)
            if (self::shouldSkipBurstDuplicate(
                (int) $actorUserId,
                $eventType,
                $resourceType,
                $resourceId,
                $action,
                $details
            )) {
                return;
            }

            // 3. Filter by Audit Mode & Sampling
            if (!self::shouldWriteEventByMode($eventType)) {
                return;
            }

            if (!self::shouldSampleWrite($eventType)) {
                return;
            }

            // 4. Capture Request Context
            // Resolve real client IP — check proxy-forwarded headers before falling back to REMOTE_ADDR.
            // phpcs:ignore WordPress.Security.ValidatedSanitizedInput.InputNotSanitized, WordPress.Security.ValidatedSanitizedInput.MissingUnslash
            $ipAddress = self::resolveClientIp();
            // phpcs:ignore WordPress.Security.ValidatedSanitizedInput.InputNotSanitized, WordPress.Security.ValidatedSanitizedInput.MissingUnslash
            $userAgent = $_SERVER['HTTP_USER_AGENT'] ?? '';
            // phpcs:ignore WordPress.Security.ValidatedSanitizedInput.InputNotSanitized, WordPress.Security.ValidatedSanitizedInput.MissingUnslash
            $requestUri = $_SERVER['REQUEST_URI'] ?? '';

            $ipAddress = sanitize_text_field($ipAddress);
            $userAgent = sanitize_textarea_field($userAgent);
            $requestUri = esc_url_raw($requestUri);
            
            $createdAt = gmdate('Y-m-d H:i:s');
            $jsonDetails = empty($details) ? null : wp_json_encode($details);

            // 3. Queue to Buffer
            self::$logBuffer[] = [
                'event_type' => $eventType,
                'actor_user_id' => $actorUserId,
                'actor_role' => $actorRole,
                'subject_user_id' => $subjectUserId,
                'resource_type' => $resourceType,
                'resource_id' => $resourceId,
                'action' => $action,
                'details' => $jsonDetails,
                'ip_address' => $ipAddress,
                'user_agent' => $userAgent,
                'request_uri' => $requestUri,
                'created_at' => $createdAt,
            ];

        } catch (\Throwable $e) {
            error_log('KiviCare GDPR Audit Log Error: ' . $e->getMessage() . ' in ' . $e->getFile() . ':' . $e->getLine());
        }
    }

    /**
     * Batch commit logs to the database during shutdown phase.
     * Calculates checksums safely in a unified pass without locking earlier execution.
     */
    public static function commitLogs()
    {
        if (empty(self::$logBuffer)) {
            return;
        }

        try {
            $lastRow = KCGdprAuditLog::query()->orderBy('id', 'desc')->first();
            $previousChecksum = $lastRow && !empty($lastRow->checksum) ? $lastRow->checksum : 'GENESIS';
            
            // --- BUFFER DEDUPLICATION ---
            // Even though shouldSkipBurstDuplicate() tries to stop duplicates, race conditions
            // (e.g. simultaneous React queries) can bypass transients. We deduplicate the batch itself here.
            $unique = [];
            foreach (self::$logBuffer as $entry) {
                // To identify "identical" simultaneous requests, we check core fields.
                // We parse the route/method out of details.
                $detailsArr = json_decode($entry['details'] ?? '{}', true) ?: [];
                $route = $detailsArr['route'] ?? '';
                $method = $detailsArr['method'] ?? '';

                $fingerprint = md5(implode('|', [
                    $entry['actor_user_id'],
                    $entry['event_type'],
                    $entry['resource_type'],
                    $entry['resource_id'] ?? '',
                    $entry['action'],
                    $route,
                    $method,
                ]));

                // Only keep the first occurrence of this explicit combination within this shutdown buffer.
                if (!isset($unique[$fingerprint])) {
                    $unique[$fingerprint] = $entry;
                }
            }

            $batchInsertData = [];

            foreach ($unique as $logEntry) {
                // Construct payload strictly matching the requirement:
                // payload = previous_checksum + eventType + actor_user_id + subjectUserId + resourceType + resourceId + action + json_encode(details) + timestamp
                $payload = $previousChecksum . 
                           $logEntry['event_type'] . 
                           $logEntry['actor_user_id'] . 
                           ($logEntry['subject_user_id'] ?? '') . 
                           ($logEntry['resource_type'] ?? '') . 
                           ($logEntry['resource_id'] ?? '') . 
                           $logEntry['action'] . 
                           ($logEntry['details'] ?? '') . 
                           $logEntry['created_at'];

                $checksum = hash('sha256', $payload); // lowercase hex
                $logEntry['checksum'] = $checksum;
                $previousChecksum = $checksum;

                $batchInsertData[] = $logEntry;
            }

            // Execute Batch Insert Eloquent Native Method
            // No loops wrapping separate queries. We insert chunked mapping strictly.
            KCGdprAuditLog::query()->insert($batchInsertData);

            // Reset Buffer
            self::$logBuffer = [];

        } catch (\Throwable $e) {
            error_log('KiviCare GDPR Batch Insert Error: ' . $e->getMessage());
        }
    }
}
