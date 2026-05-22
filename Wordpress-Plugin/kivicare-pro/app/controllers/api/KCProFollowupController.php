<?php

namespace KCProApp\controllers\api;

use App\baseClasses\KCBaseController;
use App\models\KCClinic;
use App\models\KCDoctor;
use App\models\KCPatient;
use App\models\KCPatientEncounter;
use KCProApp\services\KCProFollowupService;
use KCProApp\baseClasses\KCProFollowupSettings;
use KCProApp\models\KCProFollowup;
use KCProApp\models\KCProFollowupChain;
use KCProApp\models\KCProFollowupActivityLog;
use KCProApp\models\KCProFollowupReminder;
use KCProApp\baseClasses\KCProStateTransitionValidator;
use KCProApp\services\KCProReminderService;
use WP_REST_Request;
use WP_REST_Response;

defined('ABSPATH') or die('Something went wrong');

class KCProFollowupController extends KCBaseController
{
    protected $route = 'pro/followups';

    public function registerRoutes()
    {
        // 1. Create Follow-up
        $this->registerRoute('/' . $this->route, [
            'methods' => 'POST',
            'callback' => [$this, 'createFollowup'],
            'permission_callback' => [$this, 'checkCreatePermission'],
            'args' => $this->getCreateArgs()
        ]);

        // 2. List Follow-ups
        $this->registerRoute('/' . $this->route, [
            'methods' => 'GET',
            'callback' => [$this, 'getFollowups'],
            'permission_callback' => [$this, 'checkListPermission'],
        ]);

        // 3. Get Single Follow-up
        $this->registerRoute('/' . $this->route . '/(?P<id>[\d]+)', [
            'methods' => 'GET',
            'callback' => [$this, 'getFollowup'],
            'permission_callback' => [$this, 'checkViewPermission'],
        ]);

        // 4. Update Status
        $this->registerRoute('/' . $this->route . '/(?P<id>[\d]+)/status', [
            'methods' => 'PUT',
            'callback' => [$this, 'updateStatus'],
            'permission_callback' => [$this, 'checkUpdatePermission'],
            'args' => [
                'status' => [
                    'required' => true,
                    'type' => 'string',
                    'enum' => ['pending', 'scheduled', 'completed', 'cancelled']
                ]
            ]
        ]);

        // 5. Link Appointment (Schedule)
        $this->registerRoute('/' . $this->route . '/(?P<id>[\d]+)/schedule', [
            'methods' => 'POST',
            'callback' => [$this, 'scheduleFollowup'],
            'permission_callback' => [$this, 'checkSchedulePermission'],
            'args' => [
                'appointment_id' => [
                    'required' => true,
                    'type' => 'integer',
                    'sanitize_callback' => 'absint'
                ]
            ]
        ]);

        // 6. Delete Follow-up
        $this->registerRoute('/' . $this->route . '/(?P<id>[\d]+)', [
            'methods' => 'DELETE',
            'callback' => [$this, 'deleteFollowup'],
            'permission_callback' => [$this, 'checkDeletePermission'],
        ]);
        
        // 7. Bulk Delete Follow-ups
        $this->registerRoute('/' . $this->route . '/bulk/delete', [
            'methods' => 'POST',
            'callback' => [$this, 'bulkDeleteFollowups'],
            'permission_callback' => [$this, 'checkDeletePermission'],
            'args' => [
                'ids' => [
                    'required' => true,
                    'type' => 'array',
                    'items' => [
                        'type' => 'integer'
                    ],
                    'sanitize_callback' => function ($param) {
                        if (!is_array($param)) return [];
                        return array_map('absint', $param);
                    }
                ]
            ]
        ]);

        // 8. Bulk Update Status
        $this->registerRoute('/' . $this->route . '/bulk/status', [
            'methods' => 'POST',
            'callback' => [$this, 'bulkUpdateStatus'],
            'permission_callback' => [$this, 'checkUpdatePermission'],
            'args' => [
                'ids' => [
                    'required' => true,
                    'type' => 'array',
                    'items' => ['type' => 'integer'],
                    'sanitize_callback' => function ($param) {
                        return is_array($param) ? array_map('absint', $param) : [];
                    }
                ],
                'status' => [
                    'required' => true,
                    'type' => 'string',
                    'enum' => ['pending', 'scheduled', 'completed', 'cancelled']
                ]
            ]
        ]);

        // 9. List Follow-up Chains
        $this->registerRoute('/' . $this->route . '/chains', [
            'methods' => 'GET',
            'callback' => [$this, 'getChains'],
            'permission_callback' => [$this, 'checkListPermission'],
        ]);

        // 8. Chain Status Control (PATCH)
        $this->registerRoute('/' . $this->route . '/chains/(?P<id>[\d]+)/close', [
            'methods' => ['POST', 'PATCH'],
            'callback' => [$this, 'closeChain'],
            'permission_callback' => [$this, 'checkChainOperationalPermission'],
            'args' => [
                'reason' => [
                    'required' => true,
                    'type' => 'string',
                    'sanitize_callback' => 'sanitize_textarea_field'
                ]
            ]
        ]);

        $this->registerRoute('/' . $this->route . '/chains/(?P<id>[\d]+)/reopen', [
            'methods' => 'PATCH',
            'callback' => [$this, 'reopenChain'],
            'permission_callback' => [$this, 'checkChainOperationalPermission'],
            'args' => [
                'reason' => [
                    'required' => true,
                    'type' => 'string',
                    'sanitize_callback' => 'sanitize_textarea_field'
                ]
            ]
        ]);

        $this->registerRoute('/' . $this->route . '/chains/(?P<id>[\d]+)/on-hold', [
            'methods' => 'PATCH',
            'callback' => [$this, 'onHoldChain'],
            'permission_callback' => [$this, 'checkChainOperationalPermission'],
            'args' => [
                'reason' => [
                    'required' => false,
                    'type' => 'string',
                    'sanitize_callback' => 'sanitize_textarea_field'
                ]
            ]
        ]);

        // 9. Get Chain Followups
        $this->registerRoute('/' . $this->route . '/chains/(?P<chain_id>[\d]+)/followups', [
            'methods' => 'GET',
            'callback' => [$this, 'getChainFollowups'],
            'permission_callback' => [$this, 'checkListPermission'],
        ]);

        // 10. Reminders
        $this->registerRoute('/' . $this->route . '/(?P<id>[\d]+)/reminders', [
            'methods' => 'POST',
            'callback' => [$this, 'addReminder'],
            'permission_callback' => [$this, 'checkUpdatePermission'],
            'args' => [
                'reminder_type' => ['required' => true, 'type' => 'string', 'sanitize_callback' => 'sanitize_text_field'],
                'offset_days' => ['required' => true, 'type' => 'integer', 'sanitize_callback' => 'intval'],
                'channel' => ['required' => false, 'type' => 'string', 'enum' => ['sms', 'email', 'push'], 'default' => 'email']
            ]
        ]);

        $this->registerRoute('/' . $this->route . '/(?P<id>[\d]+)/reminders/(?P<reminder_type>[a-zA-Z0-9_\-]+)', [
            'methods' => 'DELETE',
            'callback' => [$this, 'removeReminder'],
            'permission_callback' => [$this, 'checkUpdatePermission'],
        ]);

        // 11. Chain Summary
        $this->registerRoute('/' . $this->route . '/chains/(?P<id>[\d]+)/summary', [
            'methods' => 'GET',
            'callback' => [$this, 'getChainSummary'],
            'permission_callback' => [$this, 'checkListPermission'],
        ]);
    }

