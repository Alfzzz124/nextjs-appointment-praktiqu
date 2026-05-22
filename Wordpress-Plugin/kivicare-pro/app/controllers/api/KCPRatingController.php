<?php

namespace KCProApp\controllers\api;

use App\baseClasses\KCBaseController;
use App\models\KCAppointment;
use App\models\KCDoctor;
use App\models\KCPatient;
use App\models\KCUser;
use KCProApp\models\KCPPatientReview;
use App\baseClasses\KCErrorLogger;
use WP_Error;
use WP_REST_Request;
use WP_REST_Response;

defined('ABSPATH') or die('Something went wrong');

class KCPRatingController extends KCBaseController
{
    protected $route = 'rating';

    public function registerRoutes()
    {
        $this->registerRoute("/{$this->route}/add", [
            'methods' => 'POST',
            'callback' => [$this, 'addReview'],
            'permission_callback' => [$this, 'checkPermission'],
            'args' => [
                'appointment_id' => [
                    'required' => true,
                    'type' => 'integer',
                    'minimum' => 1,
                    'description' => 'Appointment ID to extract patient and doctor from',
                    'validate_callback' => [$this, 'validateAppointmentReview'],
                ],
                'rating' => [
                    'required' => true,
                    'type' => 'integer',
                    'minimum' => 1,
                    'maximum' => 5,
                    'description' => 'Rating value between 1 and 5',
                ],
                'review_text' => [
                    'required' => false,
                    'type' => 'string',
                    'description' => 'Review text/description',
                ],
            ],
        ]);

        $this->registerRoute("/{$this->route}/update", [
            'methods' => 'POST',
            'callback' => [$this, 'updateReview'],
            'permission_callback' => [$this, 'checkPermission'],
            'args' => [
                'review_id' => [
                    'required' => true,
                    'type' => 'integer',
                    'minimum' => 1,
                    'description' => 'Review ID to update',
                ],
                'rating' => [
                    'required' => false,
                    'type' => 'integer',
                    'minimum' => 1,
                    'maximum' => 5,
                    'description' => 'New rating value between 1 and 5',
                ],
                'review_text' => [
                    'required' => false,
                    'type' => 'string',
                    'description' => 'Updated review text/description',
                ],
            ],
        ]);

        $this->registerRoute("/{$this->route}/delete", [
            'methods' => 'POST',
            'callback' => [$this, 'deleteReview'],
            'permission_callback' => [$this, 'checkPermission'],
            'args' => [
                'review_id' => [
                    'required' => true,
                    'type' => 'integer',
                    'minimum' => 1,
                    'description' => 'Review ID to delete',
                ],
            ],
        ]);

        // GET routes
        $this->registerRoute("/{$this->route}/list", [
            'methods' => 'GET',
            'callback' => [$this, 'getReviews'],
            'permission_callback' => [$this, 'checkPermission'],
            'args' => [
                'doctor_id' => [
                    'required' => false,
                    'type' => 'integer',
                    'minimum' => 1,
                    'description' => 'Filter reviews by doctor ID',
                ],
                'patient_id' => [
                    'required' => false,
                    'type' => 'integer',
                    'minimum' => 1,
                    'description' => 'Filter reviews by patient ID',
                ],
                'page' => [
                    'required' => false,
                    'type' => 'integer',
                    'minimum' => 1,
                    'default' => 1,
                    'description' => 'Page number for pagination',
                ],
                'per_page' => [
                    'required' => false,
                    'type' => 'integer',
                    'minimum' => 1,
                    'maximum' => 100,
                    'default' => 10,
                    'description' => 'Number of reviews per page',
                ],
            ],
        ]);
    }

    /**
     * Add a new patient review
     */
    public function addReview(WP_REST_Request $request): WP_REST_Response
    {
        try {
            // Fetch Request Data
            $params = $request->get_params();
            $rating = $params['rating'] ?? null;
            $review_text = $params['review_text'] ?? '';
            $appointment_id = $params['appointment_id'] ?? null;

            // Get patient and doctor from appointment (validation already done in validateAppointmentReview)
            $appointment = KCAppointment::find($appointment_id);
            $patient_id = $appointment->patientId;
            $doctor_id = $appointment->doctorId;

            // Validate rating (basic validation, detailed validation done in args)
            if (empty($rating) || !is_numeric($rating) || $rating < 1 || $rating > 5) {
                return $this->response(
                    null,
                    __('Rating must be a number between 1 and 5.', 'kivicare-pro'),
                    false,
                    400
                );
            }

            // Create new review using the model
            $review = new KCPPatientReview();
            $review->review = $rating;
            $review->reviewDescription = sanitize_textarea_field($review_text);
            $review->patientId = $patient_id;
            $review->doctorId = $doctor_id;
            $review->createdAt = current_time('mysql');
            $review->updatedAt = current_time('mysql');

            if (!$review->save()) {
                return $this->response(
                    null,
                    __('Failed to save review. Please try again.', 'kivicare-pro'),
                    false,
                    500
                );
            }

            // Return Final Response
            return $this->response(
                ['review_id' => $review->id],
                __('Review added successfully.', 'kivicare-pro'),
                true,
                201
            );

        } catch (\Exception $e) {
            return $this->response(
                ['error' => $e->getMessage()],
                __('Failed to add review.', 'kivicare-pro'),
                false,
                500
            );
        }
    }

