<?php


namespace KCProApp\filterClasses;

use App\baseClasses\KCBase;
use App\models\KCPatientClinicMapping;
use App\models\KCClinic;
use App\models\KCDoctorClinicMapping;
use App\emails\KCEmailSender;
use App\models\KCPatientEncounter;
use App\models\KCReceptionistClinicMapping;
use App\models\KCBill;
use KCProApp\notifications\KCPNotificationSender;
use KCProApp\models\KCPPatientReview;
use KCProApp\models\KCPTaxData;

if (!defined('ABSPATH')) {
    exit; // Exit if accessed directly
}
class KCPCommonFilters extends KCBase
{
    /**
     * Override the parent method to add custom functionality
     */
    public function __construct()
    {
        add_filter('kcpro_patient_clinic_checkin_checkout', [$this, 'patientClinicCheckOut']);
        add_filter('kc_clinic_data', [$this, 'addTotalSatisfaction'], 10, 2);
        add_filter('kivicare_static_doctor_details', [$this, 'appendDoctorReviewCount'], 10, 3);
        add_filter('kc_doctor_list_item_data', [$this, 'addDoctorAverageRating'], 10, 3);
        add_filter('kivicare_total_revenue', [$this, 'filterTotalRevenue'], 10, 4);
    }

    /**
     * Filter to modify total revenue based on encounter IDs
     *
     * @param mixed $total The original total revenue
     * @param string $user_role The role of the user
     * @param int $user_id The ID of the user
     * @param array $date_range The date range for filtering
     * @return mixed The modified total revenue
     */
    public function filterTotalRevenue($total, $user_role, $user_id, $date_range)
    {
        $hasDateRange = isset($date_range['date_range']['start_date']) && isset($date_range['date_range']['end_date']);
        $startDate = $hasDateRange ? $date_range['date_range']['start_date'] : null;
        $endDate = $hasDateRange ? $date_range['date_range']['end_date'] : null;
        // If start and end date are the same and no time is specified, expand to full day
        if ($hasDateRange && $startDate === $endDate && strlen($startDate) === 10 && strlen($endDate) === 10) {
            $startDate .= ' 00:00:00';
            $endDate .= ' 23:59:59';
        }
        if (isset($total->total_revenue) && $total->total_revenue > 0) {
            if ($user_role === $this->getReceptionistRole()){
                $query = KCPatientEncounter::table('patient_encounters')
                    ->select(['patient_encounters.id as patient_encounter_id'])
                    ->join(KCBill::class, 'bills.encounter_id','=', 'patient_encounters.id','bills')
                    ->where('patient_encounters.clinic_id', KCReceptionistClinicMapping::getClinicIdByReceptionistId($user_id));
                if ($hasDateRange) {
                    $query = $query->whereBetween('bills.created_at', [$startDate, $endDate]);
                }
                $encounter_ids = $query
                    ->get()
                    ->pluck('patient_encounter_id')->toArray();
                if(!empty($encounter_ids)){
                    $tax = KCPTaxData::query()
                            ->select(['charges'])
                            ->whereIn('moduleId', $encounter_ids)
                            ->where('moduleType', 'encounter')
                            ->get() ?? 0;
                    $total_tax = [0];
                    foreach($tax as $tax_data){
                        $total_tax[] = (float)$tax_data->charges;
                    }
                    $total_tax = array_sum($total_tax);
                    $total->total_revenue -= (float)$total_tax;
                }
            } elseif ($user_role === $this->getClinicAdminRole()){
                $query = KCPatientEncounter::table('patient_encounters')
                    ->select(['patient_encounters.id as patient_encounter_id'])
                    ->join(KCBill::class, 'bills.encounter_id','=', 'patient_encounters.id','bills')
                    ->where('patient_encounters.clinic_id', $user_id);
                if ($hasDateRange) {
                    $query = $query->whereBetween('bills.created_at', [$startDate, $endDate]);
                }
                $encounter_ids = $query
                    ->get()
                    ->pluck('patient_encounter_id')->toArray();
                if(!empty($encounter_ids)){
                    $tax = KCPTaxData::query()
                            ->select(['charges'])
                            ->whereIn('moduleId', $encounter_ids)
                            ->where('moduleType', 'encounter')
                            ->get() ?? 0;
                    $total_tax = [0];
                    foreach($tax as $tax_data){
                        $total_tax[] = (float)$tax_data->charges;
                    }
                    $total_tax = array_sum($total_tax);
                    $total->total_revenue -= (float)$total_tax;
                }
            } else {
                $query = KCPatientEncounter::table('patient_encounters')
                    ->select(['patient_encounters.id as patient_encounter_id'])
                    ->join(KCBill::class, 'bills.encounter_id','=', 'patient_encounters.id','bills');
                if ($hasDateRange) {
                    $query = $query->whereBetween('bills.created_at', [$startDate, $endDate]);
                }
                $encounter_ids = $query
                    ->get()
                    ->pluck('patient_encounter_id')->toArray();
                $tax = KCPTaxData::query()
                        ->select(['charges'])
                        ->whereIn('moduleId', $encounter_ids)
                        ->where('moduleType', 'encounter')
                        ->get() ?? 0;
                $total_tax = [0];
                foreach($tax as $tax_data){
                    $total_tax[] = (float)$tax_data->charges;
                }
                $total_tax = array_sum($total_tax);
                $total->total_revenue -= (float)$total_tax;
            }
            return $total;
        }
        return 0;
    }

