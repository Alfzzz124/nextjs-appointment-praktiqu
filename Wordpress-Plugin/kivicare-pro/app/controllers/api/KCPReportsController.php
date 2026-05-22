<?php

namespace KCProApp\controllers\api; 

use App\models\KCDoctorClinicMapping;
use App\baseClasses\KCBaseController;
use App\baseClasses\KCErrorLogger;
use App\models\KCAppointment;
use App\models\KCBill;
use App\models\KCClinic;
use App\models\KCDoctor;
// use App\models\KCUser;
use DateTime;
use WP_REST_Request;
use WP_REST_Response;

defined('ABSPATH') or die('Something went wrong');

class KCPReportsController extends KCBaseController
{
    protected $route = 'reports';

    public function registerRoutes()
    {
        $endpoints = [
            'initial-data' => 'getInitialData',
            'clinic-revenue-overall' => 'getClinicRevenueOverall',
            'clinic-revenue-detail' => 'getClinicRevenueDetail',
            'doctor-revenue' => 'getDoctorRevenue',
            'clinic-appointment-count' => 'getClinicAppointmentCount',
            'doctor-appointment-count' => 'getDoctorAppointmentCount',
        ];

        foreach ($endpoints as $path => $callback) {
            $this->registerRoute("/{$this->route}/$path", [
                'methods' => 'GET',
                'callback' => [$this, $callback],
                'permission_callback' => [$this, 'checkPermission'],
            ]);
        }
    }

    public function getInitialData(WP_REST_Request $request): WP_REST_Response
    {
        try {
            $prefix_postfix = KCClinic::getClinicCurrencyPrefixAndPostfix();
            $clinic_currency = [
                'prefix' => !empty($prefix_postfix['prefix']) ? $prefix_postfix['prefix'] : '$',
                'postfix' => !empty($prefix_postfix['postfix']) ? $prefix_postfix['postfix'] : ''
            ];

            $color_palette = ['#008FFB', '#00E396', '#FEB019', '#FF4560', '#775DD0', '#546E7A', '#A5978B', '#C7F464', '#9C27B0', '#2196F3', '#4CAF50', '#FF9800', '#F44336', '#673AB7'];

            $response_data = [
                // The 'filters' key is completely removed.
                'clinic_currency' => $clinic_currency,
                'doctor_colors' => apply_filters('kivicare_report_doctor_chart_colors', $color_palette),
                'clinic_colors' => apply_filters('kivicare_report_clinic_chart_colors', $color_palette)
            ];

            return $this->response($response_data, __('Initial report data retrieved successfully', 'kivicare-pro'));

        } catch (\Exception $e) {
            return $this->response(['error' => $e->getMessage()], __('Failed to get initial report data', 'kivicare-pro'), false, 500);
        }
    }


    public function getClinicRevenueOverall(WP_REST_Request $request): WP_REST_Response
    {
        try {
            $params = $request->get_params();

            $date_details = $this->prepareDateParameters($params);
            $start_date = $date_details['start_date'];
            $end_date = $date_details['end_date'];

            $query = KCBill::table('b')
                ->select(['c.name as clinic_name', 'SUM(b.total_amount) as total_revenue'])
                ->leftJoin(KCClinic::class, 'b.clinic_id', '=', 'c.id', 'c')
                ->leftJoin(KCAppointment::class, 'b.appointment_id', '=', 'a.id', 'a')
                ->leftJoin(KCDoctor::class, 'a.doctor_id', '=', 'd.ID', 'd')
                ->where('b.payment_status', '=', 'paid')
                ->whereRaw('b.created_at BETWEEN %s AND %s', [$start_date, $end_date])
                ->groupBy('c.name');

            // Apply filters after all necessary joins are established
            $this->applyBaseTableFilters($query, $params, 'clinic_revenue_overall');

            $results = $query->get();

            $labels = $results->pluck('clinic_name')->filter()->toArray();
            $data = $results->pluck('total_revenue')->map(fn($val) => (float) $val)->toArray();

            $response_data = [
                'labels' => $labels,
                'datasets' => [['data' => $data]]
            ];

            return $this->response($response_data, __('Overall clinic revenue retrieved', 'kivicare-pro'));
        } catch (\Exception $e) {
            return $this->response(['error' => $e->getMessage()], __('Failed to retrieve overall clinic revenue', 'kivicare-pro'), false, 500);
        }
    }

    public function getClinicRevenueDetail(WP_REST_Request $request): WP_REST_Response
    {
        return $this->getAggregatedData('clinic', $request);
    }

