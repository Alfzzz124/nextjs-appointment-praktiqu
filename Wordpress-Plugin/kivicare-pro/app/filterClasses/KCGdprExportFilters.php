<?php

namespace KCProApp\filterClasses;

use App\baseClasses\KCBase;
use App\models\KCMedicalHistory;
use App\models\KCAppointment;
use App\models\KCPrescription;
use App\models\KCPatientEncounter;
use App\models\KCClinic;
use App\models\KCPatientMedicalReport;
use App\models\KCPaymentsAppointmentMapping;
use App\models\KCBill;
use App\models\KCBillItem;
use App\models\KCService;
use App\models\KCOption;
use KCProApp\models\KCGdprConsent;
use WP_Error;

if (!defined('ABSPATH')) {
    exit;
}

class KCGdprExportFilters extends KCBase
{

    public function __construct()
    {
        add_filter('wp_privacy_personal_data_exporters', [$this, 'kivicare_data_exporter']);

        add_action(
            'transition_post_status',
            [$this, 'generate_export_after_confirmation'],
            10,
            3
        );

        // After WordPress builds the export ZIP, attach report files into it
        add_action(
            'wp_privacy_personal_data_export_file_created',
            [$this, 'attach_reports_to_export_zip'],
            10,
            4
        );

        add_filter('rest_pre_dispatch', [$this, 'blockIfMissingConsent'], 10, 3);
    }

    public function blockIfMissingConsent($result, $server, $request)
    {
        // Early return if already has result or user not logged in
        if ($result !== null || !is_user_logged_in()) {
            return $result;
        }

        $user = wp_get_current_user();
        
        // Skip non-patient users
        if (!$user || empty($user->roles) || !in_array('kiviCare_patient', $user->roles)) {
            return $result;
        }

        // Get GDPR settings
        $settings = KCOption::get('gdpr_consent_settings', []);
        if (empty($settings['enable_gdpr'])) {
            return $result;
        }

        // Extract required consent types
        $mandatory = $settings['mandatory_consents'] ?? [];
        $requiredTypes = array_keys(array_filter($mandatory));
        
        // Skip if no consents required
        if (empty($requiredTypes)) {
            return $result;
        }

        // Skip allowed routes (consent-related and essential endpoints)
        $route = '/' . ltrim((string) $request->get_route(), '/');
        $allowedRoutes = [
            '/kivicare/v1/auth',
            '/kivicare/v1/config',
            '/kivicare/v1/static_data',
            '/kivicare/v1/pro/gdpr-consent',
            '/kivicare/v1/frontend/kc-book-appointment/get-widget-settings',
            '/kivicare/v1/pro/gdpr-settings' // Added for configuration resolution
        ];
        
        foreach ($allowedRoutes as $allowedRoute) {
            if (strpos($route, $allowedRoute) === 0) {
                return $result;
            }
        }

        // Get current consent version
        $version = (string) ($settings['consent_version'] ?? $settings['version'] ?? '1.0');
        
        // Check user's latest consents with single query
        try {
            $userConsents = KCGdprConsent::table('c')
                ->select(['c.consent_type', 'c.status'])
                ->where('c.user_id', (int) $user->ID)
                ->where('c.consent_version_id', $version)
                ->whereIn('c.consent_type', $requiredTypes)
                ->orderBy('c.id', 'desc')
                ->get()
                ->keyBy('consent_type')
                ->map(fn($item) => $item->status)
                ->toArray();

            // Check if all required consents are granted
            foreach ($requiredTypes as $type) {
                if (($userConsents[$type] ?? '') !== 'granted') {
                    return new WP_Error(
                        'kc_gdpr_reconsent_required',
                        __('Please review and accept the updated Privacy Policy and Terms & Conditions to continue.', 'kivicare-pro'),
                        ['status' => 403, 'requires_reconsent' => true, 'consent_version' => $version]
                    );
                }
            }
        } catch (\Exception $e) {
            // Log error but allow access to prevent breaking the app
            error_log('GDPR consent validation error: ' . $e->getMessage());
            return $result;
        }

        return $result;
    }

