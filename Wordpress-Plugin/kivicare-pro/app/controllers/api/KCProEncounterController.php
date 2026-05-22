<?php

namespace KCProApp\controllers\api;

use App\baseClasses\KCBaseController;
use App\models\KCPatientEncounter;
use App\models\KCClinic;
use App\models\KCDoctor;
use App\models\KCPatient;
use WP_REST_Request;
use WP_REST_Response;
use App\models\KCReceptionistClinicMapping;

defined('ABSPATH') or die('Something went wrong');
class KCProEncounterController extends KCBaseController
{

    protected $route = 'encounters';
    public function registerRoutes()
    {
        // Export encounters
        $this->registerRoute('/' . $this->route . '/export', [
            'methods' => 'GET',
            'callback' => [$this, 'exportEncounters'],
            'permission_callback' => [$this, 'checkPermission'],
            'args' => $this->getExportEndpointArgs()
        ]);
    }

    /**
     * Get arguments for the export endpoint
     *
     * @return array
     */
    private function getExportEndpointArgs()
    {
        return [
            'format' => [
                'description' => 'Export format (csv, xls, pdf)',
                'type' => 'string',
                'required' => false,
                'default' => 'csv',
                'enum' => ['csv', 'xls', 'pdf'],
                'sanitize_callback' => 'sanitize_text_field',
            ],
            'search' => [
                'description' => 'Search term',
                'type' => 'string',
                'required' => false,
                'sanitize_callback' => 'sanitize_text_field',
            ],
            'encounterStatus' => [
                'description' => 'Encounter status filter',
                'type' => 'string',
                'required' => false,
                'sanitize_callback' => 'sanitize_text_field',
            ],
            'clinic' => [
                'description' => 'Clinic ID filter',
                'type' => 'integer',
                'required' => false,
                'sanitize_callback' => 'absint',
            ],
            'doctor' => [
                'description' => 'Doctor ID filter',
                'type' => 'integer',
                'required' => false,
                'sanitize_callback' => 'absint',
            ],
            'patient' => [
                'description' => 'Patient ID filter',
                'type' => 'integer',
                'required' => false,
                'sanitize_callback' => 'absint',
            ],
            'encounterDate' => [
                'description' => 'Encounter date filter',
                'type' => 'string',
                'required' => false,
                'sanitize_callback' => 'sanitize_text_field',
            ],
            'startDate' => [
                'description' => 'Start date for date range filter',
                'type' => 'string',
                'required' => false,
                'sanitize_callback' => 'sanitize_text_field',
            ],
            'endDate' => [
                'description' => 'End date for date range filter',
                'type' => 'string',
                'required' => false,
                'sanitize_callback' => 'sanitize_text_field',
            ],
            'page' => [
                'description' => 'Current page of results',
                'type' => 'integer',
                'required' => false,
                'sanitize_callback' => 'absint',
            ],
            'perPage' => [
                'description' => 'Number of results per page',
                'type' => 'string',
                'required' => false,
                'sanitize_callback' => function ($param) {
                    return strtolower($param) === 'all' ? 'all' : absint($param);
                },
            ],
            'orderby' => [
                'description' => 'Sort results by specified field',
                'type' => 'string',
                'required' => false,
                'sanitize_callback' => 'sanitize_text_field',
            ],
            'order' => [
                'description' => 'Sort direction (asc or desc)',
                'type' => 'string',
                'required' => false,
                'sanitize_callback' => 'sanitize_text_field',
            ],
        ];
    }



