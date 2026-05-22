<?php


namespace KCProApp\controllers\filters;

use App\controllers\api\AppointmentsController;
use App\models\KCAppointment;
use App\models\KCAppointmentServiceMapping;
use App\models\KCService;
use App\models\KCServiceDoctorMapping;
use Illuminate\Support\Collection;
use KCProApp\helper\KCPTaxCalculator;
use KCProApp\models\KCCustomFormData;
use App\models\KCCustomFieldData;
use KCProApp\models\KCPTax;
use KCProApp\models\KCPTaxData;
use KCProApp\models\KCProFollowup;
use KCProApp\models\KCProFollowupActivityLog;
use KCProApp\services\KCProFollowupService;
use App\baseClasses\KCErrorLogger;
use App\models\KCOption;
use WP_REST_Request;

if (!defined('ABSPATH')) {
    exit; // Exit if accessed directly
}
class KCPAppointmentControllerFilters
{
    /**
     * Override the parent method to add custom functionality
     */
    private static ?KCPAppointmentControllerFilters $instance = null;
    public function __construct()
    {
        // Add any additional initializations specific to KCPAppointmentsController here
        add_action('kc_appointment_summary_data', [$this, 'addCustomSummaryData'], 10, 3);

        // Save Appointment Tax Data after payment is processed
        add_action('kivicare_after_payment_processed', [$this, 'saveTaxDataAfterPayment'], 10, 2);

        // Save tax data when provided directly (e.g., from create endpoint 'tax_data' param)
        add_action('kivicare_save_appointment_tax_data', [$this, 'saveTaxDataFromParams'], 10, 2);

        // Get Appointment Tax Data
        add_filter('kivicare_get_tax_data', [$this, 'getTaxData'], 10, 1);

        add_action('kc_appointment_book', [$this, 'addNotification'], 10, 1);

        // Add custom form data to appointment create/update endpoint args
        add_filter('kc_appointment_create_endpoint_args', [$this, 'addCustomFormArgs'], 10, 1);
        add_filter('kc_appointment_update_endpoint_args', [$this, 'addCustomFormArgs'], 10, 1);

        // Allow passing follow-up ID during appointment booking/scheduling
        add_filter('kc_appointment_create_endpoint_args', [$this, 'addFollowupIdArgs'], 10, 1);


        add_action('kc_after_create_appointment', [$this, 'saveCustomFormData'], 10, 3);
        add_action('kc_after_create_appointment', [$this, 'handleFollowupScheduling'], 10, 3);
        
        add_action('kc_appointment_updated', function ($appointmentId, $appointmentData, $updateData, WP_REST_Request $request) {
            $this->saveCustomFormData($appointmentId, $appointmentData, $request);
            $this->handleFollowupCompletion($appointmentId, $appointmentData, $updateData, $request);
        }, 10, 4);

        /** ---------------- CUSTOM FIELDS ---------------- */
        add_action('kc_after_create_appointment', [$this, 'handleCustomFieldsCreate'], 10, 3);
        add_action('kc_appointment_updated', [$this, 'handleCustomFieldsUpdate'], 10, 4);
        add_filter('kc_appointment_data', [$this, 'addCustomFieldDataToResponse'], 10, 2);

        // Create tax for completed appointments
        add_action('kc_appointment_create_tax', [$this, 'createTax'], 10, 6);

        // Booking limit check (pro feature)
        add_filter('kivicare_check_patient_booking_limit', [$this, 'checkPatientBookingLimit'], 10, 5);
    }

    public static function get_instance(): KCPAppointmentControllerFilters|null
    {
        if (!isset(self::$instance)) {
            self::$instance = new self();
        }
        return self::$instance;
    }