    public function generate_export_after_confirmation($new_status, $old_status, $post)
    {
        if ($post->post_type !== 'user_request') {
            return;
        }

        if ($post->post_name !== 'export_personal_data') {
            return;
        }

        if ($old_status !== 'request-pending' || $new_status !== 'request-confirmed') {
            return;
        }
    }

    public function kivicare_data_exporter($exporters)
    {
        if (!isset($exporters['kivicare-data'])) {
            $exporters['kivicare-data'] = [
                'exporter_friendly_name' => __('KiviCare Data', 'kivicare-pro'),
                'callback' => [$this, 'kivicare_data_export_callback'],
            ];
        }
        return $exporters;
    }

    public function kivicare_data_export_callback($email_address, $page = 1)
    {
        $user = get_user_by('email', $email_address);
        if (!$user) {
            return [
                'data' => [],
                'done' => true,
            ];
        }

        $patient_data  = $this->collectPatientData($user->ID);
        $export_items  = [];

        // Stash report file paths so the ZIP hook can bundle them later
        if (!empty($patient_data['report_file_paths'])) {
            set_transient(
                'kc_export_report_files_' . $user->ID,
                $patient_data['report_file_paths'],
                15 * MINUTE_IN_SECONDS
            );
        }

        // Section definitions: [ group_id, group_label, section_key, item_label_callback ]
        $sections = [
            [
                'group_id'    => 'kivicare-personal-info',
                'group_label' => __('KiviCare – Personal Information', 'kivicare-pro'),
                'key'         => 'personal_info',
                'single'      => true,   
            ],
            [
                'group_id'    => 'kivicare-export-info',
                'group_label' => __('KiviCare – Export Metadata', 'kivicare-pro'),
                'key'         => 'export_info',
                'single'      => true,
            ],
            [
                'group_id'    => 'kivicare-appointments',
                'group_label' => __('KiviCare – Appointments', 'kivicare-pro'),
                'key'         => 'appointments',
                'single'      => false,
            ],
            [
                'group_id'    => 'kivicare-reports',
                'group_label' => __('KiviCare – Reports', 'kivicare-pro'),
                'key'         => 'lab_tests',
                'single'      => false,
            ],
            [
                'group_id'    => 'kivicare-payment-history',
                'group_label' => __('KiviCare – Payment History', 'kivicare-pro'),
                'key'         => 'payment_history',
                'single'      => false,
            ],
        ];

        foreach ($sections as $section) {
            $section_data = $patient_data[$section['key']] ?? [];

            if (empty($section_data)) {
                continue;
            }

            if ($section['single']) {
                // Flat key-value section (personal_info, export_info)
                $export_items[] = [
                    'group_id'    => $section['group_id'],
                    'group_label' => $section['group_label'],
                    'item_id'     => $section['group_id'] . '-' . $user->ID,
                    'data'        => $this->format_flat_section($section_data),
                ];
            } else {
                // List of records – each record becomes its own export item
                foreach ($section_data as $index => $record) {
                    $record_id = isset($record['id']) ? $record['id'] : ($index + 1);
                    $export_items[] = [
                        'group_id'    => $section['group_id'],
                        'group_label' => $section['group_label'],
                        'item_id'     => $section['group_id'] . '-' . $record_id,
                        'data'        => $this->format_flat_section($record),
                    ];
                }
            }
        }

        // Encounters: emit details + MH + Rx for each encounter in sequence under one group
        $encounterGroupId    = 'kivicare-encounters';
        $encounterGroupLabel = __('KiviCare – Patient Encounters', 'kivicare-pro');
        $encounterMhMap      = $patient_data['encounter_medical_history'] ?? [];
        $encounterRxMap      = $patient_data['encounter_prescriptions']   ?? [];
        $encountersForExp    = $patient_data['encounters'] ?? [];

        foreach ($encountersForExp as $enc) {
            $encId    = (int) $enc['id'];
            $encLabel = sprintf(__('Encounter #%d', 'kivicare-pro'), $encId);

            // 1. Encounter basic details
            $export_items[] = [
                'group_id'    => $encounterGroupId,
                'group_label' => $encounterGroupLabel,
                'item_id'     => $encounterGroupId . '-' . $encId,
                'data'        => $this->format_flat_section($enc),
            ];

            // 2. Medical history (one item: Problems / Observations / Notes)
            $mhRecords = $encounterMhMap[$encId] ?? [];
            if (!empty($mhRecords)) {
                $problems     = [];
                $observations = [];
                $notes        = [];

                foreach ($mhRecords as $mh) {
                    $type  = strtolower(trim($mh['type'] ?? ''));
                    $title = $mh['title'] ?? '';
                    if ($type === 'problem') {
                        $problems[] = $title;
                    } elseif ($type === 'observation') {
                        $observations[] = $title;
                    } elseif ($type === 'note') {
                        $notes[] = $title;
                    }
                }

                $mhData = [];
                if (!empty($problems)) {
                    $mhData['problems']     = implode(', ', $problems);
                }
                if (!empty($observations)) {
                    $mhData['observations'] = implode(', ', $observations);
                }
                if (!empty($notes)) {
                    $mhData['notes']        = implode(', ', $notes);
                }

                if (!empty($mhData)) {
                    $export_items[] = [
                        'group_id'    => $encounterGroupId,
                        'group_label' => $encounterGroupLabel,
                        'item_id'     => $encounterGroupId . '-' . $encId . '-mh',
                        'data'        => array_merge(
                            [['name' => __('--- Medical History ---', 'kivicare-pro'), 'value' => $encLabel]],
                            $this->format_flat_section($mhData)
                        ),
                    ];
                }
            }

            // 3. Prescriptions (one item per prescription)
            $rxRecords = $encounterRxMap[$encId] ?? [];
            foreach ($rxRecords as $rxIndex => $rx) {
                $export_items[] = [
                    'group_id'    => $encounterGroupId,
                    'group_label' => $encounterGroupLabel,
                    'item_id'     => $encounterGroupId . '-' . $encId . '-rx-' . ($rxIndex + 1),
                    'data'        => array_merge(
                        [['name' => __('--- Prescription ' . ($rxIndex + 1) . ' ---', 'kivicare-pro'), 'value' => $encLabel]],
                        $this->format_flat_section($rx)
                    ),
                ];
            }
        }

        return [
            'data' => $export_items,
            'done' => true,
        ];
    }

