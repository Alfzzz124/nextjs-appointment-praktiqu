<?php

namespace KCProApp\controllers\api;

use App\baseClasses\KCBaseController;
use App\models\KCBill;
use App\models\KCClinic;
use App\models\KCPaymentsAppointmentMapping;
use KCProApp\models\KCPTaxData;
use App\baseClasses\KCErrorLogger;
use WP_REST_Request;
use WP_REST_Response;
use App\utils\KCPdfGenerator;

defined('ABSPATH') or die('Something went wrong');

class KCProPrintBillController extends KCBaseController
{
    protected $route = 'bills';

    /**
     * Register routes for this controller
     */
    public function registerRoutes()
    {
        // Print bill route
        $this->registerRoute('/' . $this->route . '/(?P<id>\d+)/print', [
            'methods' => 'GET',
            'callback' => [$this, 'print'],
            'permission_callback' => [$this, 'checkPermission'],
            'args' => [
                'id' => [
                    'description' => __('Bill ID', 'kivicare-pro'),
                    'type' => 'integer',
                    'required' => true,
                ],
            ]
        ]);
    }

    /**
     * Generate PDF for bill and return as file
     *
     * @param WP_REST_Request $request
     * @return void|WP_REST_Response
     */
    public function print(WP_REST_Request $request)
    {
        try {
            // Get bill ID from request
            $bill_id = $request->get_param('id');

            if (empty($bill_id)) {
                return $this->response(
                    false,
                    __('Bill ID is required', 'kivicare-pro'),
                    400
                );
            }

            // Fetch bill data
            $bill = KCBill::find($bill_id);

            if (!$bill) {
                return $this->response(
                    false,
                    __('Bill not found', 'kivicare-pro'),
                    404
                );
            }

            // Prepare bill data for printing
            $bill_data = $this->prepare_printable_bill($bill);

            // Generate HTML from template
            $html = $this->render_print_template($bill_data);

            // Generate PDF directly
            $filename = 'bill_' . $bill_id . '_' . current_time('timestamp') . '.pdf';
            return KCPdfGenerator::generate($html, $filename);

        } catch (\Exception $e) {
            return $this->response(
                false,
                $e->getMessage(),
                500
            );
        }
    }



    /**
     * Get currency details from clinic settings
     *
     * @return array
     */
    private function get_currency_details(): array
    {
        $default_currency = [
            'prefix' => '$',
            'postfix' => '',
        ];

        try {
            // Get clinic currency settings
            $clinic = KCClinic::getDefaultClinic();
            if ($clinic && !empty($clinic->extra)) {
                $clinic_data = json_decode($clinic->extra, true);
                if (isset($clinic_data['currency_prefix']) || isset($clinic_data['currency_postfix'])) {
                    return [
                        'prefix' => $clinic_data['currency_prefix'] ?? '$',
                        'postfix' => $clinic_data['currency_postfix'] ?? '',
                    ];
                }
            }

        } catch (\Exception $e) {
            // Log error but don't break the process
            KCErrorLogger::instance()->error('Error getting currency details: ' . $e->getMessage());
        }

        return $default_currency;
    }

