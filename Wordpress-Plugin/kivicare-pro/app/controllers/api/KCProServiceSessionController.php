<?php

namespace KCProApp\controllers\api;

use App\baseClasses\KCBaseController;
use App\baseClasses\KCErrorLogger;
use App\models\KCServiceDoctorMapping;
use KCProApp\models\KCServiceSession;
use WP_Error;
use WP_REST_Request;
use WP_REST_Response;

defined('ABSPATH') or die('Something went wrong');

/**
 * Class KCProServiceSessionController
 *
 * Manages service-based timeslot sessions (weekly schedule per service mapping).
 *
 * Routes:
 *   GET    /service-sessions?mapping_id=X   — get sessions for a mapping
 *   POST   /service-sessions                — create/update sessions for a mapping
 *   DELETE /service-sessions/{mapping_id}   — delete all sessions for a mapping
 */
class KCProServiceSessionController extends KCBaseController
{
    protected $route = 'service-sessions';

    public function registerRoutes()
    {
        // GET /service-sessions?mapping_id=X
        $this->registerRoute('/' . $this->route, [
            'methods'             => 'GET',
            'callback'            => [$this, 'getSessions'],
            'permission_callback' => [$this, 'checkPermission'],
            'args'                => [
                'mapping_id' => [
                    'description'       => 'Service doctor mapping ID',
                    'type'              => 'integer',
                    'required'          => true,
                    'sanitize_callback' => 'absint',
                ],
            ],
        ]);

        // POST /service-sessions — create or update
        $this->registerRoute('/' . $this->route, [
            'methods'             => 'POST',
            'callback'            => [$this, 'saveSessions'],
            'permission_callback' => [$this, 'checkWritePermission'],
        ]);

        // DELETE /service-sessions/{mapping_id}
        $this->registerRoute('/' . $this->route . '/(?P<mapping_id>\d+)', [
            'methods'             => 'DELETE',
            'callback'            => [$this, 'deleteSessions'],
            'permission_callback' => [$this, 'checkWritePermission'],
            'args'                => [
                'mapping_id' => [
                    'description'       => 'Service doctor mapping ID',
                    'type'              => 'integer',
                    'required'          => true,
                    'sanitize_callback' => 'absint',
                ],
            ],
        ]);
    }

    public function checkPermission($request)
    {
        return $this->checkCapability('read') && $this->checkResourceAccess('service', 'view');
    }

    public function checkWritePermission($request)
    {
        return $this->checkCapability('read') && $this->checkResourceAccess('service', 'edit');
    }

    /**
     * GET /service-sessions?mapping_id=X
     *
     * Returns the weekly session schedule for a service mapping,
     * structured as an array of day objects ready for the frontend form.
     */
    public function getSessions(WP_REST_Request $request): WP_REST_Response
    {
        try {
            $mapping_id = (int) $request->get_param('mapping_id');

            if (!$mapping_id) {
                return $this->response(null, __('mapping_id is required', 'kivicare-pro'), false, 400);
            }

            // Verify the mapping exists and the user can access it
            $mapping = KCServiceDoctorMapping::find($mapping_id);
            if (!$mapping) {
                return $this->response(null, __('Service mapping not found', 'kivicare-pro'), false, 404);
            }

            $days = KCServiceSession::getSessionsByMappingId($mapping_id);

            return $this->response($days, __('Sessions retrieved successfully', 'kivicare-pro'));
        } catch (\Exception $e) {
            KCErrorLogger::instance()->error('KCProServiceSessionController::getSessions Error: ' . $e->getMessage());
            return $this->response(['error' => $e->getMessage()], __('Failed to retrieve sessions', 'kivicare-pro'), false, 500);
        }
    }

    /**
     * POST /service-sessions
     *
     * Body: { mapping_id: int, days: [...] }
     *
     * Creates sessions if none exist for the mapping, otherwise updates (replace all).
     */
    public function saveSessions(WP_REST_Request $request): WP_REST_Response
    {
        try {
            $params     = $request->get_json_params() ?: $request->get_params();
            $mapping_id = (int) ($params['mapping_id'] ?? 0);
            $days       = $params['days'] ?? [];

            if (!$mapping_id) {
                return $this->response(null, __('mapping_id is required', 'kivicare-pro'), false, 400);
            }

            if (empty($days)) {
                return $this->response(null, __('days array is required', 'kivicare-pro'), false, 400);
            }

            // Verify mapping exists
            $mapping = KCServiceDoctorMapping::find($mapping_id);
            if (!$mapping) {
                return $this->response(null, __('Service mapping not found', 'kivicare-pro'), false, 404);
            }

            // Check if sessions already exist — update (replace) or create
            $existing_count = KCServiceSession::query()->where('mappingId', $mapping_id)->count();

            if ($existing_count > 0) {
                $inserted = KCServiceSession::updateServiceSessions($mapping_id, $days);
                $message  = __('Sessions updated successfully', 'kivicare-pro');
            } else {
                $inserted = KCServiceSession::createServiceSessions($mapping_id, $days);
                $message  = __('Sessions created successfully', 'kivicare-pro');
            }

            return $this->response(
                ['mapping_id' => $mapping_id, 'sessions_count' => count($inserted)],
                $message,
                true,
                200
            );
        } catch (\Exception $e) {
            KCErrorLogger::instance()->error('KCProServiceSessionController::saveSessions Error: ' . $e->getMessage());
            return $this->response(['error' => $e->getMessage()], __('Failed to save sessions', 'kivicare-pro'), false, 500);
        }
    }

    /**
     * DELETE /service-sessions/{mapping_id}
     *
     * Deletes all session rows for the given mapping.
     */
    public function deleteSessions(WP_REST_Request $request): WP_REST_Response
    {
        try {
            $mapping_id = (int) $request->get_param('mapping_id');

            if (!$mapping_id) {
                return $this->response(null, __('mapping_id is required', 'kivicare-pro'), false, 400);
            }

            $deleted = KCServiceSession::deleteByMappingId($mapping_id);

            return $this->response(
                ['mapping_id' => $mapping_id, 'deleted' => $deleted],
                __('Sessions deleted successfully', 'kivicare-pro')
            );
        } catch (\Exception $e) {
            KCErrorLogger::instance()->error('KCProServiceSessionController::deleteSessions Error: ' . $e->getMessage());
            return $this->response(['error' => $e->getMessage()], __('Failed to delete sessions', 'kivicare-pro'), false, 500);
        }
    }

}