    public function checkDeletePermission($request): bool
    {
        if (!KCProFollowupSettings::isFollowupEnabled()) {
            return false;
        }
        return $this->checkCapability('followup_delete');
    }

    public function checkListPermission($request): bool
    {
        if (!KCProFollowupSettings::isFollowupEnabled()) {
            return false;
        }
        return $this->checkCapability('followup_list');
    }

    public function checkViewPermission($request): bool
    {
        if (!KCProFollowupSettings::isFollowupEnabled()) {
            return false;
        }
        return $this->checkCapability('followup_view');
    }

    public function checkCreatePermission($request): bool
    {
        if (!KCProFollowupSettings::isFollowupEnabled()) {
            return false;
        }
        return $this->checkCapability('followup_add');
    }

    public function checkChainClinicalPermission($request): bool
    {
        if (!KCProFollowupSettings::isChainsEnabled()) {
            return false;
        }
        return $this->checkCapability('followup_edit_clinical') || $this->checkCapability('chain_admin_override');
    }

    /**
     * Chain operational permission (close / reopen / on-hold).
     * Respects both the global chains enable toggle AND the
     * management_permission minimum role setting.
     */
    public function checkChainOperationalPermission($request): bool
    {
        if (!KCProFollowupSettings::isChainsEnabled()) {
            return false;
        }
        return KCProFollowupSettings::currentUserHasManagementPermission();
    }