    public function getTaxData($appointmentId)
    {
        $taxs = KCPTaxData::get_tax(['module_type' => 'appointment', 'module_id' => $appointmentId]);
        $total_tax = 0.0;
        $taxData = [];
        // If module_id is present, do not calculate (use stored tax data)
        foreach ($taxs as $tax) {
            $taxData[] = [
                'id' => $tax->taxId ?? $tax->id,
                'tax_name' => $tax->taxName ?? $tax->name,
                'tax_type' => $tax->taxType ?? $tax->type,
                'tax_value' => $tax->taxValue,
                'tax_amount' => $tax->charges ?? 0,
            ];
            $total_tax += isset($tax->charges) ? floatval($tax->charges) : 0;
        }
        return [
            'tax_data' => $taxData,
            'total_tax' => round($total_tax,2),
        ];
    }
    /**
     * Save tax data for the appointment.
     *
     * @param integer    $appointmentId The appointment id
     * @param array      $params        Additional parameters for the appointment.
     * @param Collection $services      The collection of services associated with the appointment.
     *
     * @return void
     */
    public function saveTaxData($appointmentId, $params, $services)
    {
        $calculator = $this->initializeTaxCalculator($params, $services);

        if (!$calculator) {
            return;
        }

        $calculatedTaxes = $calculator->getCalculatedTaxes();

        // Remove existing tax records for the appointment to avoid duplicates
        KCPTaxData::query()
            ->where('module_id', (int) $appointmentId)
            ->where('module_type', 'appointment')
            ->delete();

        foreach ($calculatedTaxes as $index => $taxItem) {
            $taxData = new KCPTaxData();
            $taxData->moduleType = 'appointment';
            $taxData->moduleId = (int) $appointmentId;
            $taxData->name = $taxItem['tax_name'] ?? '';
            $taxData->charges = isset($taxItem['tax_amount']) ? (string) $taxItem['tax_amount'] : '0';
            $taxData->taxValue = isset($taxItem['tax_value']) ? (string) $taxItem['tax_value'] : '0';
            $taxData->taxType = $taxItem['tax_type'] ?? '';

            $taxData->save();
        }
    }


    /**
     * Save tax data after payment is processed.
     * This method is called by the kivicare_after_payment_processed hook.
     *
     * @param int   $appointmentId The appointment ID
     * @param array $paymentData   The payment response data
     * @return void
     */
    public function saveTaxDataAfterPayment($appointmentId, $paymentData)
    {
        // Get the appointment
        $appointment = KCAppointment::find($appointmentId);

        if (!$appointment) {
            return;
        }

        // Get the services associated with the appointment
        $services = KCAppointmentServiceMapping::table('asm')
            ->select([
                'asm.id as mapping_id',
                'asm.service_id',
                'sdm.id',
                'sdm.service_id as serviceId',
                'sdm.charges',
                's.name',
                's.id as service_id_ref'
            ])
            ->leftJoin(KCService::class, 'asm.service_id', '=', 's.id', 's')
            ->leftJoin(KCServiceDoctorMapping::class, 'sdm.service_id', '=', 's.id', 'sdm')
            ->where('asm.appointment_id', $appointmentId)
            ->where('sdm.doctor_id', $appointment->doctorId)
            ->where('sdm.clinic_id', $appointment->clinicId)
            ->get();

        if ($services->isEmpty()) {
            return;
        }
        // Build params for tax calculation
        $params = [
            'clinicId' => $appointment->clinicId,
            'doctorId' => $appointment->doctorId,
            'services' => $services,
        ];

        // Save tax data using existing method
        $this->saveTaxData($appointmentId, $params, $services);
    }