    /**
     * Export encounters data
     *
     * @param WP_REST_Request $request
     * @return WP_REST_Response
     */
    public function exportEncounters(WP_REST_Request $request): WP_REST_Response
    {
        try {
            $format = $request->get_param('format') ?: 'csv';
            $currentUserRole = $this->kcbase->getLoginUserRole();
            $currentUserId = get_current_user_id();

            // Build query similar to getEncounters
            $query = KCPatientEncounter::table('a')
                ->select([
                    'a.id',
                    'a.encounter_date',
                    'a.status',
                    'c.name as clinic_name',
                    'd.display_name as doctor_name',
                    'd.user_email as doctor_email',
                    'p.display_name as patient_name',
                    'p.user_email as patient_email',
                    'a.created_at'
                ])
                ->leftJoin(KCClinic::class, 'a.clinic_id', '=', 'c.id', 'c')
                ->leftJoin(KCDoctor::class, "a.doctor_id", '=', 'd.id', 'd')
                ->leftJoin(KCPatient::class, "a.patient_id", '=', 'p.ID', 'p');

            // Apply role-based filtering
            if ($currentUserRole === 'administrator') {
                // Admin can see all encounters
            } elseif ($currentUserRole === $this->kcbase->getDoctorRole()) {
                // Doctor can see their own encounters
                $query->where('a.doctor_id', $currentUserId);
            } elseif ($currentUserRole === $this->kcbase->getReceptionistRole()) {
                // Receptionist: filter by clinics assigned in kc_receptionist_clinic_mappings
                $clinicIds = KCReceptionistClinicMapping::query()
                    ->where('receptionist_id', $currentUserId)
                    ->select(['clinic_id'])
                    ->get()
                    ->map(fn($row) => $row->clinicId)
                    ->toArray();
                if (!empty($clinicIds)) {
                    $query->whereIn('a.clinic_id', $clinicIds);
                } else {
                    // No clinics assigned, return empty
                    $query->whereRaw('0=1');
                }
            } elseif ($currentUserRole === $this->kcbase->getClinicAdminRole()) {
                $query->where('c.clinic_admin_id', $currentUserId);
            } elseif ($currentUserRole === $this->kcbase->getPatientRole()) {
                // Patient can see their own encounters
                $query->where('a.patient_id', $currentUserId);
            }

            // Apply filters
            $search = $request->get_param('search');
            if (!empty($search)) {
                $query->where(function($q) use ($search) {
                    $q->where('p.display_name', 'LIKE', '%' . esc_sql($search) . '%')
                      ->orWhere('d.display_name', 'LIKE', '%' . esc_sql($search) . '%')
                      ->orWhere('c.name', 'LIKE', '%' . esc_sql($search) . '%');
                });
            }

            $encounterStatus = $request->get_param('encounterStatus');
            if (!empty($encounterStatus)) {
                $query->where('a.status', $encounterStatus);
            }

            $clinic = $request->get_param('clinic');
            if (!empty($clinic)) {
                $query->where('a.clinic_id', $clinic);
            }

            $doctor = $request->get_param('doctor');
            if (!empty($doctor)) {
                $query->where('a.doctor_id', $doctor);
            }

            $patient = $request->get_param('patient');
            if (!empty($patient)) {
                $query->where('a.patient_id', $patient);
            }

            $encounterDate = $request->get_param('encounterDate');
            if (!empty($encounterDate)) {
                $query->where("a.encounter_date", 'LIKE', '%' . $encounterDate . '%');
            }

            $startDate = $request->get_param('startDate');
            $endDate = $request->get_param('endDate');
            if (!empty($startDate) && strtotime($startDate)) {
                $startDateFormatted = date('Y-m-d', strtotime($startDate));
                $query->where('a.encounter_date', '>=', $startDateFormatted);
            }
            if (!empty($endDate) && strtotime($endDate)) {
                $endDateFormatted = date('Y-m-d', strtotime($endDate));
                $query->where('a.encounter_date', '<=', $endDateFormatted);
            }

            // Sorting (default id DESC)
            $orderBy = $request->get_param('orderby') ?: 'id';
            $order = strtoupper($request->get_param('order')) === 'ASC' ? 'ASC' : 'DESC';
            $sortMap = [
                'id' => 'a.id',
                'encounter_date' => 'a.encounter_date',
                'status' => 'a.status',
                'created_at' => 'a.created_at',
                'doctor' => 'd.display_name',
                'patient' => 'p.display_name',
                'clinic' => 'c.name',
            ];
            $query->orderBy($sortMap[$orderBy] ?? 'a.id', $order);

            // Pagination
            $page = max(1, (int) $request->get_param('page'));
            $perPageParam = $request->get_param('perPage') ?: 'all';
            $showAll = (strtolower($perPageParam) === 'all');
            if (!$showAll) {
                $perPage = max(1, (int) $perPageParam);
                $offset = ($page - 1) * $perPage;
                $query->limit($perPage)->offset($offset);
            }

            $results = $query->get();
            // Format data for export
            $exportData = $results->map(function ($encounter) {
                return [
                    'ID' => $encounter->id,
                    'Patient Name' => $encounter->patient_name ?: '',
                    'Patient Email' => $encounter->patient_email ?: '',
                    'Doctor Name' => $encounter->doctor_name ?: '',
                    'Doctor Email' => $encounter->doctor_email ?: '',
                    'Clinic Name' => $encounter->clinic_name ?: '',
                    'Encounter Date' => date('F j, Y', strtotime($encounter->encounterDate)) ?: '',
                    'Status' => $encounter->status == '1' ? 'Active' : 'Closed',
                    'Created At' => date('F j, Y', strtotime($encounter->createdAt)) ?: '',
                ];
            })->toArray();

            return $this->response($exportData, __('Encounters exported successfully', 'kivicare-pro'));
        } catch (\Exception $e) {
            return $this->response(null, $e->getMessage(), false, 500);
        }
    }
}