    public function checkUpdatePermission($request): bool
    {
        return KCProFollowupSettings::isFollowupEnabled();
    }

    /**
     * Schedule permission respects the global receptionist_can_schedule setting.
     */
    public function checkSchedulePermission($request): bool
    {
        if (!KCProFollowupSettings::isFollowupEnabled()) {
            return false;
        }
        if (!KCProFollowupSettings::receptionistCanSchedule()) {
            $role = $this->kcbase->getLoginUserRole();
            if ($role === 'receptionist') {
                return false;
            }
        }
        return $this->checkCapability('followup_schedule');
    }

    protected function getCreateArgs(): array
    {
        return [
            'clinic_id' => [
                'required' => true,
                'type' => 'integer',
                'sanitize_callback' => 'absint'
            ],
            'doctor_id' => [
                'required' => true,
                'type' => 'integer',
                'sanitize_callback' => 'absint'
            ],
            'patient_id' => [
                'required' => true,
                'type' => 'integer',
                'sanitize_callback' => 'absint'
            ],
            'encounter_id' => [
                'required' => false,
                'type' => 'integer',
                'sanitize_callback' => 'absint'
            ],
            'chain_id' => [
                'required' => false,
                'type' => 'integer',
                'sanitize_callback' => 'absint'
            ],
            'parent_followup_id' => [
                'required' => false,
                'type' => 'integer',
                'sanitize_callback' => 'absint'
            ],
            'reason' => [
                'required' => true,
                'type' => 'string',
                'sanitize_callback' => 'sanitize_textarea_field'
            ],
            'priority' => [
                'required' => false,
                'type' => 'string',
                'enum' => ['routine', 'important', 'urgent'],
                'default' => 'routine',
            ],
            'timeframe_or_date' => [
                'required' => true,
                'type' => 'string',
                'sanitize_callback' => 'sanitize_text_field'
            ],
            'decision' => [
                'required' => false,
                'type' => 'boolean',
                'sanitize_callback' => 'rest_sanitize_boolean'
            ],
            'service_id' => [
                'required' => false,
                'type' => 'array',
                'items' => [
                    'type' => 'integer'
                ],
                'sanitize_callback' => function ($param) {
                    if (!is_array($param)) return [];
                    return array_map('absint', $param);
                }
            ],
            'force_new_chain' => [
                'required' => false,
                'type' => 'boolean',
                'sanitize_callback' => 'rest_sanitize_boolean'
            ],
            'chain_name' => [
                'required' => false,
                'type' => 'string',
                'sanitize_callback' => 'sanitize_text_field'
            ]
        ];
    }

    public function createFollowup(WP_REST_Request $request): WP_REST_Response
    {
        try {
            $data = $request->get_params();
            
            // RBAC Enforcement (Doctor vs Receptionist creating followups)
            if (!$this->checkCapability('followup_create_clinical')) {
                // If not a doctor, they cannot set a custom clinical reason or priority ad-hoc.
                // Priority defaults to normal, reason defaults to generalized or inherited note.
                $data['priority'] = 'routine'; // Changed from 'normal' to 'routine' to match enum
                
                if (empty($data['reason'])) {
                    $data['reason'] = 'General Follow-up scheduled by Reception';
                }
                
                // Receptionist cannot explicitly start brand new unlinked chains.
                if (empty($data['chain_id']) && empty($data['appointment_id'])) {
                     return $this->response([
                         'status' => false,
                         'message' => 'Operational staff cannot start new unlinked clinical chains. A doctor must initiate or an appointment must be provided.'
                     ], 403);
                }
            }

            $followupService = KCProFollowupService::get_instance();
            $followup = $followupService->createFollowup($data);

            return $this->response([
                'status' => true,
                'message' => __('Follow-up created successfully', 'kivicare-pro'),
                'data' => $followup->toArray()
            ], 200);

        } catch (\Exception $e) {
            return $this->response([
                'status' => false,
                'message' => $e->getMessage()
            ], 400);
        }
    }