    /**
     * function to change clinic by patient
     *
     * @param $request_data
     *
     * @return array
     */
    public function patientClinicCheckOut($request_data){

        if ($this->getLoginUserRole() != $this->getPatientRole()) {
            return [
                'status' => false,
                'message' => esc_html__('Only patients can perform this action', 'kivicare-pro'),
                'notification' => []
            ];
        }

        $status = false;
        $message = esc_html__("failed to Checkout Clinic",'kivicare-pro');
        $notification_send_result = [];
        //check if clinic id not empty
        if(!empty($request_data['data']) && !empty($request_data['data']['id'])){
            $clinic_id = (int)$request_data['data']['id'];
            $user_id = get_current_user_id();
            $new_temp = [
                'patientId' => $user_id,
                'clinicId' => $clinic_id,
                'createdAt' => current_time('Y-m-d H:i:s')
            ];
            //check if new clinic id is same as old patient clinic
            $existingMapping = KCPatientClinicMapping::query()->where('patient_id',  $user_id)->where('clinic_id', $clinic_id)->first();
            if($existingMapping){
                return[
                    'status' => true,
                    'message' => esc_html__("Patient Clinic Updated",'kivicare-pro'),
                    'notification' => []
                ];
            }

            //delete old patient clinic
            KCPatientClinicMapping::query()->where('patient_id', $user_id)->delete();
            //add new clinic to patient
            $result = KCPatientClinicMapping::create($new_temp);

            //get patient data
            $patient_data = get_userdata( $user_id );

            $clinic_detail = KCClinic::query()->where('id', $clinic_id)->first();

            if(str_starts_with(ltrim($clinic_detail->telephone_no), '+')){
                $clinic_number = !empty($clinic_detail->telephone_no) ? $clinic_detail->telephone_no : '';

            }
            else{
                $country_calling_code = $clinic_detail->country_calling_code;
                if(!empty($country_calling_code)){
                    $clinic_number =  !empty($clinic_detail->telephone_no) ? '+'.$country_calling_code.$clinic_detail->telephone_no : '';
                }
                else{
                    $clinic_number =  !empty($clinic_detail->telephone_no) ? $clinic_detail->telephone_no : '';
                }
            }

            $notification_data = [
                'user_email' => !empty($clinic_detail->email) ? $clinic_detail->email : '',
                'patient_name' => !empty($patient_data->display_name) ? $patient_data->display_name : '',
                'patient_email' => !empty($patient_data->user_email) ? $patient_data->user_email : '',
                'current_date' => current_time('Y-m-s'),
                'email_template_type' => 'patient_clinic_check_in_check_out',
                'clinic_number' => $clinic_number,
            ];

            $recipient = [
                'phone' => $notification_data['clinic_number'],
                'email' => $notification_data['user_email'],
                'name' => $clinic_detail->name ?? '',
            ];

            // send email to clinic.
            $notification_send_result = [
                "email" => KCEmailSender::get_instance()->sendEmailByTemplate('patient_clinic_check_in_check_out', $notification_data['user_email'], $notification_data),
                'sms/whatsapp' => KCPNotificationSender::get_instance()->execute_notification('patient_clinic_check_in_check_out', [$recipient], $notification_data, ['channels' => ['twilio', 'whatsapp']])
            ];

            if($result){
                $status = true;
                $message = esc_html__("Patient clinic updated successfully",'kivicare-pro');
            }
        }else{
            $message = esc_html__("Clinic Not selected",'kivicare-pro');
        }

        return [
            'status' => $status,
            'message' => $message,
            'notification' => $notification_send_result
        ];
    }