    /**
     * Update an existing patient review
     */
    public function updateReview(WP_REST_Request $request): WP_REST_Response
    {
        try {
            // Fetch Request Data
            $params = $request->get_params();
            $review_id = $params['review_id'] ?? null;
            $rating = $params['rating'] ?? null;
            $review_text = $params['review_text'] ?? '';

            // Validate Required Fields
            if (empty($review_id)) {
                return $this->response(
                    null,
                    __('Review ID is required.', 'kivicare-pro'),
                    false,
                    400
                );
            }

            if (!empty($rating) && (!is_numeric($rating) || $rating < 1 || $rating > 5)) {
                return $this->response(
                    null,
                    __('Rating must be a number between 1 and 5.', 'kivicare-pro'),
                    false,
                    400
                );
            }

            // Check if review exists and user has permission to edit
            $existing_review = KCPPatientReview::find($review_id);

            if (!$existing_review) {
                return $this->response(
                    null,
                    __('Review not found.', 'kivicare-pro'),
                    false,
                    404
                );
            }

            // Verify ownership or admin permission
            $current_user_id = get_current_user_id();
            $current_user_role = $this->kcbase->getLoginUserRole();

            if (
                $current_user_role !== 'administrator' &&
                $existing_review->patientId != $current_user_id
            ) {
                return $this->permissionDeniedResponse();
            }

            // Update review data
            $update_data = [];

            if (!empty($rating)) {
                $update_data['review'] = $rating;
            }

            if (isset($params['review_text'])) {
                $update_data['reviewDescription'] = sanitize_textarea_field($review_text);
            }

            $result = $existing_review->update($update_data);

            if ($result === false) {
                return $this->response(
                    null,
                    __('Failed to update review. Please try again.', 'kivicare-pro'),
                    false,
                    500
                );
            }

            return $this->response(
                ['review_id' => $review_id],
                __('Review updated successfully.', 'kivicare-pro')
            );

        } catch (\Exception $e) {
            return $this->response(
                ['error' => $e->getMessage()],
                __('Failed to update review.', 'kivicare-pro'),
                false,
                500
            );
        }
    }