    public function getFollowups(WP_REST_Request $request): WP_REST_Response
    {
        try {
            $clinic_id = $request->get_param('clinic_id');
            $status = $request->get_param('status');
            $doctor_id = $request->get_param('doctor_id');
            $patient_id = $request->get_param('patient_id');
            $encounter_id = $request->get_param('encounter_id');
            $time_frame = $request->get_param('time_frame'); // upcoming, past
            $search = $request->get_param('search');
            $date_from = $request->get_param('date_from');
            $date_to = $request->get_param('date_to');

            $query = KCProFollowup::table('f')
            ->select([
                'f.*',
                'p.display_name as patient_name',
                'd.display_name as doctor_name',
                'c.name as clinic_name',
                'fc.name as chain_name',
                'fc.status as chain_status',
                'pe.id as fulfilled_encounter_id',
                'pe.encounter_date as fulfilled_encounter_date'
            ])
            ->leftJoin(KCPatient::class, 'f.patient_id', '=', 'p.id', 'p')
            ->leftJoin(KCDoctor::class, 'f.doctor_id', '=', 'd.id', 'd')
            ->leftJoin(KCClinic::class, 'f.clinic_id', '=', 'c.id', 'c')
            ->leftJoin(KCProFollowupChain::class, 'f.chain_id', '=', 'fc.id', 'fc')
            ->leftJoin(KCPatientEncounter::class, 'f.scheduled_appointment_id', '=', 'pe.appointment_id', 'pe');

            // Exclude anonymized/deleted patients
            $query->where('p.user_email', 'NOT LIKE', '%@example.invalid')
                  ->where('p.display_name', 'NOT LIKE', 'deleted_user_%');

            if ($clinic_id) {
                $query->where('f.clinic_id', $clinic_id);
            }
            if ($status) {
                // If status is a comma-separated list, use whereIn
                if (strpos($status, ',') !== false) {
                    $query->whereIn('f.status', explode(',', $status));
                } else {
                    $query->where('f.status', $status);
                }
            }
            if ($doctor_id) {
                $query->where('f.doctor_id', $doctor_id);
            }
            if ($patient_id) {
                $query->where('f.patient_id', $patient_id);
            }
            if ($encounter_id) {
                $query->where('f.encounter_id', $encounter_id);
            }

            if ($search) {
                $query->where(function($q) use ($search) {
                    $q->where('p.display_name', 'LIKE', '%' . $search . '%')
                      ->orWhere('d.display_name', 'LIKE', '%' . $search . '%')
                      ->orWhere('f.reason', 'LIKE', '%' . $search . '%');
                });
            }

            if ($date_from) {
                $query->whereRaw('COALESCE(f.suggested_deadline_utc, f.suggested_date_utc) >= %s', [$date_from . ' 00:00:00']);
            }
            if ($date_to) {
                $query->whereRaw('COALESCE(f.suggested_deadline_utc, f.suggested_date_utc) <= %s', [$date_to . ' 23:59:59']);
            }


            $utc_today = gmdate('Y-m-d H:i:s');
            if ($time_frame === 'upcoming') {
                $query->where('f.status', 'pending');
                $query->whereRaw('COALESCE(f.suggested_deadline_utc, f.suggested_date_utc) >= %s', [$utc_today]);
            } elseif ($time_frame === 'past') {
                $query->whereRaw('COALESCE(f.suggested_deadline_utc, f.suggested_date_utc) < %s', [$utc_today]);
            }

            // Order by creation date descending to keep newest first, which helps chain grouping
            $query->orderBy('f.id', 'DESC');

            $total = clone $query;
            $total_count = $total->count();

            $page = max(1, (int) $request->get_param('page'));
            $per_page = $request->get_param('per_page') ?: 10;
            if ($per_page === 'all') {
                $per_page = $total_count;
            } else {
                $per_page = (int) $per_page;
            }
            $offset = ($page - 1) * $per_page;


            $utc_today = gmdate('Y-m-d H:i:s');
            // Use the admin-configured overdue threshold (days grace period after deadline).
            $overdueThresholdDays = KCProFollowupSettings::overdueThresholdDays();
            $followups = $query->limit($per_page)->offset($offset)->get()->map(function($followup) use ($utc_today, $overdueThresholdDays) {
                return $this->formatFollowupData($followup, $overdueThresholdDays, $utc_today);
            });

            return $this->response([
                'status' => true,
                'data' => $followups,
                'total' => $total_count,
                'page' => $page,
                'per_page' => $per_page
            ], 200);

        } catch (\Exception $e) {
            return $this->response([
                'status' => false,
                'message' => $e->getMessage()
            ], 400);
        }
    }