    /**
     * Convert a flat associative array into the WordPress
     */
    private function format_flat_section(array $data): array
    {
        $formatted = [];
        foreach ($data as $key => $value) {
            if (is_array($value) || is_object($value)) {
                $value = wp_json_encode($value, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
            }
            $label = ucwords(str_replace('_', ' ', $key));
            $formatted[] = [
                'name'  => $label,
                'value' => (string) $value,
            ];
        }
        return $formatted;
    }

    /**
     * Collect all patient data for export
     */
    private function collectPatientData($userId)
    {
        $data = [
            'export_info' => [
                'generated_at' => current_time('mysql'),
                'user_id' => $userId,
                'format_version' => '1.0'
            ],
            'personal_info'            => [],
            'appointments'             => [],
            'encounters'               => [],
            'encounter_medical_history'=> [],
            'encounter_prescriptions'  => [],
            'lab_tests'                => [],
            'report_file_paths'        => [],
            'payment_history'          => []
        ];

        // Get user basic info
        $meta_keys = [
            'user_login',
            'user_email',
            'display_name',
            'user_registered',
            'patient_added_by',
            'first_name',
            'last_name',
            'basic_data',
            'patient_profile_image',
            'patient_unique_id',
        ];
        $meta_values = [];
        foreach ($meta_keys as $meta_key) {
            $value = get_user_meta($userId, $meta_key, true);
            if ($value === '' || $value === null) {
                continue;
            }
            if ($meta_key === 'basic_data') {
                // Decode if still a JSON string
                if (is_string($value)) {
                    $decoded = json_decode($value, true);
                    if (json_last_error() === JSON_ERROR_NONE) {
                        $value = $decoded;
                    }
                }
                // Flatten each basic_data field as its own row in the export
                if (is_array($value)) {
                    $basic_field_labels = [
                        'mobile_number' => 'mobile_number',
                        'gender'        => 'gender',
                        'dob'           => 'dob',
                        'address'       => 'address',
                        'city'          => 'city',
                        'country'       => 'country',
                        'postal_code'   => 'postal_code',
                        'blood_group'   => 'blood_group',
                    ];
                    foreach ($basic_field_labels as $field => $label) {
                        if (isset($value[$field]) && $value[$field] !== '') {
                            $meta_values[$label] = $value[$field];
                        }
                    }
                }
                continue; // skip adding basic_data as a raw key
            }
            $meta_values[$meta_key] = $value;
        }
        if (!empty($meta_values)) {
            $data['personal_info'] = array_merge($data['personal_info'], $meta_values);
        }

        // Get medical history records indexed by encounter_id (merged into encounters below)
        $medicalHistoryMap = [];
        $allMedicalHistory = KCMedicalHistory::query()->where('patientId', '=', $userId)->get();
        foreach ($allMedicalHistory as $mh) {
            $encId = (int) $mh->encounterId;
            $medicalHistoryMap[$encId][] = [
                'type'  => $mh->type,
                'title' => $mh->title,
            ];
        }

        // Get appointments
        $appointments = KCAppointment::query()->where('patient_id', '=', $userId)->get();
        $appointment_ids = [];
        foreach ($appointments as $appointment) {
            $appointment_ids[] = (int) $appointment->id;
            $doctor_id = $appointment->doctorId ?? $appointment->doctor_id ?? null;
            $clinic_id = $appointment->clinicId ?? $appointment->clinic_id ?? null;

            $doctor_name = '';
            if (!empty($doctor_id)) {
                $doctor_user = get_userdata((int) $doctor_id);
                $doctor_name = $doctor_user ? $doctor_user->display_name : '';
            }

            $clinic_name = '';
            if (!empty($clinic_id)) {
                $clinic = KCClinic::find((int) $clinic_id);
                $clinic_name = $clinic ? $clinic->name : '';
            }

            $data['appointments'][] = [
                'id' => $appointment->id,
                'appointment_start_date' => $appointment->appointmentStartDate,
                'appointment_start_time' => $appointment->appointmentStartTime,
                'status' => $appointment->status,
                'doctor_name' => $doctor_name,
                'clinic_name' => $clinic_name,
                'created_at' => $appointment->createdAt,
            ];
        }

        // Get prescriptions indexed by encounter_id
        $prescriptions = KCPrescription::query()->where('patient_id', '=', $userId)->get();
        foreach ($prescriptions as $prescription) {
            $encId = (int) $prescription->encounterId;
            $added_by_name = '';
            if (!empty($prescription->addedBy)) {
                $added_by_user = get_userdata((int) $prescription->addedBy);
                $added_by_name = $added_by_user ? $added_by_user->display_name : '';
            }

            $data['encounter_prescriptions'][$encId][] = [
                'name'        => $prescription->name,
                'frequency'   => $prescription->frequency,
                'duration'    => $prescription->duration,
                'instruction' => $prescription->instruction,
                'added_by'    => $added_by_name,
                'created_at'  => $prescription->createdAt,
            ];
        }

        // Get encounters (basic info only – MH and Rx exported as sub-tables)
        $encounters = KCPatientEncounter::query()->where('patient_id', '=', $userId)->get();
        foreach ($encounters as $encounter) {
            $encId = (int) $encounter->id;

            // Build per-encounter medical history map for export loop
            $mhRecords = $medicalHistoryMap[$encId] ?? [];
            $mhForExport = [];
            foreach ($mhRecords as $mh) {
                $mhForExport[] = [
                    'type'  => ucfirst($mh['type']),
                    'title' => $mh['title'],
                ];
            }
            $data['encounter_medical_history'][$encId] = $mhForExport;

            $data['encounters'][] = [
                'id'             => $encId,
                'encounter_date' => $encounter->encounterDate,
                'description'    => $encounter->description,
                'created_at'     => $encounter->createdAt,
            ];
        }

        // Get lab tests (patient medical reports)
        // report_url is intentionally excluded from the HTML export;
        // the actual file is bundled into the ZIP via attach_reports_to_export_zip().
        $medical_reports = KCPatientMedicalReport::query()->where('patient_id', '=', $userId)->get();
        foreach ($medical_reports as $report) {
            $file_path = '';
            $public_url = '';

            if (is_numeric($report->uploadReport)) {
                $attach_id  = (int) $report->uploadReport;
                $file_path  = get_attached_file($attach_id) ?: '';
                $public_url = wp_get_attachment_url($attach_id) ?: '';
            } elseif (!empty($report->uploadReport)) {
                $public_url = $report->uploadReport;
            }

            // Build clickable link using the full public URL as both href and label
            $file_link = '';
            if ($public_url) {
                $file_link = '<a href="' . esc_attr($public_url) . '">' . esc_html($public_url) . '</a>';
            }

            // Queue local file for ZIP bundling (attachment uploads only)
            if ($file_path && file_exists($file_path)) {
                $data['report_file_paths'][] = [
                    'label' => $report->name ?: basename($file_path),
                    'path'  => $file_path,
                ];
            }

            $data['lab_tests'][] = [
                'test_name'   => $report->name,
                'test_date'   => $report->date,
                'report_file' => $file_link,
            ];
        }

        // Get payment history with full bill details
        $currency        = KCClinic::getClinicCurrencyPrefixAndPostfix();
        $currency_prefix = $currency['prefix'] ?? '';
        $currency_postfix = $currency['postfix'] ?? '';

        $fmt_money = function ($amount) use ($currency_prefix, $currency_postfix) {
            return $currency_prefix . $amount . $currency_postfix;
        };

        $payments = KCPaymentsAppointmentMapping::query()->whereIn('appointment_id', $appointment_ids)->get();
        foreach ($payments as $payment) {
            $bill = KCBill::query()->where('appointment_id', '=', $payment->appointmentId)->first();

            // Collect bill line items with currency
            $items_text = '';
            if ($bill) {
                $bill_items = KCBillItem::query()->where('bill_id', '=', $bill->id)->get();
                $lines = [];
                foreach ($bill_items as $item) {
                    $service = KCService::find($item->itemId);
                    $service_name = $service ? $service->name : 'Service #' . $item->itemId;
                    $lines[] = $service_name . ' × ' . $item->qty . ' @ ' . $fmt_money($item->price);
                }
                $items_text = implode('; ', $lines);
            }

            $data['payment_history'][] = [
                'bill_id'        => $bill ? $bill->id : '',
                'bill_items'     => $items_text,
                'total_amount'   => $bill ? $fmt_money($bill->totalAmount) : '',
                'discount'       => $bill ? $fmt_money($bill->discount) : '',
                'actual_amount'  => $bill ? $fmt_money($bill->actualAmount) : '',
                'amount_paid'    => $fmt_money($payment->amount),
                'payment_method' => $payment->paymentMode,
                'payment_date'   => $payment->createdAt,
                'payment_status' => $bill ? $bill->paymentStatus : $payment->paymentStatus,
                'created_at'     => $payment->createdAt,
            ];
        }

        return $data;
    }

    /**
     * Fires after WordPress creates the personal data export ZIP.
     * Re-opens the ZIP and appends each report file under a reports/ folder.
     *
     * @param string $archive_pathname  Absolute path to the export ZIP.
     * @param string $obscura           Unique token (unused).
     * @param string $exports_dir       Exports directory path (unused).
     * @param int    $request_id        The export request post ID.
     */
    public function attach_reports_to_export_zip($archive_pathname, $obscura, $exports_dir, $request_id)
    {
        // Resolve the user from the export request
        $request = wp_get_user_request($request_id);
        if (!$request) {
            return;
        }
        $user = get_user_by('email', $request->email);
        if (!$user) {
            return;
        }

        $transient_key = 'kc_export_report_files_' . $user->ID;
        $file_paths    = get_transient($transient_key);

        if (empty($file_paths) || !is_array($file_paths)) {
            return;
        }

        if (!class_exists('ZipArchive')) {
            return;
        }

        $zip = new \ZipArchive();
        if ($zip->open($archive_pathname) !== true) {
            return;
        }

        foreach ($file_paths as $entry) {
            $abs_path = $entry['path'] ?? '';
            if ($abs_path && file_exists($abs_path)) {
                // Store as  reports/<original-filename>  inside the ZIP
                $zip->addFile($abs_path, 'reports/' . basename($abs_path));
            }
        }

        $zip->close();
        delete_transient($transient_key);
    }
}