    public function getDoctorRevenue(WP_REST_Request $request): WP_REST_Response
    {
        return $this->getAggregatedData('doctor', $request);
    }

    public function getClinicAppointmentCount(WP_REST_Request $request): WP_REST_Response
    {
        return $this->getAggregatedData('clinic_appointment', $request);
    }

    public function getDoctorAppointmentCount(WP_REST_Request $request): WP_REST_Response
    {
        return $this->getAggregatedData('doctor_appointment', $request);
    }

    /**
     * Fetches a unique list of clinic or doctor names based on filters.
     * This is used to build the chart legends correctly.
     *
     * @param string $group_type 'clinic' or 'doctor'
     * @param array $params The request filter parameters
     * @return array A list of group names.
     */
    private function getReportGroups(string $group_type, array $params): array
    {
        $isClinic = $group_type === 'clinic';
        $groupQuery = $isClinic
            ? KCClinic::table('c')->select(['name'])
            : KCDoctor::table('d')->select(["IF(d.display_name != '' AND d.display_name IS NOT NULL, d.display_name, d.user_login) AS final_doctor_name"]);

        $report_type_for_filter = $isClinic ? 'clinic_appointment' : 'doctor_appointment';
        $pluck_column = $order_by_column = $isClinic ? 'name' : 'final_doctor_name';

        $groupQuery->leftJoin(KCDoctorClinicMapping::class, $isClinic ? 'c.id' : 'd.ID', '=', "dcm.{$group_type}_id", 'dcm');
        $this->applyBaseTableFilters($groupQuery, $params, $report_type_for_filter, true);
        $groupQuery->orderBy($order_by_column, 'desc');

        return $groupQuery->get()->pluck($pluck_column)->unique()->toArray();
    }


    private function getAggregatedData(string $type, WP_REST_Request $request): WP_REST_Response
    {
        try {
            $params = $request->get_params();

            $date_details = $this->prepareDateParameters($params);

            $is_appointment_query = strpos($type, 'appointment') !== false;
            $is_clinic_based_query = in_array($type, ['clinic', 'clinic_appointment']);

            // Step 1: Prepare the full array of SELECT columns first ---
            $select_columns = [
                $is_clinic_based_query
                ? "c.name AS group_name"
                : "IF(d.display_name != '' AND d.display_name IS NOT NULL, d.display_name, d.user_login) AS group_name"
            ];

            $date_column = $is_appointment_query ? 'a.appointment_start_date' : 'b.created_at';
            $select_columns[] = "DATE_FORMAT({$date_column}, '{$date_details['sql_format']}') AS period";
            $select_columns[] = $is_appointment_query
                ? "COUNT(DISTINCT a.id) AS total_count"
                : "COALESCE(SUM(b.total_amount), 0) AS total_revenue";

            // Step 2: Initialize the base query with the complete SELECT clause ---
            if ($is_clinic_based_query) {
                $base_query = KCClinic::table('c')->select($select_columns)
                    ->leftJoin(KCAppointment::class, 'c.id', '=', 'a.clinic_id', 'a')
                    ->leftJoin(KCDoctor::class, 'a.doctor_id', '=', 'd.ID', 'd');
            } else {
                $base_query = KCDoctor::table('d')->select($select_columns)
                    ->leftJoin(KCAppointment::class, 'd.ID', '=', 'a.doctor_id', 'a')
                    ->leftJoin(KCClinic::class, 'a.clinic_id', '=', 'c.id', 'c');
            }

            // Step 3: Add conditional JOINS and WHERE clauses ---
            if ($is_appointment_query) {
                $status_key = $is_clinic_based_query ? 'appointment_status_clinic' : 'appointment_status_doctor';
                $status = $params[$status_key] ?? 'all';
                $date_column = 'a.appointment_start_date';
                $base_query->whereRaw("{$date_column} BETWEEN %s AND %s", [$date_details['start_date'], $date_details['end_date']]);
                if ($status !== 'all')
                    $base_query->where('a.status', '=', $status);
            } else {
                $date_column = 'b.created_at';
                $base_query->leftJoin(KCBill::class, 'a.id', '=', 'b.appointment_id', 'b')
                    ->where('b.payment_status', '=', 'paid')
                    ->whereRaw("{$date_column} BETWEEN %s AND %s", [$date_details['start_date'], $date_details['end_date']]);
            }

            // Step 4: Apply common filters and execute the main query ---
            $this->applyBaseTableFilters($base_query, $params, $type);
            $results = $base_query->groupBy(['group_name', 'period'])->get();

            // Step 5: Get all expected groups via the helper function ---
            $group_type = $is_clinic_based_query ? 'clinic' : 'doctor';
            $expected_groups = $this->getReportGroups($group_type, $params);

            // Step 6: Process results into datasets ---
            $datasets = [];
            foreach ($expected_groups as $group_name) {
                if (!empty($group_name)) {
                    $datasets[$group_name] = ['label' => $group_name, 'data' => array_fill(0, count($date_details['labels']), 0)];
                }
            }

            if (!$results->isEmpty()) {
                foreach ($results as $result) {
                    $group_name = $result->group_name;
                    if (isset($datasets[$group_name]) && !empty($result->period)) {
                        $index = array_search($result->period, $date_details['labels']);
                        if ($index !== false) {
                            $value = $is_appointment_query ? (int) $result->total_count : (float) ($result->total_revenue ?? 0);
                            $datasets[$group_name]['data'][$index] += $value;
                        }
                    }
                }
            }

            $response_data = [
                'labels' => $date_details['labels'],
                'datasets' => array_values($datasets)
            ];

            return $this->response($response_data, __('Report data retrieved', 'kivicare-pro'));

        } catch (\Exception $e) {
            return $this->response(['error' => $e->getMessage()], __('Failed to retrieve report data', 'kivicare-pro'), false, 500);
        }
    }


