<?php

namespace KCProApp\listeners;

use KCProApp\services\KCGdprAuditService;

defined('ABSPATH') or die('Something went wrong');

class KCGdprMutationListener
{
    /**
     * Maps action hook name fragments to their GDPR resource type.
     * Checked in declaration order via strpos; first match wins.
     */
    private const HOOK_RESOURCE_MAP = [
        'patient'      => 'patient',
        'encounter'    => 'encounter',
        'appointment'  => 'appointment',
        'prescription' => 'prescription',
    ];

    public static function logCreate($id, $data = null)
    {
        self::logMutation('data_create', 'create', $id, $data);
    }

    public static function logUpdate($id, $data = null)
    {
        self::logMutation('data_modify', 'update', $id, $data);
    }

    public static function logDelete($id, $data = null)
    {
        self::logMutation('data_delete', 'delete', $id, $data);
    }

    private static function logMutation(string $eventType, string $action, $id, $data = null)
    {
        try {
            error_log('[GDPR Activity Log] Step 4: KCGdprMutationListener::logMutation - Processing mutation event: ' . $eventType);
            $currentFilter = current_action();
            $resourceType  = self::resolveResourceType($currentFilter, $data);
            error_log('[GDPR Activity Log] Step 4.1: KCGdprMutationListener::logMutation - Resource type: ' . $resourceType . ', Hook: ' . $currentFilter);

            $subjectUserId = null;
            if ($resourceType === 'patient') {
                $subjectUserId = (int) $id;
            } elseif (isset($data['patient_id'])) {
                $subjectUserId = (int) $data['patient_id'];
            } elseif (isset($data['patientId'])) {
                $subjectUserId = (int) $data['patientId'];
            }

            // Strip sensitive keys to prevent large / PII payloads in JSON details.
            $details = [];
            if (is_array($data)) {
                $details = array_filter($data, static function ($key) {
                    return !in_array($key, ['password', 'secret', 'user_pass', 'token'], true);
                }, ARRAY_FILTER_USE_KEY);
            }

            $details['action_hook'] = $currentFilter;

            error_log('[GDPR Activity Log] Step 4.2: KCGdprMutationListener::logMutation - Calling KCGdprAuditService::log');
            KCGdprAuditService::log(
                $eventType,
                $subjectUserId,
                $resourceType,
                (int) $id,
                $action,
                $details
            );
            error_log('[GDPR Activity Log] Step 4.2: KCGdprMutationListener::logMutation - KCGdprAuditService::log completed');

        } catch (\Throwable $e) {
            error_log('GDPR Mutation Listener Error: ' . $e->getMessage());
        }
    }

    private static function resolveResourceType(string $hookName, $data = null): string
    {
        if (strpos($hookName, 'user_register') !== false) {
            $role = (string) ($data['user_role'] ?? '');
            if (strpos($role, 'doctor') !== false) {
                return 'doctor';
            }
            if (strpos($role, 'receptionist') !== false) {
                return 'receptionist';
            }
            return 'patient';
        }

        foreach (self::HOOK_RESOURCE_MAP as $fragment => $resourceType) {
            if (strpos($hookName, $fragment) !== false) {
                return $resourceType;
            }
        }

        return 'unknown';
    }
}