    /**
     * Get reviews list
     */
    public function getReviews(WP_REST_Request $request): WP_REST_Response
    {
        try {
            // 1. Extract and validate request parameters
            $params = $request->get_params();
            $doctor_id = $params['doctor_id'] ?? null;
            $patient_id = $params['patient_id'] ?? null;
            $page = max(1, intval($params['page'] ?? 1));
            $per_page = min(100, max(1, intval($params['per_page'] ?? 10)));
            $sort_by = $params['sort_by'] ?? 'date'; // date, rating_high, rating_low

            // 2. Build base query
            $query = KCPPatientReview::query();

            // 3. Apply filters
            if (!empty($doctor_id)) {
                $query->where('doctorId', '=', $doctor_id);
            }
            if (!empty($patient_id)) {
                $query->where('patientId', '=', $patient_id);
            }

            // 4. Apply sorting
            switch ($sort_by) {
                case 'rating_high':
                    $query->orderBy('review', 'DESC');
                    break;
                case 'rating_low':
                    $query->orderBy('review', 'ASC');
                    break;
                case 'date':
                default:
                    $query->orderBy('createdAt', 'DESC');
                    break;
            }

            // 5. Get total count for pagination
            $total_count = $query->count();

            // 6. Apply pagination
            $reviews = $query->limit($per_page)
                ->offset(($page - 1) * $per_page)
                ->get();

            // 7. Collect unique IDs for related data
            $patient_ids = $reviews->pluck('patientId')->unique()->toArray();
            $doctor_ids = $reviews->pluck('doctorId')->unique()->toArray();

            // 8. Fetch doctor data for all doctors in reviews
            $doctor_data_map = [];
            if (!empty($doctor_ids)) {
                $doctors = KCDoctor::query()
                    ->whereIn('id', $doctor_ids)
                    ->get();
                foreach ($doctors as $doctor) {
                    $user_data = get_userdata($doctor->user_id);
                    $profile_image_id = get_user_meta($doctor->user_id, 'doctor_profile_image', true);
                    $profile_image_url = $profile_image_id ? wp_get_attachment_url($profile_image_id) : '';
                    
                    $doctor_data_map[$doctor->id] = [
                        'id' => $doctor->id,
                        'name' => $doctor->displayName,
                        'email' => $user_data ? $user_data->user_email : '',
                        'doctor_image_url' => $profile_image_url,
                    ];
                }
            }

            // Ensure doctor data is fetched if doctor_id is provided
            if (!empty($doctor_id) && !isset($doctor_data_map[$doctor_id])) {
                $doctor = KCDoctor::find($doctor_id);
                if ($doctor) {
                    $user_data = get_userdata($doctor->user_id);
                    $profile_image_id = get_user_meta($doctor->user_id, 'doctor_profile_image', true);
                    $profile_image_url = $profile_image_id ? wp_get_attachment_url($profile_image_id) : '';
                    
                    $doctor_data_map[$doctor->id] = [
                        'id' => $doctor->id,
                        'name' => $doctor->displayName,
                        'email' => $user_data ? $user_data->user_email : '',
                        'doctor_image_url' => $profile_image_url,
                    ];
                }
            }

            // 9. Fetch patient names
            $patient_names = [];
            if (!empty($patient_ids)) {
                $patients = KCPatient::query()
                    ->whereIn('id', $patient_ids)
                    ->get();
                foreach ($patients as $patient) {
                    $patient_names[$patient->id] = $patient->displayName;
                }
            }

            // 10. Get doctor_data for top-level response (when doctor_id filter is provided)
            $doctor_data = null;
            if (!empty($doctor_id) && isset($doctor_data_map[$doctor_id])) {
                $doctor_data = $doctor_data_map[$doctor_id];
            }

            // 11. Calculate rating statistics
            $stats = (object) [
                'total_reviews' => 0,
                'avg_rating' => 0
            ];

            if (!empty($doctor_id)) {
                $reviews_stats = KCPPatientReview::query()
                    ->where('doctorId', '=', $doctor_id)
                    ->get();

                $stats->total_reviews = $reviews_stats->count();
                $stats->avg_rating = $stats->total_reviews > 0
                    ? round($reviews_stats->sum('review') / $stats->total_reviews, 1)
                    : 0;
            }

            // 12. Format reviews
            $formatted_reviews = $reviews->map(function ($review) use ($patient_names, $doctor_data_map) {
                $patient_profile_id = get_user_meta($review->patientId, 'patient_profile_image', true);
                $patient_profile_url = $patient_profile_id ? wp_get_attachment_url($patient_profile_id) : '';
                
                return [
                    'id' => $review->id,
                    'rating' => $review->review,
                    'review_text' => $review->reviewDescription,
                    'patient_id' => $review->patientId,
                    'patient_profile_url' => $patient_profile_url,
                    'patient_name' => $patient_names[$review->patientId] ?? '',
                    'doctor_id' => $review->doctorId,
                    'doctor_name' => $doctor_data_map[$review->doctorId]['name'] ?? '',
                    'doctor_email' => $doctor_data_map[$review->doctorId]['email'] ?? '',
                    'doctor_image_url' => $doctor_data_map[$review->doctorId]['doctor_image_url'] ?? '',
                    'created_at' => $review->createdAt,
                    'updated_at' => $review->updatedAt
                ];
            });

            // compute distribution counts grouped by 'review' (rating)
             $distribution_query = KCPPatientReview::query()
                 ->select(['review', 'COUNT(*) as count']);

             if (!empty($doctor_id)) {
                 $distribution_query->where('doctorId', '=', $doctor_id);
             }

             $distribution_rows = $distribution_query->groupBy('review')
                 ->get()->toArray();

            // initialize with zeros
            $distribution = [
                5 => 0,
                4 => 0,
                3 => 0,
                2 => 0,
                1 => 0,
            ];

            // map results into the distribution
            foreach ($distribution_rows as $row) {
                $rating = intval($row->review);
                $distribution[$rating] = intval($row->count);
            }

            // 13. Prepare response
            $response_data = [
                'reviews' => $formatted_reviews->toArray(),
                'pagination' => [
                    'total' => intval($total_count),
                    'page' => $page,
                    'per_page' => $per_page,
                    'total_pages' => ceil($total_count / $per_page),
                    'has_more' => $page < ceil($total_count / $per_page)
                ],
                'distribution' => $distribution,
                'doctor_data' => $doctor_data,
                'avg_rating' => floatval($stats->avg_rating ?? 0),
                'total_reviews' => intval($stats->total_reviews ?? 0)
            ];

            return $this->response($response_data, __('Reviews retrieved successfully.', 'kivicare-pro'));

        } catch (\Exception $e) {
            return $this->response(
                ['error' => $e->getMessage()],
                __('Failed to retrieve reviews.', 'kivicare-pro'),
                false,
                500
            );
        }
    }