    private function formatFollowupData($followup, $overdueThresholdDays = null, $utc_today = null): array
    {
        $data = $followup->toArray();
        if (!$overdueThresholdDays) {
            $overdueThresholdDays = KCProFollowupSettings::overdueThresholdDays();
        }
        if (!$utc_today) {
            $utc_today = gmdate('Y-m-d H:i:s');
        }

        $suggested_date = $data['suggested_deadline_utc'] ?? $data['suggested_date_utc'];
        $data['suggested_date'] = $suggested_date ? kcGetFormatedDate($suggested_date) : __('Not set', 'kivicare-pro');

        $data['is_overdue'] = false;
        if ($data['status'] === 'pending' && $suggested_date) {
            // Overdue once: (deadline + threshold days) has passed
            $overdue_after = gmdate('Y-m-d H:i:s', strtotime($suggested_date . ' +' . $overdueThresholdDays . ' days'));
            if ($overdue_after < $utc_today) {
                $data['is_overdue'] = true;
            }
        }

        // Also attach patient profile image specifically if needed
        $imageId = get_user_meta($data['patient_id'], 'patient_profile_image', true);
        $data['patient_image_url'] = $imageId ? wp_get_attachment_url($imageId) : '';

        return $data;
    }

    public function getChains(WP_REST_Request $request): WP_REST_Response
    {
        // Chain module disabled globally
        if (!KCProFollowupSettings::isChainsEnabled()) {
            return $this->response([
                'status'  => false,
                'message' => __('Treatment Chains are disabled in system configuration.', 'kivicare-pro'),
            ], 403);
        }

        try {
            $clinic_id = $request->get_param('clinic_id');
            $status = $request->get_param('status') ?: 'active';
            $doctor_id = $request->get_param('doctor_id');
            $patient_id = $request->get_param('patient_id');

            $query = KCProFollowupChain::table('fc')
                ->select([
                    'fc.*',
                    'p.display_name as patient_name',
                    'd.display_name as doctor_name',
                    'c.name as clinic_name',
                ])
                ->leftJoin(KCPatient::class, 'fc.patient_id', '=', 'p.id', 'p')
                ->leftJoin(KCDoctor::class, 'fc.doctor_id', '=', 'd.id', 'd')
                ->leftJoin(KCClinic::class, 'fc.clinic_id', '=', 'c.id', 'c');

            // Exclude anonymized/deleted patients
            $query->where('p.user_email', 'NOT LIKE', '%@example.invalid')
                  ->where('p.display_name', 'NOT LIKE', 'deleted_user_%');

            if ($clinic_id) {
                $query->where('fc.clinic_id', $clinic_id);
            }
            if ($status && $status !== 'all') {
                $query->where('fc.status', $status);
            }
            if ($doctor_id) {
                $query->where('fc.doctor_id', $doctor_id);
            }
            if ($patient_id) {
                $query->where('fc.patient_id', $patient_id);
            }

            $query->orderBy('fc.id', 'DESC');

            $page = (int) ($request->get_param('page') ?: 1);
            $per_page = $request->get_param('per_page') ?: 20;
            if ($per_page === 'all') {
                $per_page = 999999;
            } else {
                $per_page = (int) $per_page;
            }
            $offset = ($page - 1) * $per_page;

            $query->limit($per_page)->offset($offset);
            $total = $query->count();
            $followups = $query->get();
            $followupsArray = [];
            foreach ($followups as $followup) {
                $data = $followup->toArray();
                
                $patient = get_userdata($followup->patient_id);
                $data['patient_name'] = $patient ? $patient->display_name : 'Unknown';
                $imageId = get_user_meta($followup->patient_id, 'patient_profile_image', true);
                $data['patient_image_url'] = $imageId ? wp_get_attachment_url($imageId) : '';

                $doctor = get_userdata($followup->doctor_id);
                $data['doctor_name'] = $doctor ? $doctor->display_name : 'Unknown';
                $clinic = KCClinic::find($followup->clinic_id);
                $data['clinic_name'] = $clinic ? $clinic->name : 'Unknown';

                $followupsArray[] = $data;
            }

            return $this->response([
                'status' => true,
                'data' => $followupsArray,
                'total' => $total,
                'page' => $page,
                'per_page' => $per_page
            ], 200);

        } catch (\Exception $e) {
            return $this->response([
                'status' => false,
                'message' => $e->getMessage()
            ], 400);
        }
    }