    /**
     * Prepare bill data for printing
     *
     * @param KCBill $bill
     * @return array
     */
    private function prepare_printable_bill(KCBill $bill): array
    {
        // Get currency details first
        $currency_details = $this->get_currency_details();

        // Get related data through encounter
        $encounter = $bill->getEncounter();
        $billItems = $bill->getBillItems();

        // Get clinic - use clinicId from bill if available, otherwise try to get from encounter
        $clinic = null;
        if (!empty($bill->clinicId)) {
            $clinic = $bill->getClinic();
        } elseif ($encounter) {
            $clinic = $encounter->getClinic();
        }

        // Get patient and doctor through encounter
        $patient = null;
        $doctor = null;
        $patient_meta = null;
        
        if ($encounter) {
            $patient = $encounter->getPatient();
            $doctor = $encounter->getDoctor();
            if ($patient) {
                $patient_meta = json_decode($patient->getMeta('basic_data'));
            }
        }

        // Get site logo from options
        $clinicLogo = [
            'id'  => $clinic->clinicLogo,
            'url' => $clinic->clinicLogo ? wp_get_attachment_url($clinic->clinicLogo) : '',
        ];

        // Get payment method from appointment
        $payment_method = 'N/A';
        if ($bill->appointmentId) {
            $payment_method = KCPaymentsAppointmentMapping::getPaymentModeByAppointmentId($bill->appointmentId);
        }

        return [
            'bill' => [
                'id' => $bill->id,
                'invoice_id' => $bill->id, // Using id as invoice_id since no invoiceId field
                'date' => kcGetFormatedDate(date('Y-m-d', strtotime($bill->createdAt))),
                'status' => $bill->paymentStatus ?? 'pending',
                'sub_total' => $bill->totalAmount ?? '0.00',
                'discount' => $bill->discount ?? '0.00',
                'total_tax' => '0.00', // No tax field in current model
                'actual_amount' => $bill->actualAmount ?? $bill->totalAmount ?? '0.00',
                'created_at' => $bill->createdAt,
            ],
            'patient' => $patient ? [
                'id' => $patient->id,
                'name' => $patient->display_name,
                'email' => $patient->email,
                'phone' => $patient_meta->mobile_number ?? '',
                'gender' => $patient_meta->gender ?? '',
                'dob' => $patient_meta->dob ?? '',
                'address' => $patient_meta->address ?? '',
            ] : null,
            'doctor' => $doctor ? [
                'id' => $doctor->id,
                'name' => $doctor->display_name,
                'email' => $doctor->email,
            ] : null,
            'clinic' => $clinic ? [
                'id' => $clinic->id,
                'name' => $clinic->name,
                'address' => $clinic->address,
                'city' => $clinic->city,
                'country' => $clinic->country,
                'postal_code' => $clinic->postalCode,
                'phone' => $clinic->telephoneNo,
                'email' => $clinic->email,
                'profile_image' => $clinic->profileImage ? wp_get_attachment_url($clinic->profileImage) : '',
            ] : null,
            'service_items' => $billItems ? $billItems->map(function($item) {
                $service = $item->getItem(); // Get the service details
                return [
                    'name' => $service ? $service->name : 'Service',
                    'price' => $item->price ?? '0.00',
                    'quantity' => $item->qty ?? 1,
                    'discount' => '0.00', // No discount field in KCBillItem
                    'total' => $item->getTotal(),
                ];
            })->toArray() : [],
            'tax_items' => $this->get_tax_data_for_bill($bill),
            'currency_detail' => $currency_details,
            'clinic_logo' => $clinicLogo,
            'payment_method' => $payment_method,
        ];
    }

    /**
     * Render print template with bill data
     *
     * @param array $data
     * @return string
     */
    private function render_print_template($data): string
    {
        // Check for child theme template first, then fall back to plugin template
        $template_file = $this->get_template_file();

        if (!file_exists($template_file)) {
            throw new \Exception(__('Print template not found', 'kivicare-pro'));
        }

        // Start output buffering
        ob_start();

        // Extract data into variables for template
        extract($data);

        // Include template
        include $template_file;

        // Get output and clean buffer
        $html = ob_get_clean();

        return $html;
    }

    /**
     * Get tax data for bill
     *
     * @param KCBill $bill
     * @return array
     */
    private function get_tax_data_for_bill(KCBill $bill): array
    {
        $encounter = $bill->getEncounter();
        if (!$encounter) {
            return [];
        }

        $taxData = KCPTaxData::get_tax([
            'module_type' => 'encounter',
            'module_id' => $encounter->id
        ]);

        return array_map(function($tax) {
            return [
                'name' => $tax->name ?? 'Tax',
                'charges' => $tax->charges ?? '0.00',
                'tax_value' => $tax->taxValue ?? '0.00',
                'tax_type' => $tax->taxType ?? 'percentage',
            ];
        }, $taxData);
    }

    /**
     * Get template file path - check child theme first
     *
     * @return string
     */
    private function get_template_file(): string
    {
        // Check child theme first
        $child_theme_path = get_stylesheet_directory() . '/kivicare/KCBillPrintTemplate.php';
        if (file_exists($child_theme_path)) {
            return $child_theme_path;
        }

        // Fall back to parent theme
        $parent_theme_path = get_template_directory() . '/kivicare/KCBillPrintTemplate.php';
        if (file_exists($parent_theme_path)) {
            return $parent_theme_path;
        }

        // Fall back to plugin template
        $plugin_path = KIVI_CARE_PRO_DIR . '/templates/KCBillPrintTemplate.php';
        return $plugin_path;
    }
}