    /**
     * Delete a review
     */
    public function deleteReview(WP_REST_Request $request): WP_REST_Response
    {
        try {
            $params = $request->get_params();
            $review_id = $params['review_id'] ?? null;

            if (empty($review_id)) {
                return $this->response(
                    null,
                    __('Review ID is required.', 'kivicare-pro'),
                    false,
                    400
                );
            }

            // Check if review exists
            $existing_review = KCPPatientReview::find($review_id);

            if (!$existing_review) {
                return $this->response(
                    null,
                    __('Review not found.', 'kivicare-pro'),
                    false,
                    404
                );
            }

            // Verify ownership or admin permission
            $current_user_id = get_current_user_id();
            $current_user_role = $this->kcbase->getLoginUserRole();

            if (
                $current_user_role !== 'administrator' &&
                $existing_review->patientId != $current_user_id
            ) {
                return $this->permissionDeniedResponse();
            }

            // Delete review
            $result = $existing_review->delete();

            if (!$result) {
                return $this->response(
                    null,
                    __('Failed to delete review. Please try again.', 'kivicare-pro'),
                    false,
                    500
                );
            }

            return $this->response(
                null,
                __('Review deleted successfully.', 'kivicare-pro')
            );

        } catch (\Exception $e) {
            return $this->response(
                ['error' => $e->getMessage()],
                __('Failed to delete review.', 'kivicare-pro'),
                false,
                500
            );
        }
    }

    /**
     * Verify if a patient is associated with a doctor
     */
    private function verifyDoctorPatientAssociation($doctor_id, $patient_id): bool
    {
        try {
            // Check if there's any appointment between this doctor and patient
            $appointment_count = KCAppointment::table('a')
                ->where('a.doctor_id', '=', $doctor_id)
                ->where('a.patient_id', '=', $patient_id)
                ->count();

            return $appointment_count > 0;

        } catch (\Exception $e) {
            KCErrorLogger::instance()->error('Error verifying doctor-patient association: ' . $e->getMessage());
            return false;
        }
    }

    /**
     * Validate appointment for review submission
     */
    public function validateAppointmentReview($value, $request, $param)
    {
        // Check if appointment exists
        $appointment = KCAppointment::find($value);
        if (!$appointment) {
            return new WP_Error('rest_invalid_param', __('Appointment not found.', 'kivicare-pro'), ['status' => 404]);
        }

        // Check if user has permission to review this appointment
        $current_user_id = get_current_user_id();
        $current_user_role = $this->kcbase->getLoginUserRole();

        // Only patients can submit reviews, and only for their own appointments
        if ($current_user_role !== 'administrator' && $appointment->patientId != $current_user_id) {
            return new WP_Error('rest_forbidden', __('You can only submit reviews for your own appointments.', 'kivicare-pro'), ['status' => 403]);
        }

        // Check if review already exists for this appointment
        $existing_review = KCPPatientReview::query()
            ->where('patientId', '=', $appointment->patientId)
            ->where('doctorId', '=', $appointment->doctorId)
            ->first();

        if ($existing_review) {
            return new WP_Error('rest_invalid_param', __('A review already exists for this patient-doctor combination.', 'kivicare-pro'), ['status' => 400]);
        }

        return true;
    }

    /**
     * Check permission for rating module operations
     */
    public function checkPermission($request)
    {
        // Determine action from request route
        $route = $request->get_route();
        $action = null;

        if (strpos($route, '/add') !== false) {
            $action = 'add';
        } elseif (strpos($route, '/update') !== false || strpos($route, '/delete') !== false) {
            $action = 'edit';
        } elseif (strpos($route, '/list') !== false) {
            $action = 'get';
        }

        // Map actions to capabilities
        $capabilities = [
            'add' => 'patient_review_add',
            'edit' => 'patient_review_edit',
            'get' => 'patient_review_get',
        ];

        $capability = $capabilities[$action] ?? 'patient_review_get';

        return $this->checkCapability($capability, $request);
    }
}