    public function updateChainStatus(WP_REST_Request $request): WP_REST_Response
    {
        try {
            $id = $request->get_param('id');
            $status = $request->get_param('status');

            $chain = KCProFollowupChain::find((int) $id);
            if (!$chain) {
                return $this->response(['message' => 'Chain not found.'], 404);
            }

            if ($status === 'closed' && !$this->checkCapability('chain_manage_clinical')) {
                return $this->response([
                    'status' => false,
                    'message' => 'Only a Doctor (Clinical Authority) can mark a chain as closed.'
                ], 403);
            }

            $chainData = $chain->toArray();
            
            $chain->status = $status;
            if ($status === 'closed') {
                $chain->closed_at_utc = gmdate('Y-m-d H:i:s');
                $chain->closed_by = get_current_user_id();
            } else {
                $chain->closed_at_utc = null;
                $chain->closed_by = null;
            }
            
            $chain->save();

            \KCProApp\baseClasses\KCProChainAuditService::get_instance()->log(
                $chain->id,
                null,
                'chain_status_updated',
                ['status' => $chainData['status'] ?? 'active'],
                ['status' => $status]
            );

            return $this->response([
                'status' => true,
                'message' => __('Chain status updated successfully', 'kivicare-pro'),
                'data' => $chain->toArray()
            ], 200);

        } catch (\Exception $e) {
            return $this->response([
                'status' => false,
                'message' => $e->getMessage()
            ], 400);
        }
    }

    public function getFollowup(WP_REST_Request $request): WP_REST_Response
    {
        try {
            $id = $request->get_param('id');
            $followup = KCProFollowup::find($id);

            if (!$followup) {
                return $this->response([
                    'status' => false,
                    'message' => __('Follow-up not found', 'kivicare-pro')
                ], 404);
            }

            $data = $this->formatFollowupData($followup);
            $patient = get_userdata($followup->patient_id);
            $data['patient_name'] = $patient ? $patient->display_name : 'Unknown';

            $doctor = get_userdata($followup->doctor_id);
            $data['doctor_name'] = $doctor ? $doctor->display_name : 'Unknown';

            $clinic = KCClinic::find($followup->clinic_id);
            $data['clinic_name'] = $clinic ? $clinic->name : 'Unknown';

            return $this->response([
                'status' => true,
                'data' => $data
            ], 200);

        } catch (\Exception $e) {
            return $this->response([
                'status' => false,
                'message' => $e->getMessage()
            ], 400);
        }
    }

    public function updateStatus(WP_REST_Request $request): WP_REST_Response
    {
        try {
            $id = $request->get_param('id');
            $status = $request->get_param('status');

            // Strictly Enforce Status Transition Graph Based on Roles
            if ($status === 'completed' && !$this->checkCapability('chain_manage_clinical')) {
                return $this->response([
                    'status' => false,
                    'message' => 'Only a Doctor (Clinical Authority) can mark a follow-up or chain as completed.'
                ], 403);
            }
            if ($status === 'cancelled' && !$this->checkCapability('followup_cancel')) {
                return $this->response([
                    'status' => false,
                    'message' => 'You do not have permission to cancel follow-ups.'
                ], 403);
            }

            $followup = KCProFollowup::find($id);
            if (!$followup) {
                return $this->response([
                    'status' => false,
                    'message' => __('Follow-up not found', 'kivicare-pro')
                ], 404);
            }

            $followup->status = $status;
            if ($status === 'completed') {
                $followup->completed_at_utc = gmdate('Y-m-d H:i:s');
            } elseif ($status === 'cancelled') {
                $followup->cancelled_at_utc = gmdate('Y-m-d H:i:s');
            }

            $followup->save();

            return $this->response([
                'status' => true,
                'message' => __('Follow-up status updated', 'kivicare-pro'),
                'data' => $followup->toArray()
            ], 200);

        } catch (\Exception $e) {
            return $this->response([
                'status' => false,
                'message' => $e->getMessage()
            ], 400);
        }
    }

    public function scheduleFollowup(WP_REST_Request $request): WP_REST_Response
    {
        try {
            $id = $request->get_param('id');
            $appointment_id = $request->get_param('appointment_id');

            $service = KCProFollowupService::get_instance();
            $service->scheduleFollowup($id, $appointment_id, get_current_user_id());

            return $this->response([
                'status' => true,
                'message' => __('Follow-up scheduled successfully', 'kivicare-pro')
            ], 200);

        } catch (\Exception $e) {
            return $this->response([
                'status' => false,
                'message' => $e->getMessage()
            ], 400);
        }
    }