    /**
     * Save tax data when provided directly via API params (e.g., 'tax_data' on create/update)
     *
     * @param int $appointmentId
     * @param array $taxData
     * @return void
     */
    public function saveTaxDataFromParams($appointmentId, $taxData)
    {
        if (empty($taxData) || !is_array($taxData)) {
            return;
        }

        // Remove existing tax records for the appointment to avoid duplicates
        KCPTaxData::query()
            ->where('module_id', (int) $appointmentId)
            ->where('module_type', 'appointment')
            ->delete();

        foreach ($taxData as $taxItem) {
            if (!is_array($taxItem)) {
                continue;
            }

            $name = sanitize_text_field($taxItem['tax_name'] ?? $taxItem['name'] ?? '');
            if ($name === '') {
                continue;
            }

            $charges = $taxItem['tax_amount'] ?? $taxItem['charges'] ?? 0;
            $taxValue = $taxItem['tax_value'] ?? $taxItem['taxValue'] ?? 0;
            $taxType = sanitize_text_field($taxItem['tax_type'] ?? $taxItem['taxType'] ?? '');

            $record = new KCPTaxData();
            $record->moduleType = 'appointment';
            $record->moduleId = (int) $appointmentId;
            $record->name = $name;
            $record->charges = (string) $charges;
            $record->taxValue = (string) $taxValue;
            $record->taxType = $taxType;
            $record->save();
        }
    }

    /**
     * Add custom summary data to the appointment summary.
     *
     * @param array $summaryData The current summary data.
     * @param array $params Additional parameters for the appointment.
     */
    public function addCustomSummaryData(&$summaryData, $params, Collection $services)
    {
        // Initialize the tax calculator
        $calculator = $this->initializeTaxCalculator($params, $services);

        $summaryData['tax'] = $calculator->getTotalTax();
        $summaryData['applied_taxes'] = $calculator->getCalculatedTaxes();
        $summaryData['grand_total'] = $calculator->getGrandTotal();
    }

    /**
     * Initialize and return a tax calculator instance for the given services and parameters.
     *
     * @param array      $params   The parameters for the appointment.
     * @param Collection $services The collection of services associated with the appointment.
     * @return KCPTaxCalculator The tax calculator instance.
     */
    private function initializeTaxCalculator($params, Collection $services)
    {
        $calculator = new KCPTaxCalculator();

        $services->each(function ($service, $index) use ($calculator, $params) {
            // Fetch applicable taxes for this service
            $taxQueryParams = array_merge($params, ['services' => [$service->id]]);
            $taxes = KCPTax::getTaxes($taxQueryParams);
            // Add service to calculator
            $calculator->addService(
                $service->id,
                $service->name,
                $service->charges,
                1
            );

            // Add taxes to calculator
            $taxes->each(function ($tax) use ($calculator, $service) {
                KCErrorLogger::instance()->error(
                    'KCPro Tax: Adding tax to calculator | ' .
                    'Tax ID: ' . $tax->id .
                    ', Name: ' . $tax->name .
                    ', Type: ' . $tax->taxType .
                    ', Value: ' . $tax->taxValue .
                    ', Service ID: ' . $service->id
                );

                $calculator->addTax(
                    $tax->id,
                    $tax->name,
                    $tax->taxType,
                    $tax->taxValue,
                    [$service->id]
                );
            });
        });

        $calculator->calculate();
        return $calculator;
    }

