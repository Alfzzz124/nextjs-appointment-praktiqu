<?php

namespace KCProApp\controllers\filters;

use App\baseClasses\KCErrorLogger;
use KCProApp\models\KCServiceSession;
use App\models\KCServiceDoctorMapping;
use Illuminate\Support\Collection;

defined('ABSPATH') or die('Something went wrong');

/**
 * Class KCProServiceControllerFilters
 *
 * Hooks into the free plugin's service create / update / delete actions
 * to persist service-based timeslot sessions in kc_service_sessions.
 *
 * Actions handled:
 *   kc_service_add($mapping_ids[], $session_days[], $service_data[])   — fired after service CREATE
 *   kc_service_update($mapping_id, $session_days[], $service_data[])    — fired after service UPDATE
 *   kc_service_delete($mapping_id)                     — fired after service DELETE
 */
class KCProServiceControllerFilters
{
    private static ?self $instance = null;

    public static function get_instance(): self
    {
        if (self::$instance === null) {
            self::$instance = new self();
        }
        return self::$instance;
    }

    private function __construct()
    {
        add_action('kc_service_add',   [$this, 'onServiceCreate'], 10, 3);
        add_action('kc_service_update', [$this, 'onServiceUpdate'], 10, 3);
        add_action('kc_service_delete', [$this, 'onServiceDelete'], 10, 1);
        add_filter('kc_fetch_service_sessions', [$this, 'fetchServiceSessionsFilter'], 10, 4);
    }

    /**
     * Create sessions for all mappings after service creation.
     *
     * @param int[]  $mapping_ids   Newly created kc_service_doctor_mapping IDs
     * @param array  $session_days  Day objects from the frontend form
     * @param array  $service_data  Service data
     */
    public function onServiceCreate(array $mapping_ids, array $session_days, array $service_data): void
    {
        if (empty($session_days)) {
            return;
        }

        // Only process days that are enabled and have valid times
        $enabled_days = array_filter($session_days, fn($d) => !empty($d['enabled']));
        if (empty($enabled_days)) {
            return;
        }

        foreach ($mapping_ids as $mapping_id) {
            $mapping_id = (int) $mapping_id;
            if (!$mapping_id) {
                continue;
            }

            try {
                KCServiceSession::createServiceSessions($mapping_id, $session_days);
            } catch (\Exception $e) {
                KCErrorLogger::instance()->error(
                    "KCProServiceControllerFilters::onServiceCreate failed for mapping {$mapping_id}: " . $e->getMessage()
                );
            }
        }
    }

    /**
     * Update (replace) sessions for a mapping after service update.
     *
     * @param int   $mapping_id   kc_service_doctor_mapping ID
     * @param array $session_days Day objects from the frontend form
     * @param array  $service_data  Service data
     */
    public function onServiceUpdate(int $mapping_id, array $session_days, array $service_data): void
    {
        if (!$mapping_id) {
            return;
        }

        try {
            KCServiceSession::updateServiceSessions($mapping_id, $session_days);
        } catch (\Exception $e) {
            KCErrorLogger::instance()->error(
                "KCProServiceControllerFilters::onServiceUpdate failed for mapping {$mapping_id}: " . $e->getMessage()
            );
        }
    }

    /**
     * Delete all sessions for a mapping after service deletion.
     *
     * @param int $mapping_id kc_service_doctor_mapping ID
     */
    public function onServiceDelete(int $mapping_id): void
    {
        if (!$mapping_id) {
            return;
        }

        try {
            KCServiceSession::deleteByMappingId($mapping_id);
        } catch (\Exception $e) {
            KCErrorLogger::instance()->error(
                "KCProServiceControllerFilters::onServiceDelete failed for mapping {$mapping_id}: " . $e->getMessage()
            );
        }
    }

    /**
     * Filter callback to fetch service sessions
     *
     * @param array $serviceSessions
     * @param int|array $serviceId
     * @param int $doctorId
     * @param int $clinicId
     * @return Collection
     */
    public function fetchServiceSessionsFilter($serviceSessions, $serviceId, int $doctorId, int $clinicId): Collection
    {
        // Ensure $serviceId is an array
        $serviceIds = is_array($serviceId) ? $serviceId : [$serviceId];

        if (!empty($serviceIds)) {
            $serviceSessions = KCServiceSession::query()
                ->whereIn('mappingId', $serviceIds)
                ->get();
        }

        return $serviceSessions->map(fn($session) => $session->toArray());
    }
}