    public function deleteFollowup(WP_REST_Request $request): WP_REST_Response
    {
        try {
            $id = $request->get_param('id');
            $followup = KCProFollowup::find($id);

            if (!$followup) {
                return $this->response([
                    'status' => false,
                    'message' => __('Follow-up not found', 'kivicare-pro')
                ], 404);
            }

            // Optional: Only allow deletion if status is cancelled
            if ($followup->status !== 'cancelled') {
                return $this->response([
                    'status' => false,
                    'message' => __('Only cancelled follow-ups can be deleted', 'kivicare-pro')
                ], 400);
            }

            // Perform hard delete
            $followup->delete();

            return $this->response([
                'status' => true,
                'message' => __('Follow-up deleted successfully', 'kivicare-pro')
            ], 200);

        } catch (\Exception $e) {
            return $this->response([
                'status' => false,
                'message' => $e->getMessage()
            ], 400);
        }
    }

    public function bulkDeleteFollowups(WP_REST_Request $request): WP_REST_Response
    {
        try {
            $ids = $request->get_param('ids');
            $success_count = 0;
            $failed_count = 0;
            $failed_ids = [];

            if (!empty($ids) && is_array($ids)) {
                foreach ($ids as $id) {
                    $followup = KCProFollowup::find($id);

                    if (!$followup) {
                        $failed_count++;
                        $failed_ids[] = [
                            'id' => $id,
                            'reason' => __('Follow-up not found', 'kivicare-pro')
                        ];
                        continue;
                    }

                    // Optional: Only allow deletion if status is cancelled
                    if ($followup->status !== 'cancelled') {
                        $failed_count++;
                        $failed_ids[] = [
                            'id' => $id,
                            'reason' => __('Only cancelled follow-ups can be deleted', 'kivicare-pro')
                        ];
                        continue;
                    }

                    try {
                        // Delete activity logs
                        KCProFollowupActivityLog::query()->where('followup_id', $id)->delete();
                        // Delete reminders
                        KCProFollowupReminder::query()->where('followup_id', $id)->delete();

                        // Perform hard delete
                        $followup->delete();
                        $success_count++;
                    } catch (\Exception $e) {
                        $failed_count++;
                        $failed_ids[] = [
                            'id' => $id,
                            'reason' => $e->getMessage()
                        ];
                    }
                }
            }

            return $this->response([
                'status' => true,
                'message' => sprintf(__('%d follow-ups deleted, %d failed', 'kivicare-pro'), $success_count, $failed_count),
                'data' => [
                    'success_count' => $success_count,
                    'failed_count' => $failed_count,
                    'failed_ids' => $failed_ids
                ]
            ], 200);

        } catch (\Exception $e) {
            return $this->response([
                'status' => false,
                'message' => $e->getMessage()
            ], 400);
        }
    }

    public function bulkUpdateStatus(WP_REST_Request $request): WP_REST_Response
    {
        try {
            $ids = $request->get_param('ids');
            $status = $request->get_param('status');
            $success_count = 0;
            $failed_count = 0;

            if (!empty($ids) && is_array($ids)) {
                foreach ($ids as $id) {
                    $followup = KCProFollowup::find($id);
                    if ($followup) {
                        $followup->status = $status;
                        $followup->save();
                        $success_count++;
                    } else {
                        $failed_count++;
                    }
                }
            }

            return $this->response([
                'status' => true,
                'message' => sprintf(__('%d follow-ups updated, %d failed', 'kivicare-pro'), $success_count, $failed_count)
            ], 200);

        } catch (\Exception $e) {
            return $this->response([
                'status' => false,
                'message' => $e->getMessage()
            ], 400);
        }
    }

    // -------------------------------------------------------------
    // STRICT CHAIN STATUS CONTROL
    // -------------------------------------------------------------