    /**
     * Add custom form data argument to appointment create/update endpoints
     *
     * @param array $args The current endpoint arguments
     * @return array Modified arguments with customForm support
     */
    public function addCustomFormArgs($args)
    {
        $args['customForm'] = [
            'description' => 'Custom form data for appointment',
            'type' => 'object',
            'validate_callback' => function ($param) {
                // Validate that customForm is an object with form IDs as keys
                if (!is_array($param) && !is_object($param)) {
                    return false;
                }

                // Convert to array if it's an object
                $formData = is_object($param) ? (array) $param : $param;

                // Validate each form entry
                foreach ($formData as $formId => $formFields) {
                    // Form ID should be numeric
                    if (!is_numeric($formId)) {
                        return false;
                    }

                    // Form fields should be an array/object
                    if (!is_array($formFields) && !is_object($formFields)) {
                        return false;
                    }
                }

                return true;
            },
            'sanitize_callback' => function ($param) {
                // Ensure the data is properly sanitized
                if (!is_array($param) && !is_object($param)) {
                    return [];
                }

                $sanitize_recursive = function ($data) use (&$sanitize_recursive) {
                    $sanitized = [];
                    foreach ($data as $key => $value) {
                        // Sanitize field keys
                        $sanitizedKey = sanitize_text_field($key);

                        if (is_array($value) || is_object($value)) {
                            // Recursively sanitize arrays/objects
                            $sanitized[$sanitizedKey] = $sanitize_recursive((array) $value);
                        } elseif (is_string($value)) {
                            // Sanitize strings
                            if($key === 'url' || $key === 'link'){
                                $sanitized[$sanitizedKey] = esc_url_raw($value);
                            }else{
                                $sanitized[$sanitizedKey] = sanitize_text_field($value);
                            }
                        } elseif (is_bool($value) || is_numeric($value) || is_null($value)) {
                            // Keep booleans, numbers, and nulls as is
                            $sanitized[$sanitizedKey] = $value;
                        } else {
                            // For other types, convert to string and sanitize
                            $sanitized[$sanitizedKey] = sanitize_text_field((string) $value);
                        }
                    }
                    return $sanitized;
                };

                $formData = is_object($param) ? (array) $param : $param;
                $sanitized = [];
                foreach ($formData as $formId => $formFields) {
                    $sanitized[$formId] = $sanitize_recursive((array) $formFields);
                }

                return $sanitized;
            },
        ];

        return $args;
    }

    /**
     * Allows followup_id tracking parameter to pass through the Appointments endpoints
     *
     * @param array $args The current endpoint arguments
     * @return array Modified arguments with followup_id support
     */
    public function addFollowupIdArgs($args)
    {
        if (!isset($args['followup_id'])) {
            $args['followup_id'] = [
                'required' => false,
                'type' => 'integer',
                'description' => 'Links this appointment to an existing Follow-up task',
                'sanitize_callback' => 'absint'
            ];
        }
        return $args;
    }

    public function saveCustomFormData($appointmentId, $appointmentData, WP_REST_Request $request)
    {
        // Check if custom form data exists in the request
        $customFormData = $request->get_param('customForm');
        if (empty($customFormData)) {
            return;
        }

        // Ensure it's an array
        if (!is_array($customFormData)) {
            return;
        }

        // Save each form's data
        foreach ($customFormData as $formId => $formFields) {
            // Validate form ID is numeric
            if (!is_numeric($formId)) {
                continue;
            }

            // Ensure form fields is an array
            if (!is_array($formFields)) {
                continue;
            }

            // Check if record already exists for this form and appointment
            $existingRecord = KCCustomFormData::query()
                ->where('form_id', (int) $formId)
                ->where('module_id', (int) $appointmentId)
                ->first();

            if ($existingRecord) {
                // Update existing record
                $existingRecord->formData = wp_json_encode($formFields);
                $existingRecord->save();
            } else {
                // Create new record
                $customFormEntry = new KCCustomFormData();
                $customFormEntry->formId = (int) $formId;
                $customFormEntry->formData = wp_json_encode($formFields);
                $customFormEntry->moduleId = (int) $appointmentId;
                $customFormEntry->save();
            }
        }
    }