    /**
     * Add total_satisfaction field to clinic data
     *
     * @param array $clinicData The clinic data array
     * @param int $clinicId The clinic ID
     * @return array Modified clinic data with total_satisfaction
     */
    public function addTotalSatisfaction($clinicData, $clinicId)
    {
        // Get total satisfaction (average rating) for this clinic
        $totalSatisfaction = 0;
        
        if (class_exists(\KCProApp\models\KCPPatientReview::class)) {
            // Get all doctors in this clinic
            $doctorMappings = KCDoctorClinicMapping::query()
                ->where('clinicId', '=', $clinicId)
                ->get();
            
            $doctorIds = $doctorMappings->pluck('doctorId')->toArray();

            if (!empty($doctorIds)) {
                // Get all reviews for doctors in this clinic
                $reviews = \KCProApp\models\KCPPatientReview::query()
                    ->whereIn('doctorId', $doctorIds)
                    ->get();

                if ($reviews->count() > 0) {
                    // Calculate average rating
                    $totalSatisfaction = round($reviews->avg('review'), 1);
                }
            }
        }

        // Add total_satisfaction to clinic data
        $clinicData['total_satisfaction'] = (float) $totalSatisfaction;

        return $clinicData;
    }

    /**
     * Append review_count to doctor data for static-data response.
     *
     * @param array $doctorData
     * @param mixed $doctor
     * @param array $context
     * @return array
     */
    public function appendDoctorReviewCount(array $doctorData, $doctor, array $context = [])
    {
        if (!class_exists(KCPPatientReview::class)) {
            return $doctorData;
        }

        $reviewCounts = $context['review_counts'] ?? [];
        $doctorId = isset($doctor->id) ? (int) $doctor->id : 0;

        $doctorData['review_count'] = (int) ($reviewCounts[$doctorId] ?? 0);

        return $doctorData;
    }

    /**
     * Add average_rating field to doctor data in doctors list response.
     *
     * @param array $doctorData The doctor data array
     * @param mixed $doctor The doctor object from database
     * @param \WP_REST_Request $request The REST request object
     * @return array Modified doctor data with average_rating
     */
    public function addDoctorAverageRating(array $doctorData, $doctor, $request)
    {
        if (!class_exists(KCPPatientReview::class)) {
            $doctorData['review_count'] = 0;
            return $doctorData;
        }

        $doctorId = isset($doctorData['id']) ? (int) $doctorData['id'] : 0;
        if ($doctorId <= 0) {
            $doctorData['review_count'] = 0;
            return $doctorData;
        }

        static $ratingsCache = [];
        static $reviewCountsCache = [];
        static $ratingsFetched = false;

        if (!$ratingsFetched) {
            global $wpdb;
            $schema = KCPPatientReview::getSchema();
            $table_name = $wpdb->prefix . $schema['table_name'];
            $table_name_escaped = esc_sql($table_name);

            $results = $wpdb->get_results(
                "SELECT doctor_id, ROUND(AVG(review), 1) as average_rating, COUNT(id) as review_count 
                 FROM `{$table_name_escaped}` 
                 GROUP BY doctor_id",
                ARRAY_A
            );

            if (!empty($results)) {
                foreach ($results as $row) {
                    $ratingsCache[(int) $row['doctor_id']] = (float) $row['average_rating'];
                    $reviewCountsCache[(int) $row['doctor_id']] = (int) $row['review_count'];
                }
            }

            $ratingsFetched = true;
        }

        $doctorData['average_rating'] = isset($ratingsCache[$doctorId]) ? (float) $ratingsCache[$doctorId] : 0.0;
        $doctorData['review_count'] = isset($reviewCountsCache[$doctorId]) ? (int) $reviewCountsCache[$doctorId] : 0;

        return $doctorData;
    }
}