    private function changeChainState(WP_REST_Request $request, string $status): WP_REST_Response
    {
        try {
            $id = $request->get_param('id');
            $reason = $request->get_param('reason');
            
            $chain = KCProFollowupChain::find((int) $id);
            if (!$chain) {
                return $this->response(['message' => 'Chain not found.'], 404);
            }
            KCProStateTransitionValidator::validateChainTransition($chain->status, $status, $chain->id);

            $chainData = $chain->toArray();
            $chain->status = $status;

            if ($status === 'closed') {
                $chain->closed_at_utc = gmdate('Y-m-d H:i:s');
                $chain->closed_by = get_current_user_id();
            }

            $chain->save();

            \KCProApp\baseClasses\KCProChainAuditService::get_instance()->log(
                $chain->id,
                null,
                "chain_status_{$status}",
                ['status' => $chainData['status'] ?? 'active'],
                ['status' => $status],
                $reason
            );

            return $this->response([
                'status' => true,
                'message' => __("Chain status updated successfully", 'kivicare-pro'),
                'data' => $chain->toArray()
            ], 200);

        } catch (\Exception $e) {
            return $this->response([
                'status' => false,
                'message' => $e->getMessage()
            ],$e->getMessage(),false, 500);
        }
    }

    public function getChainSummary(WP_REST_Request $request): WP_REST_Response
    {
        try {
            $chain_id = $request->get_param('id');
            $chain = KCProFollowupChain::find($chain_id);
            if (!$chain) {
                return $this->response(['status' => false, 'message' => 'Chain not found'], 404);
            }

            $total = KCProFollowup::query()->where('chain_id', $chain_id)->count();
            $completed = KCProFollowup::query()->where('chain_id', $chain_id)->where('status', 'completed')->count();
            $missed = KCProFollowup::query()->where('chain_id', $chain_id)->where('status', 'missed')->count();

            $last_followup = KCProFollowup::query()->where('chain_id', $chain_id)->orderBy('created_at_utc', 'DESC')->first();
            $last_activity_date = $last_followup ? $last_followup->created_at_utc : $chain->created_at_utc;

            return $this->response([
                'status' => true,
                'data' => [
                    'id' => $chain->id,
                    'status' => $chain->status,
                    'total' => $total,
                    'completed_count' => $completed,
                    'missed_count' => $missed,
                    'last_activity_date' => $last_activity_date
                ]
            ], 200);
        } catch (\Exception $e) {
            return $this->response(['status' => false, 'message' => $e->getMessage()], 400);
        }
    }

    public function closeChain(WP_REST_Request $request): WP_REST_Response
    {
        return $this->changeChainState($request, 'closed');
    }

    public function reopenChain(WP_REST_Request $request): WP_REST_Response
    {
        return $this->changeChainState($request, 'active');
    }

    public function onHoldChain(WP_REST_Request $request): WP_REST_Response
    {
        return $this->changeChainState($request, 'on_hold');
    }

    // -------------------------------------------------------------
    // CHAIN FOLLOWUPS
    // -------------------------------------------------------------
    
    public function getChainFollowups(WP_REST_Request $request): WP_REST_Response
    {
        try {
            $chain_id = $request->get_param('chain_id');
            $followups = KCProFollowup::query()
                ->where('chain_id', (int) $chain_id)
                ->orderBy('created_at_utc', 'DESC')
                ->get();
                
            $data = $followups->map(function($f) {
                return $this->formatFollowupData($f);
            });
                
            return $this->response([
                'status' => true,
                'data' => $data
            ], 200);
            
        } catch (\Exception $e) {
            return $this->response(['status' => false, 'message' => $e->getMessage()], 400);
        }
    }

    // -------------------------------------------------------------
    // REMINDERS
    // -------------------------------------------------------------

    public function addReminder(WP_REST_Request $request): WP_REST_Response
    {
        try {
            $followup_id = (int) $request->get_param('id');
            $type = $request->get_param('reminder_type');
            $offset = (int) $request->get_param('offset_days');
            $channel = $request->get_param('channel');

            KCProReminderService::get_instance()->createReminder($followup_id, $type, $offset, $channel);

            return $this->response([
                'status' => true,
                'message' => __('Reminder added successfully', 'kivicare-pro')
            ], 200);
        } catch (\Exception $e) {
            return $this->response(['status' => false, 'message' => $e->getMessage()], 400);
        }
    }

    public function removeReminder(WP_REST_Request $request): WP_REST_Response
    {
        try {
            $followup_id = (int) $request->get_param('id');
            $type = $request->get_param('reminder_type');

            KCProReminderService::get_instance()->deleteReminder($followup_id, $type);

            return $this->response([
                'status' => true,
                'message' => __('Reminder removed successfully', 'kivicare-pro')
            ], 200);
        } catch (\Exception $e) {
            return $this->response(['status' => false, 'message' => $e->getMessage()], 400);
        }
    }
}