    /**
     * Handles Follow-up Scheduling Logic upon successful Appointment creation.
     * Updates Follow-up status to scheduled if valid.
     * 
     * @param int $appointmentId
     * @param array $appointmentData
     * @param WP_REST_Request $request
     */
    public function handleFollowupScheduling($appointmentId, $appointmentData, WP_REST_Request $request)
    {
        $followupId = $request->get_param('followup_id');
        
        if (empty($followupId)) {
            return;
        }

        // Fetch the followup record
        $followup = KCProFollowup::find($followupId);
        
        if (!$followup) {
            KCErrorLogger::instance()->error("KCPro Followup Scheduling Failed: Follow-up ID {$followupId} not found.");
            return; 
        }

        // Extremely strict validation: the Follow-up target Patient and Doctor must physically match the Appointment Data
        if ((int)$followup->patient_id === (int)$appointmentData['patientId'] && 
            (int)$followup->doctor_id === (int)$appointmentData['doctorId']) {
            
            // If appointment date differs, update follow-up suggested date boundaries
            $appointmentDate = $appointmentData['appointmentStartDate'] ?? null;
            if (!empty($appointmentDate)) {
                $doctorTimezone = get_user_meta($followup->doctor_id, 'kivicare_timezone', true) ?: wp_timezone_string();
                try {
                    $boundaries = KCProFollowupService::get_instance()
                        ->calculateFollowupUtcBoundaries($doctorTimezone, $appointmentDate);
                    $followup->suggested_date_utc = $boundaries['suggested_date_utc'];
                    $followup->suggested_deadline_utc = $boundaries['suggested_deadline_utc'];
                } catch (\Exception $e) {
                    KCErrorLogger::instance()->error(
                        "KCPro Followup Scheduling Date Update Failed: Follow-up {$followupId}, " .
                        "appointment date {$appointmentDate}. Error: " . $e->getMessage()
                    );
                }
            }

            $followup->status = 'scheduled';
            $followup->scheduled_appointment_id = $appointmentId;
            $followup->updated_at_utc = gmdate('Y-m-d H:i:s');
            $followup->updated_by = get_current_user_id() ?: $appointmentData['doctorId'];
            $followup->save();

            // Log activity
            KCProFollowupActivityLog::create([
                'followup_id' => $followup->id,
                'user_id' => get_current_user_id() ?: $appointmentData['doctorId'],
                'action' => 'status_updated',
                'new_status' => 'scheduled',
                'created_at_utc' => gmdate('Y-m-d H:i:s'),
                'notes' => 'Appointment #' . $appointmentId . ' scheduled.'
            ]);
            
        } else {
             KCErrorLogger::instance()->error(
                 "KCPro Followup Scheduling Security Mismatch: Follow-up {$followupId} (Patient {$followup->patient_id}, Doctor {$followup->doctor_id}) " .
                 "does not match Appointment {$appointmentId} (Patient " . $appointmentData['patientId'] . ", Doctor " . $appointmentData['doctorId'] . ")"
             );
        }
    }

    /**
     * Handles Follow-up auto-completion upon Appointment close.
     * Updates Follow-up status to completed if the linked appointment is closed.
     * 
     * @param int $appointmentId
     * @param array | KCAppointment $appointmentData
     * @param array $updateData
     * @param WP_REST_Request $request
     */
    public function handleFollowupCompletion($appointmentId, $appointmentData, $updateData, WP_REST_Request $request)
    {
        if($updateData instanceof KCAppointment) {
            $status = $updateData->status;
        } else {
            $status = $updateData['status'] ?? $appointmentData['status'] ?? null;
        }
        
        // In KiviCare, 'close' or 'checkout' typically indicate a finished appointment
        if (in_array($status, [KCAppointment::STATUS_CHECK_OUT])) {
            $followups = KCProFollowup::query()->where('scheduled_appointment_id', $appointmentId)->get();
            
            if ($followups && !$followups->isEmpty()) {
                foreach ($followups as $followup) {
                    if ($followup->status === 'scheduled') {
                        $followup->status = 'completed';
                        $followup->updated_at_utc = gmdate('Y-m-d H:i:s');
                        $followup->updated_by = get_current_user_id();
                        $followup->save();

                        // Log activity
                        KCProFollowupActivityLog::create([
                            'followup_id' => $followup->id,
                            'user_id' => get_current_user_id(),
                            'action' => 'status_updated',
                            'new_status' => 'completed',
                            'created_at_utc' => gmdate('Y-m-d H:i:s'),
                            'notes' => 'Auto-completed via Appointment #' . $appointmentId . ' closing.'
                        ]);
                    }
                }
            }
        }
    }