    /**
     * Processes date parameters to generate a date range, SQL format, and chart labels.
     *
     * @param array $params The request parameters.
     * @return array An associative array with 'start_date', 'end_date', 'sql_format', 'labels'.
     */
    private function prepareDateParameters(array $params): array
    {
        $year = !empty($params['year']) ? (int) $params['year'] : (int) date('Y');
        $month = $params['month'] ?? 'all';

        $start_date = '';
        $end_date = '';
        $sql_format = '';
        $labels = [];

        if ($month !== 'all' && !empty($month)) {
            // Daily View
            $sql_format = '%%d';
            $start_date_obj = new DateTime("{$year}-{$month}-01");
            $start_date = $start_date_obj->format('Y-m-d');
            $end_date = $start_date_obj->format('Y-m-t');

            $days = (int) date('t', strtotime($start_date));
            $timestamp = strtotime($start_date);
            for ($i = 1; $i <= $days; $i++, $timestamp = strtotime('+1 day', $timestamp)) {
                $labels[] = date_i18n('d', $timestamp);
            }
        } else {
            // Monthly View
            $sql_format = '%%b';
            $start_date = "{$year}-01-01";
            $end_date = "{$year}-12-31";

            for ($i = 1; $i <= 12; $i++) {
                $labels[] = date_i18n('M', mktime(0, 0, 0, $i, 1, $year));
            }
        }

        KCErrorLogger::instance()->error("[KiviCare DEBUG] Date parameters prepared. Range: {$start_date} to {$end_date}. Labels count: " . count($labels));
        return compact('start_date', 'end_date', 'sql_format', 'labels');
    }


    private function applyBaseTableFilters(&$query, $params, $query_type, $is_group_query = false)
    {
        $current_user_id = get_current_user_id();
        $current_user_role = $this->kcbase->getLoginUserRole();

        // --- Role-Based Scoping ---
        switch ($current_user_role) {
            case $this->kcbase->getClinicAdminRole():
            case $this->kcbase->getReceptionistRole():
                $clinic_id = KCClinic::getClinicIdForCurrentUser($current_user_id);
                if ($clinic_id) {
                    $query->where("c.id", '=', $clinic_id);
                }
                break;
            case $this->kcbase->getDoctorRole():
                $query->where("d.ID", '=', $current_user_id);
                break;
        }

        // --- UI-Based Filters ---
        $clinic_id_filter = (!empty($params['clinic_id']) && $params['clinic_id'] !== 'all') ? (int) $params['clinic_id'] : null;
        $doctor_id_filter = (!empty($params['doctor_id']) && $params['doctor_id'] !== 'all') ? (int) $params['doctor_id'] : null;

        if ($is_group_query) {
            if ($clinic_id_filter)
                $query->where('dcm.clinic_id', '=', $clinic_id_filter);
            if ($doctor_id_filter)
                $query->where('dcm.doctor_id', '=', $doctor_id_filter);
        } else {
            if ($clinic_id_filter)
                $query->where('a.clinic_id', '=', $clinic_id_filter);
            if ($doctor_id_filter)
                $query->where('a.doctor_id', '=', $doctor_id_filter);
        }
    }

}