    /**
     * Create bill and tax for completed appointments.
     *
     * @param int $appointmentId The appointment ID.
     * @param array $appointmentData The appointment data.
     * @param array $params Additional parameters.
     * @param Collection $services The services collection.
     * @param int $encounterId The encounter ID.
     * @return void
     */
    public function createTax($appointmentId, $appointmentData, $params, $services, $encounterId, $billId = null)
    {
        // Get the Bill created by Core
        $bill = null;
        if ($billId) {
            $bill = \App\models\KCBill::find($billId);
        }
        
        if (empty($bill)) {
            $bill = \App\models\KCBill::query()->where('appointment_id', $appointmentId)->first();
        }

        if (!$bill) {
            return;
        }

        // Calculate tax
        $services->each(function ($service) {
            $service->id = $service->serviceId ?? $service->service_id_ref ?? $service->service_id;
        });
        $calculator = $this->initializeTaxCalculator($params, $services);
        $totalTax = $calculator->getTotalTax();

        // Update bill with tax added to the existing total/actual amount
        // Note: The bill created by core already has the service charges summed up in totalAmount.
        // We just need to add the tax.
        
        // It's safer to use calculator's grand total to ensure consistency
        $grandTotal = $calculator->getGrandTotal();
        
        $bill->totalAmount = $bill->totalAmount;
        $bill->actualAmount = $grandTotal;
        $bill->save();

        // Save tax data unless explicitly disabled via params (e.g., updateStatus should set 'save_tax' => false)
        if (!isset($params['save_tax']) || $params['save_tax'] !== false) {
            $this->saveTaxData($appointmentId, $params, $services);
        }
    }

    public function addCustomFieldDataToResponse(array $response, int $appointmentId): array
    {
        $records = KCCustomFieldData::query()
            ->where('module_type', 'appointment_module')
            ->where('module_id', $appointmentId)
            ->get();

        $response['custom_fields'] = [];

        foreach ($records as $record) {
            $decoded = json_decode($record->fieldsData, true);

            $response['custom_fields'][$record->fieldId] =
                json_last_error() === JSON_ERROR_NONE ? $decoded : $record->fieldsData;
        }

        return $response;
    }

    public function handleCustomFieldsCreate($appointmentId, $appointmentData, WP_REST_Request $request): void
    {
        $this->saveCustomFieldData($appointmentId, $request->get_param('customFields') ?? []);
    }

    public function handleCustomFieldsUpdate($appointmentId, $updateData, $appointment, WP_REST_Request $request): void
    {
        $this->saveCustomFieldData($appointmentId, $request->get_param('customFields') ?? []);
    }

    private function saveCustomFieldData(int $appointmentId, array $fields): void
    {
        foreach ($fields as $fieldId => $value) {
            $existing = KCCustomFieldData::query()
                ->where('module_type', 'appointment_module')
                ->where('module_id', $appointmentId)
                ->where('field_id', (int) $fieldId)
                ->first();

            $data = $existing ?? new KCCustomFieldData();
            $data->moduleType = 'appointment_module';
            $data->moduleId = $appointmentId;
            $data->fieldId = (int) $fieldId;
            $data->fieldsData = is_array($value) ? wp_json_encode($value) : sanitize_text_field((string) $value);
            $data->createdAt = current_time('mysql');
            $data->save();
        }
    }

    /**
     * Check whether a patient has exceeded the booking limit for the given appointment date/time.
     *
     * Hooked onto 'kivicare_check_patient_booking_limit' filter.
     * Returns a WP_REST_Response error if the limit is exceeded, or null if the booking is allowed.
     *
     * @param \WP_REST_Response|null $result        Passed-in value (null by default).
     * @param int                    $patientId
     * @param string                 $appointmentDate  Y-m-d
     * @param string                 $appointmentTime  H:i or H:i:s
     * @param string                 $timezone
     * @return \WP_REST_Response|null
     */
    public function checkPatientBookingLimit($result, int $patientId, string $appointmentDate, string $appointmentTime, string $timezone = ''): ?\WP_REST_Response
    {
        $settings = KCOption::get('booking_limit_setting', []);

        if (empty($settings['customer_appointment_limit_enabled'])) {
            return null;
        }

        $capacity = max(1, (int) ($settings['allowed_capacity'] ?? 1));
        $duration = max(1, (int) ($settings['duration'] ?? 1));
        $interval = $settings['interval'] ?? 'day';

        // Convert appointment local datetime to UTC (same as how the model stores appointment_start_utc)
        $tzString      = $this->formatTimezoneString($timezone);
        $wpTimezone    = new \DateTimeZone($tzString);
        $utcTimezone   = new \DateTimeZone('UTC');
        $appointmentDT = new \DateTime($appointmentDate . ' ' . $appointmentTime, $wpTimezone);
        $appointmentDT->setTimezone($utcTimezone);
        $windowStart   = clone $appointmentDT;

        // Build the window: look back <duration> <interval>s from the appointment UTC datetime
        switch ($interval) {
            case 'hour':
                $windowStart->modify("-{$duration} hours");
                break;
            case 'week':
                $days = $duration * 7;
                $windowStart->modify("-{$days} days");
                break;
            case 'month':
                $windowStart->modify("-{$duration} months");
                break;
            case 'day':
            default:
                $windowStart->modify("-{$duration} days");
                break;
        }

        $count = KCAppointment::query()
            ->where('patient_id', '=', $patientId)
            ->where('status', '!=', KCAppointment::STATUS_CANCELLED)
            ->where('appointment_start_utc', '>=', $windowStart->format('Y-m-d H:i:s'))
            ->where('appointment_start_utc', '<=', $appointmentDT->format('Y-m-d H:i:s'))
            ->count();

        if ($count >= $capacity) {
            $appointmentLabel = $capacity === 1 ? 'appointment' : 'appointments';
            $intervalLabel    = $duration > 1 ? $interval . 's' : $interval;

            return rest_ensure_response(new \WP_REST_Response([
                'status'  => false,
                'message' => sprintf(
                    /* translators: 1: max appointments, 2: appointment label, 3: duration number, 4: interval unit */
                    __('Booking limit exceeded. You can only book %1$d %2$s every %3$d %4$s.', 'kivicare-clinic-management-system'),
                    $capacity,
                    $appointmentLabel,
                    $duration,
                    $intervalLabel
                ),
                'data'    => ['error' => 'booking_limit_exceeded'],
            ], 429));
        }

        return null;
    }

    /**
     * Normalise a timezone string to a value accepted by \DateTimeZone.
     *
     * Supports named identifiers (e.g. "America/New_York"), UTC offset strings
     * (e.g. "UTC+5.5", "UTC-05:30"), and falls back to the WordPress site timezone.
     *
     * @param string $timezone
     * @return string
     */
    private function formatTimezoneString(string $timezone): string
    {
        if (empty($timezone)) {
            return wp_timezone_string();
        }

        if (in_array($timezone, timezone_identifiers_list(\DateTimeZone::ALL_WITH_BC), true)) {
            return $timezone;
        }

        // Handle manual UTC offsets: UTC+2, UTC-5.5, UTC+05:30
        if (preg_match('/^UTC([+-])([0-9]+)(?:\.([0-9]+))?(?::([0-9]+))?$/i', $timezone, $matches)) {
            $sign    = $matches[1];
            $hours   = intval($matches[2]);
            $minutes = 0;

            if (isset($matches[3]) && $matches[3] !== '') {
                $minutes = (int) round(floatval('0.' . $matches[3]) * 60);
            } elseif (isset($matches[4]) && $matches[4] !== '') {
                $minutes = intval($matches[4]);
            }

            return sprintf('%s%02d:%02d', $sign, $hours, $minutes);
        }

        return wp_timezone_string();
    }

}