<?php

namespace KCProApp\controllers\api;

use App\baseClasses\KCBaseController;
use KCProApp\helper\KCPTaxCalculator;
use App\models\KCAppointment;
use App\models\KCBill;
use App\models\KCServiceDoctorMapping;
use App\models\KCAppointmentServiceMapping;
use App\models\KCPatientEncounter;
use App\models\KCPatient;
use App\models\KCDoctor;
use App\models\KCClinic;
use App\models\KCBillItem;
use App\models\KCUserMeta;
use KCProApp\models\KCPTaxData;
use App\models\KCService;
use App\models\KCPaymentsAppointmentMapping;
use KCProApp\models\KCPTax;
use App\emails\KCEmailTemplateManager;
use App\emails\KCEmailTemplateProcessor;
use WP_REST_Request;
use WP_REST_Response;
use App\utils\KCPdfGenerator;
use App\controllers\api\BillController;
use App\baseClasses\KCErrorLogger;

defined('ABSPATH') or die('Something went wrong');

/**
 * Class KCProBillController
 * 
 * API Controller for Bill-related endpoints
 */
class KCProBillController extends BillController
{
    /**
     * @var string The base route for this controller
     */
    protected $route = 'bills';

    /**
     * Register routes for this controller
     */
    public function registerRoutes()
    {
        parent::registerRoutes();
        // Get all bills (with pagination, search, filter)
        $this->registerRoute('/' . $this->route, [
            'methods' => 'GET',
            'callback' => [$this, 'getBills'],
            'permission_callback' => [$this, 'checkListPermission'],
            'args' => $this->getListEndpointArgs()
        ]);

        $this->registerRoute('/' . $this->route . '/calculate-tax', [
            'methods' => 'POST',
            'callback' => [$this, 'calculateTaxForService'],
            'permission_callback' => [$this, 'checkPermission'],
            'args' => [
                'clinic_id' => [
                    'description' => 'Clinic ID',
                    'type' => 'integer',
                    'required' => false,
                    'sanitize_callback' => 'absint',
                ],
                'doctor_id' => [
                    'description' => 'Doctor ID',
                    'type' => 'integer',
                    'required' => false,
                    'sanitize_callback' => 'absint',
                ],
                'serviceItems' => [
                    'description' => 'Array of existing service items',
                    'type' => 'array',
                    'required' => false,
                ],
            ]
        ]);
        $this->registerRoute('/' . $this->route . '/encounters-without-bill', [
            'methods' => 'GET',
            'callback' => [$this, 'getEncountersWithoutBill'],
            'permission_callback' => [$this, 'checkPermission'],
        ]);



        $this->registerRoute('/' . $this->route . '/item/(?P<item_id>\d+)', [
            'methods' => 'DELETE',
            'callback' => [$this, 'deleteBillItem'],
            'permission_callback' => [$this, 'checkDeletePermission'],
            'args' => [
                'item_id' => [
                    'description' => 'Bill Item ID',
                    'type' => 'integer',
                    'required' => true,
                    'sanitize_callback' => 'absint',
                ]
            ]
        ]);

        $this->registerRoute('/' . $this->route . '/item/(?P<item_id>\d+)', [
            'methods' => 'PUT',
            'callback' => [$this, 'updateBillItem'],
            'permission_callback' => [$this, 'checkCreatePermission'],
            'args' => [
                'item_id' => [
                    'description' => 'Bill Item ID',
                    'type' => 'integer',
                    'required' => true,
                    'sanitize_callback' => 'absint',
                ],
                'serviceId' => [
                    'description' => 'Service ID',
                    'type' => 'integer',
                    'required' => true,
                    'sanitize_callback' => 'absint',
                ],
                'quantity' => [
                    'description' => 'Quantity',
                    'type' => 'integer',
                    'required' => true,
                    'sanitize_callback' => 'absint',
                ],
                'price' => [
                    'description' => 'Price',
                    'type' => 'number',
                    'required' => true,
                ],
            ]
        ]);

        // Export bills data
        $this->registerRoute('/' . $this->route . '/export', [
            'methods' => 'GET',
            'callback' => [$this, 'exportBills'],
            'permission_callback' => [$this, 'checkListPermission'],
            'args' => $this->getExportEndpointArgs()
        ]);

        // Email bill
        $this->registerRoute('/' . $this->route . '/(?P<id>\\d+)/email', [
            'methods' => 'POST',
            'callback' => [$this, 'emailBill'],
            'permission_callback' => [$this, 'checkViewPermission'],
            'args' => [
                'id' => [
                    'description' => 'Bill ID',
                    'type' => 'integer',
                    'required' => true,
                    'sanitize_callback' => 'absint',
                ]
            ]
        ]);

    }

    public function checkDeletePermission(){
        if (!$this->isModuleEnabled('billing')) { return false; }
        // Check if user has permission to delete
        return $this->checkResourceAccess('patient_bill', 'delete');

    }

    public function checkListPermission(){
        if (!$this->isModuleEnabled('billing')) { return false; }
        // Check if user has permission to list
        return $this->checkResourceAccess('patient_bill', 'list');
    }

    public function checkViewPermission(){
        if (!$this->isModuleEnabled('billing')) { return false; }
        // Check if user has permission to list
        return $this->checkResourceAccess('patient_bill', 'view');
    }

    /**
     * Check if user has permission to create a bill
     */
    public function checkCreatePermission($request)
    {
        if (!$this->isModuleEnabled('billing')) { return false; }
        // Check basic read permission first
        if (!$this->checkCapability('read')) {
            return false;
        }

        // Check if user has permission to create a bill
        return $this->checkResourceAccess('patient_bill', 'add');
    }

    /**
     * Check if user has permission to access bill endpoints
     */
    public function checkPermission($request)
    {
        if (!$this->isModuleEnabled('billing')) { return false; }
        return current_user_can('read');
    }

    /**
     * Get arguments for the list endpoint
     */
    private function getListEndpointArgs()
    {
        return [
            'search' => [
                'description' => 'Search term to filter results',
                'type' => 'string',
                'sanitize_callback' => 'sanitize_text_field',
            ],
            'status' => [
                'description' => 'Bill status (e.g., paid, unpaid)',
                'type' => 'string',
                'sanitize_callback' => 'sanitize_text_field',
            ],
            'date_from' => [
                'description' => 'Start date (YYYY-MM-DD)',
                'type' => 'string',
                'sanitize_callback' => 'sanitize_text_field',
            ],
            'date_to' => [
                'description' => 'End date (YYYY-MM-DD)',
                'type' => 'string',
                'sanitize_callback' => 'sanitize_text_field',
            ],
            'page' => [
                'description' => 'Current page of results',
                'type' => 'integer',
                'default' => 1,
                'sanitize_callback' => 'absint',
            ],
            'perPage' => [
                'description' => 'Number of results per page',
                'type' => 'string',
                'default' => 10,
                'sanitize_callback' => function($param) {
                    return strtolower($param) === 'all' ? 'all' : absint($param);
                },
            ]
        ];
    }

    /**
     * Get arguments for the export endpoint
     */
    private function getExportEndpointArgs()
    {
        return [
            'format' => [
                'description' => 'Export format (csv, xls, pdf)',
                'type' => 'string',
                'required' => true,
                'validate_callback' => function($param) {
                    if (!in_array(strtolower($param), ['csv', 'xls', 'pdf'])) {
                        return new \WP_Error('invalid_format', __('Format must be csv, xls, or pdf', 'kivicare-pro'));
                    }
                    return true;
                },
                'sanitize_callback' => function($param) {
                    return strtolower(sanitize_text_field($param));
                },
            ],
            'search' => [
                'description' => 'Search term to filter results',
                'type' => 'string',
                'sanitize_callback' => 'sanitize_text_field',
            ],
            'status' => [
                'description' => 'Bill status (e.g., paid, unpaid)',
                'type' => 'string',
                'sanitize_callback' => 'sanitize_text_field',
            ],
            'date_from' => [
                'description' => 'Start date (YYYY-MM-DD)',
                'type' => 'string',
                'sanitize_callback' => 'sanitize_text_field',
            ],
            'date_to' => [
                'description' => 'End date (YYYY-MM-DD)',
                'type' => 'string',
                'sanitize_callback' => 'sanitize_text_field',
            ],
            'page' => [
                'description' => 'Current page of results',
                'type' => 'integer',
                'default' => 1,
                'sanitize_callback' => 'absint',
            ],
            'perPage' => [
                'description' => 'Number of results per page',
                'type' => 'string',
                'default' => 10,
                'sanitize_callback' => function($param) {
                    return strtolower($param) === 'all' ? 'all' : absint($param);
                },
            ],
            'orderBy' => [
                'description' => 'Column to order by',
                'type' => 'string',
                'sanitize_callback' => 'sanitize_text_field',
            ],
            'order' => [
                'description' => 'Sort direction (asc, desc)',
                'type' => 'string',
                'sanitize_callback' => 'sanitize_text_field',
            ],
            'id' => [
                'description' => 'Bill ID',
                'type' => 'integer',
                'sanitize_callback' => 'absint',
            ],
            'encounter_id' => [
                'description' => 'Encounter ID',
                'type' => 'integer',
                'sanitize_callback' => 'absint',
            ],
            'doctorName' => [
                'description' => 'Doctor name',
                'type' => 'string',
                'sanitize_callback' => 'sanitize_text_field',
            ],
            'clinicName' => [
                'description' => 'Clinic name',
                'type' => 'string',
                'sanitize_callback' => 'sanitize_text_field',
            ],
            'patientName' => [
                'description' => 'Patient name',
                'type' => 'string',
                'sanitize_callback' => 'sanitize_text_field',
            ],
            'serviceName' => [
                'description' => 'Service name',
                'type' => 'string',
                'sanitize_callback' => 'sanitize_text_field',
            ],
        ];
    }

    /**
     * Get arguments for single item endpoints
     */
    private function getSingleEndpointArgs()
    {
        return [
            'id' => [
                'description' => 'Bill ID',
                'type' => 'integer',
                'required' => true,
                'sanitize_callback' => 'absint',
            ]
        ];
    }

    /**
     * Get arguments for the create endpoint
     */
    private function getCreateEndpointArgs()
    {
        return [
            'serviceItems' => [
                'description' => 'Array of bill service items',
                'type' => 'array',
                'required' => true,
            ],
            'taxItems' => [
                'description' => 'Array of tax items',
                'type' => 'array',
                'required' => false,
            ],
            'discount' => [
                'description' => 'Discount value',
                'type' => 'number',
                'required' => false,
            ],
            'discountEnabled' => [
                'description' => 'Is discount enabled',
                'type' => 'boolean',
                'required' => false,
            ],
            'status' => [
                'description' => 'Bill status',
                'type' => 'string',
                'required' => true,
                'sanitize_callback' => 'sanitize_text_field',
            ],
            'clinic' => [
                'description' => 'Clinic info',
                'type' => 'object',
                'required' => true,
            ],
            'doctor' => [
                'description' => 'Doctor info',
                'type' => 'object',
                'required' => true,
            ],
            'patient' => [
                'description' => 'Patient info',
                'type' => 'object',
                'required' => true,
            ],
            'patientEncounter' => [
                'description' => 'Patient encounter info',
                'type' => 'object',
                'required' => true,
            ],
            'service_total' => [
                'description' => 'Total of all services',
                'type' => 'number',
                'required' => true,
            ],
            'taxTotal' => [
                'description' => 'Total tax amount',
                'type' => 'number',
                'required' => false,
            ],
            'discountValue' => [
                'description' => 'Discount value (for display)',
                'type' => 'number',
                'required' => false,
            ],
            'total_amount' => [
                'description' => 'Total payable amount',
                'type' => 'number',
                'required' => true,
            ],
        ];
    }

    /**
     * Get arguments for the update endpoint
     */
    private function getUpdateEndpointArgs()
    {
        $args = $this->getCreateEndpointArgs();
        foreach ($args as $key => $arg) {
            if (isset($args[$key]['required'])) {
                unset($args[$key]['required']);
            }
        }
        $args['id'] = [
            'description' => 'Bill ID',
            'type' => 'integer',
            'required' => true,
            'sanitize_callback' => 'absint',
        ];
        $args['checkout'] = [
            'description' => 'Whether to checkout the encounter after updating the bill',
            'type' => 'boolean',
            'required' => false,
        ];
        return $args;
    }

    /**
     * Get all encounters that do not have a bill
     */
    public function getEncountersWithoutBill(WP_REST_Request $request): WP_REST_Response
    {
        // Get all encounter_ids from bills
        $encounter_ids_with_bill = KCBill::query()
            ->select(['encounter_id'])
            ->whereNotNull('encounter_id')
            ->get()
            ->pluck('encounterId')
            ->toArray();

        // Filter bills by assigned clinic for receptionist and clinic admin, or by doctor for doctors
        $current_user_role = $this->kcbase->getLoginUserRole();
        $query = KCPatientEncounter::query()
            ->setTableAlias('kc_patient_encounters')
            ->select(['kc_patient_encounters.*', 'patients.display_name as patientName', 'patients.id as patientId', 'clinics.name as clinicName', 'clinics.id as clinicId', 'doctors.display_name as doctorName', 'doctors.id as doctorId', 'pi.meta_value as patient_image_url', 'di.meta_value as doctor_image_url'])
            ->leftJoin(KCPatient::class, 'kc_patient_encounters.patient_id', '=', 'patients.id', 'patients')
            ->leftJoin(KCClinic::class, 'kc_patient_encounters.clinic_id', '=', 'clinics.id', 'clinics')
            ->leftJoin(KCDoctor::class, 'kc_patient_encounters.doctor_id', '=', 'doctors.id', 'doctors')
            ->leftJoin(KCUserMeta::class, function ($join) {
                $join->on('patients.ID', '=', 'pi.user_id')
                    ->onRaw("pi.meta_key = 'patient_profile_image'");
            }, null, null, 'pi')
            ->leftJoin(KCUserMeta::class, function ($join) {
                $join->on('doctors.ID', '=', 'di.user_id')
                    ->onRaw("di.meta_key = 'doctor_profile_image'");
            }, null, null, 'di');
        
        if (!empty($encounter_ids_with_bill)) {
            $query->whereNotIn('kc_patient_encounters.id', $encounter_ids_with_bill);
        }

        if ($current_user_role == $this->kcbase->getReceptionistRole()) {
            $clinic_id = KCClinic::getClinicIdOfReceptionist();
            if ($clinic_id) {
                $query->where('kc_patient_encounters.clinic_id', '=', $clinic_id);
            }
        } elseif ($current_user_role == $this->kcbase->getClinicAdminRole()) {
            $clinic_id = KCClinic::getClinicIdOfClinicAdmin();
            if ($clinic_id) {
                $query->where('kc_patient_encounters.clinic_id', '=', $clinic_id);
            }
        } elseif ($current_user_role == $this->kcbase->getDoctorRole()) {
            $doctor_id = get_current_user_id();
            $query->where('kc_patient_encounters.doctor_id', '=', $doctor_id);
        }
        
        $encounters = $query->get();

        $encounterData = [];
        foreach ($encounters as $encounter) {
            $encounterData[] = [
                'id' => $encounter->id,
                'encounterDate' => kcGetFormatedDate($encounter->encounterDate),
                'patientId' => $encounter->patientId,
                'clinicId' => $encounter->clinicId,
                'doctorId' => $encounter->doctorId,
                'status' => $encounter->status,
                'description' => $encounter->description,
                'patientName' => $encounter->patientName,
                'clinicName' => $encounter->clinicName,
                'doctorName' => $encounter->doctorName,
                'appointmentId' => $encounter->appointmentId,
                'patient_image_url' => $encounter->patient_image_url ? wp_get_attachment_url($encounter->patient_image_url) : '',
                'doctor_image_url' => $encounter->doctor_image_url ? wp_get_attachment_url($encounter->doctor_image_url) : '',
            ];
        }
        return $this->response([
            'encounters' => $encounterData,
            'count' => count($encounters),
        ], __('Encounters without bill retrieved successfully', 'kivicare-pro'));
    }

    public function calculateTaxForService(WP_REST_Request $request): WP_REST_Response
    {
        $clinic_id = $request->get_param('clinic_id');
        $doctor_id = $request->get_param('doctor_id');
        $serviceItems = $request->get_param('serviceItems');

        $result = $this->calculateTaxes($clinic_id, $doctor_id, $serviceItems);

        return $this->response($result, __('Tax calculated successfully', 'kivicare-pro'));
    }

    /**
     * Calculate taxes for services
     */
    private function calculateTaxes($clinic_id, $doctor_id, $serviceItems)
    {
        // Handle empty or invalid input
        if (empty($serviceItems) || !is_array($serviceItems)) {
            return ['total_tax' => 0.0, 'calculated_taxes' => []];
        }

        $calculator = new KCPTaxCalculator();

        // Normalize and add services + taxes
        foreach ($serviceItems as $service) {
            $serviceId = isset($service['serviceId']) ? (int)$service['serviceId'] : (int)($service['id'] ?? 0);
            $quantity = isset($service['quantity']) ? (int)$service['quantity'] : (int)($service['qty'] ?? 1);
            $price = isset($service['price']) ? (float)$service['price'] : 0.0;
            $serviceName = isset($service['service_name']) ? $service['service_name'] : (isset($service['name']) ? $service['name'] : 'Service ' . $serviceId);

            // Add service to calculator
            $calculator->addService($serviceId, $serviceName, $price, $quantity);

            // Fetch and add taxes for this service
            $taxQueryParams = [
                'clinicId' => $clinic_id,
                'doctorId' => $doctor_id,
                'services' => [$serviceId]
            ];

            $taxes = KCPTax::getTaxes($taxQueryParams);
            if ($taxes && is_iterable($taxes)) {
                foreach ($taxes as $tax) {
                    $calculator->addTax(
                        $tax->id ?? ($tax['id'] ?? null),
                        $tax->name ?? ($tax['name'] ?? ''),
                        $tax->taxType ?? ($tax['tax_type'] ?? ''),
                        $tax->taxValue ?? ($tax['tax_value'] ?? 0),
                        [$serviceId]
                    );
                }
            }
        }

        // Perform calculations
        $calculator->calculate();

        $totalTax = (float)$calculator->getTotalTax();
        $taxSummary = $calculator->getTaxSummary();
        
        $flattenedTaxes = [];
        foreach ($taxSummary as $tax) {
            if (!empty($tax['services']) && is_array($tax['services'])) {
                foreach ($tax['services'] as $service) {
                    $flattenedTaxes[] = [
                        'tax_id' => $tax['tax_id'],
                        'tax_name' => $tax['tax_name'],
                        'tax_type' => $tax['tax_type'],
                        'tax_value' => $tax['tax_value'],
                        'tax_amount' => $service['tax_amount'],
                        'service_id' => $service['service_id'],
                        'service_name' => $service['service_name']
                    ];
                }
            }
        }
        
        // Format result
        return [
            'total_tax' => round($totalTax, 2),
            'calculated_taxes' => $flattenedTaxes
        ];
    }

    /**
     * Get all bills with pagination, search, and filters
     */
    public function getBills(WP_REST_Request $request): WP_REST_Response
    {
        $params = $request->get_params();
        // Set defaults
        $page       = isset($params['page']) ? (int)$params['page'] : 1;
        $perPageParam = isset($params['perPage']) ? $params['perPage'] : 10;

        // Handle "all" option for perPage
        $showAll = (strtolower($perPageParam) === 'all');

        // Build query (remove KCBillItem and KCService joins)
        $query = KCBill::table('bills')
            ->select([
                'bills.*',
                'patients.display_name as patient_name',
                'patients.user_email as patient_email',
                'pi.meta_value as patient_profile_image',
                'clinics.name as clinic_name',
                'clinics.id as clinic_id',
                'clinics.email as clinic_email',
                'clinics.profile_image as clinic_profile_image',
                'doctors.display_name as doctor_name',
                'doctors.id as doctor_id',
                'doctors.user_email as doctor_email',
                'di.meta_value as doctor_profile_image',
            ])
            ->leftJoin(KCPatientEncounter::class, 'bills.encounter_id', '=', 'pe.id', 'pe')
            ->leftJoin(KCPatient::class, 'pe.patient_id', '=', 'patients.id', 'patients')
            ->leftJoin(KCUserMeta::class, function ($join) {
                $join->on('patients.ID', '=', 'pi.user_id')
                    ->onRaw("pi.meta_key = 'patient_profile_image'");
            }, null, null, 'pi')
            ->leftJoin(KCClinic::class, 'pe.clinic_id', '=', 'clinics.id', 'clinics')
            ->leftJoin(KCDoctor::class, 'pe.doctor_id', '=', 'doctors.id', 'doctors')
            ->leftJoin(KCUserMeta::class, function ($join) {
                $join->on('doctors.ID', '=', 'di.user_id')
                    ->onRaw("di.meta_key = 'doctor_profile_image'");
            }, null, null, 'di')
            ->leftJoin(KCUserMeta::class, function ($join) {
                $join->on('doctors.ID', '=', 'doctor_first_name.user_id')
                    ->onRaw("doctor_first_name.meta_key = 'first_name'");
            }, null, null, 'doctor_first_name')
            ->leftJoin(KCUserMeta::class, function ($join) {
                $join->on('doctors.ID', '=', 'doctor_last_name.user_id')
                    ->onRaw("doctor_last_name.meta_key = 'last_name'");
            }, null, null, 'doctor_last_name');

        // Filter bills by assigned clinic for receptionist and clinic admin, or by doctor for doctors
        $current_user_role = $this->kcbase->getLoginUserRole();
        if ($current_user_role == $this->kcbase->getReceptionistRole()) {
            $clinic_id = KCClinic::getClinicIdOfReceptionist();
            if ($clinic_id) {
                $query->where('pe.clinic_id', '=', $clinic_id);
            }
        } elseif ($current_user_role == $this->kcbase->getClinicAdminRole()) {
            $clinic_id = KCClinic::getClinicIdOfClinicAdmin();
            if ($clinic_id) {
                $query->where('pe.clinic_id', '=', $clinic_id);
            }
        } elseif ($current_user_role == $this->kcbase->getDoctorRole()) {
            $doctor_id = get_current_user_id();
            $query->where('pe.doctor_id', '=', $doctor_id);
        } elseif ($current_user_role == $this->kcbase->getPatientRole()) {
            $patient_id = get_current_user_id();
            $query->where('pe.patient_id', '=', $patient_id);
        }

        if (isset($params['search'])) {
            $query
                // Join bill items and services for searching service name
                ->leftJoin(KCBillItem::class, 'bills.id', '=', 'kc_bill_items.bill_id', 'kc_bill_items')
                ->leftJoin(KCService::class, 'kc_bill_items.item_id', '=', 'services.id', 'services')
                ->where(function ($q) use ($params) {
                    $q->where('bills.encounter_id', 'LIKE', "%" . $params['search'] . "%")
                        ->orWhere('bills.id', 'LIKE', "%" . $params['search'] . "%")
                        ->orWhere('doctors.display_name', 'LIKE', "%" . $params['search'] . "%")
                        ->orWhere('clinics.name', 'LIKE', "%" . $params['search'] . "%")
                        ->orWhere('patients.display_name', 'LIKE', "%" . $params['search'] . "%")
                        ->orWhere('bills.payment_status', 'LIKE', "%" . $params['search'] . "%")
                        ->orWhere('services.name', 'LIKE', "%" . $params['search'] . "%");
                });
        }

        if (isset($params['id'])) {
            $query->where('bills.id', '=', (int) $params['id']);
        }
        if (isset($params['encounter_id'])) {
            $query->where('bills.encounter_id', '=', (int) $params['encounter_id']);
        }
        if (!empty($params['doctorName'])) {
            $query->where('doctors.display_name', 'LIKE', '%' . $params['doctorName'] . '%');
        }
        if (isset($params['clinicName'])) {
            $query->where('clinics.name', 'LIKE', '%' . $params['clinicName'] . '%');
        }
        if (isset($params['patientName'])) {
            $query->where('patients.display_name', 'LIKE', '%' . $params['patientName'] . '%');
        }

        if (!empty($params['serviceName'])) {
            // Join bill items and services to filter by service name
            $query->leftJoin(KCBillItem::class, 'bills.id', '=', 'kc_bill_items.bill_id', 'kc_bill_items')
                ->leftJoin(KCService::class, 'kc_bill_items.item_id', '=', 'services.id', 'services')
                ->where('services.name', 'LIKE', '%' . $params['serviceName'] . '%');
        }

        if (isset($params['date_from']) && $params['date_from'] !== '') {
            $startDate = date('Y-m-d 00:00:00', strtotime($params['date_from']));
            $query->where("bills.created_at", '>=', $startDate);
        }
        if (isset($params['date_to']) && $params['date_to'] !== '') {
            $endDate = date('Y-m-d 23:59:59', strtotime($params['date_to']));
            $query->where("bills.created_at", '<=', $endDate);
        }

        if (isset($params['status'])) {
            $query->where('bills.payment_status', '=', $params['status']);
        }

        $total = $query->count();
        $query->groupBy('bills.id');
        
        // Handle sorting
        if (isset($params['orderBy']) && !empty($params['orderBy']) && isset($params['order']) && !empty($params['order'])) {
            $orderBy = $params['orderBy'];
            $order = strtoupper($params['order']);

            // Map frontend column IDs to database columns
            $columnMap = [
                'invoiceId' => 'bills.id',
                'id' => 'bills.id',
                'encounter_id' => 'bills.encounter_id',
                'doctorName' => 'doctors.display_name',
                'patientName' => 'patients.display_name',
                'services' => 'bills.id', // Can't sort by concatenated services, use id as fallback
                'total_amount' => 'bills.total_amount',
                'discount' => 'bills.discount',
                'actual_amount' => 'bills.actual_amount',
                'date' => 'bills.created_at',
                'status' => 'bills.payment_status',
            ];

            // Columns that need numeric sorting (stored as varchar)
            $castColumns = ['total_amount', 'discount', 'actual_amount'];

            if (in_array($orderBy, $castColumns)) {
                $sortColumn = isset($columnMap[$orderBy]) ? $columnMap[$orderBy] : 'bills.id';
                $sortColumn = "CAST($sortColumn AS UNSIGNED)";
            } else {
                $sortColumn = isset($columnMap[$orderBy]) ? $columnMap[$orderBy] : 'bills.id';
            }
            $query->orderBy($sortColumn, $order);
        } else {
            // Default sorting
            $query->orderBy('bills.id', 'DESC');
        }

        // Apply pagination only if not showing all
        if (!$showAll) {
            $page = max(1, intval($params['page'] ?? 1));
            $perPage = intval($params['perPage'] ?? 10);
            $query->limit($perPage)->offset(($page - 1) * $perPage);
        } else {
            // When showing all, set page to 1 and perPage to total
            $page = 1;
            $perPage = $total;
        }
        $bills = $query->get();

        // Format bills
        $billsData = [];
        foreach ($bills as $bill) {
            // Fetch bill items and their service names
            $billItems = KCBillItem::query()
                ->setTableAlias('kc_bill_items')
                ->where('bill_id', $bill->id)
                ->leftJoin(KCService::class, 'item_id', '=', 'services.id', 'services')
                ->select(['services.name as service_name', 'services.id as service_id', 'kc_bill_items.qty as qty', 'kc_bill_items.price as price'])
                ->get();
            // Collect service names
            $serviceNames = [];
            $serviceIds = [];
            foreach ($billItems as $index => $item) {
                if (!empty($item->service_name)) {
                    $serviceNames[] = $item->service_name;
                }
                $serviceIds[] = $item->service_id;
            }
            $serviceString = implode(', ', array_unique($serviceNames));
            $discount = $bill->discount ?? 0;
            $billsData[] = [
                'id' => $bill->id,
                'invoiceId' => $bill->id,
                'encounter_id' => $bill->encounterId,
                'date' => kcGetFormatedDate($bill->createdAt),
                'status' => $bill->paymentStatus,
                'patient' => [
                    'name' => $bill->patient_name,
                    'email' => $bill->patient_email,
                    'patient_image_url' => $bill->patient_profile_image ? wp_get_attachment_url($bill->patient_profile_image) : '',
                ],
                'clinic' => [
                    'id' => (int) $bill->clinicId,
                    'name' => $bill->clinic_name,
                    'email' => $bill->clinic_email,
                    'clinic_image_url' => $bill->clinic_profile_image ? wp_get_attachment_url($bill->clinic_profile_image) : '',
                ],
                'doctor' => [
                    'id' => (int) $bill->doctor_id,
                    'name' => $bill->doctor_name,
                    'email' => $bill->doctor_email,
                    'doctor_image_url' => $bill->doctor_profile_image ? wp_get_attachment_url($bill->doctor_profile_image) : '',
                ],
                'services' => $serviceString,
                'discount' => $discount,
                'total_amount' => round($bill->totalAmount,2),
                'actual_amount' => round($bill->actualAmount,2),
            ];
        }

        $data = [
            'billings' => $billsData,
            'pagination' => [
                'total' => $total,
                'perPage' => $perPage,
                'currentPage' => $page,
                'lastPage' => ceil($total / $perPage)
            ]
        ];

        return $this->response($data, __('Bills retrieved successfully', 'kivicare-pro'));
    }


    /**
     * Update a bill item
     */
    public function updateBillItem(\WP_REST_Request $request): \WP_REST_Response
    {
        $item_id = $request->get_param('item_id');
        $serviceId = $request->get_param('serviceId');
        $quantity = $request->get_param('quantity');
        $price = $request->get_param('price');

        $billItem = KCBillItem::find($item_id);

        if (!$billItem) {
            return $this->response(null, __('Bill item not found', 'kivicare-pro'), false, 404);
        }

        $billItem->itemId = $serviceId;
        $billItem->qty = $quantity;
        $billItem->price = $price;
        $result = $billItem->save();

        if ($result) {
            return $this->response(['id' => $item_id], __('Bill item updated successfully', 'kivicare-pro'));
        }
        return $this->response(null, __('Failed to update bill item', 'kivicare-pro'), false, 500);
    }

    /**
     * Delete a single bill item
     */
    public function deleteBillItem(WP_REST_Request $request): WP_REST_Response
    {
        $item_id = $request->get_param('item_id');
        $billItem = KCBillItem::find($item_id);

        if (!$billItem) {
            return $this->response(null, __('Bill item not found', 'kivicare-pro'), false, 404);
        }

        $result = $billItem->delete();
        if ($result) {
            return $this->response(['id' => $item_id], __('Bill item deleted successfully', 'kivicare-pro'));
        }
        return $this->response(null, __('Failed to delete bill item', 'kivicare-pro'), false, 500);
    }

        /**
     * Export bills data with filters
     */
    public function exportBills(\WP_REST_Request $request): \WP_REST_Response
    {
        $params = $request->get_params();

        $query = KCBill::table('bills')
            ->select([
                'bills.*',
                'pe.id as encounterId',
                'pe.encounter_date as encounterDate',
                'pe.appointment_id as appointmentId',
                'patients.id as patientId',
                'patients.display_name as patient_name',
                'clinics.id as clinicId',
                'clinics.name as clinic_name',
                'doctors.id as doctorId',
                'doctors.display_name as doctor_name',
            ])
            ->leftJoin(KCPatientEncounter::class, 'bills.encounter_id', '=', 'pe.id', 'pe')
            ->leftJoin(KCPatient::class, 'pe.patient_id', '=', 'patients.id', 'patients')
            ->leftJoin(KCClinic::class, 'pe.clinic_id', '=', 'clinics.id', 'clinics')
            ->leftJoin(KCDoctor::class, 'pe.doctor_id', '=', 'doctors.id', 'doctors');

        // Pagination (support perPage=all)
        $page = isset($params['page']) ? max(1, (int) $params['page']) : 1;
        $perPageParam = $params['perPage'] ?? 10;
        $showAll = is_string($perPageParam) && strtolower($perPageParam) === 'all';

        // Filter bills by assigned clinic for receptionist and clinic admin, or by doctor for doctors
        $current_user_role = $this->kcbase->getLoginUserRole();
        if (isKiviCareProActive()) {
            if ($current_user_role == $this->kcbase->getReceptionistRole()) {
                $clinic_id = KCClinic::getClinicIdOfReceptionist();
                if ($clinic_id) {
                    $query->where('pe.clinic_id', '=', $clinic_id);
                }
            } elseif ($current_user_role == $this->kcbase->getClinicAdminRole()) {
                $clinic_id = KCClinic::getClinicIdOfClinicAdmin();
                if ($clinic_id) {
                    $query->where('pe.clinic_id', '=', $clinic_id);
                }
            } elseif ($current_user_role == $this->kcbase->getDoctorRole()) {
                $doctor_id = get_current_user_id();
                $query->where('pe.doctor_id', '=', $doctor_id);
            } elseif ($current_user_role == $this->kcbase->getPatientRole()) {
                $patient_id = get_current_user_id();
                $query->where('pe.patient_id', '=', $patient_id);
            }
        }

        if (!empty($params['search'])) {
            $query
                ->leftJoin(KCBillItem::class, 'bills.id', '=', 'kc_bill_items.bill_id', 'kc_bill_items')
                ->leftJoin(KCService::class, 'kc_bill_items.item_id', '=', 'services.id', 'services')
                ->where(function ($q) use ($params) {
                    $q->where('bills.encounter_id', 'LIKE', '%' . $params['search'] . '%')
                        ->orWhere('bills.id', 'LIKE', '%' . $params['search'] . '%')
                        ->orWhere('doctors.display_name', 'LIKE', '%' . $params['search'] . '%')
                        ->orWhere('clinics.name', 'LIKE', '%' . $params['search'] . '%')
                        ->orWhere('patients.display_name', 'LIKE', '%' . $params['search'] . '%')
                        ->orWhere('bills.payment_status', 'LIKE', '%' . $params['search'] . '%')
                        ->orWhere('services.name', 'LIKE', '%' . $params['search'] . '%');
                });
        }

        if (isset($params['id'])) {
            $query->where('bills.id', '=', (int) $params['id']);
        }
        if (isset($params['encounter_id'])) {
            $query->where('bills.encounter_id', '=', (int) $params['encounter_id']);
        }
        if (!empty($params['doctorName'])) {
            $query->where('doctors.display_name', 'LIKE', '%' . $params['doctorName'] . '%');
        }
        if (isset($params['clinicName'])) {
            $query->where('clinics.name', 'LIKE', '%' . $params['clinicName'] . '%');
        }
        if (isset($params['patientName'])) {
            $query->where('patients.display_name', 'LIKE', '%' . $params['patientName'] . '%');
        }

        if (!empty($params['serviceName'])) {
            $query->leftJoin(KCBillItem::class, 'bills.id', '=', 'kc_bill_items.bill_id', 'kc_bill_items')
                ->leftJoin(KCService::class, 'kc_bill_items.item_id', '=', 'services.id', 'services')
                ->where('services.name', 'LIKE', '%' . $params['serviceName'] . '%');
        }

        if (!empty($params['date_from'])) {
            $startDate = date('Y-m-d 00:00:00', strtotime($params['date_from']));
            $query->where('bills.created_at', '>=', $startDate);
        }
        if (!empty($params['date_to'])) {
            $endDate = date('Y-m-d 23:59:59', strtotime($params['date_to']));
            $query->where('bills.created_at', '<=', $endDate);
        }
        if (!empty($params['status'])) {
            $query->where('bills.payment_status', '=', $params['status']);
        }

        $totalQuery = clone $query;
        $total = $totalQuery->countDistinct('bills.id');

        // Handle sorting
        if (isset($params['orderBy']) && !empty($params['orderBy']) && isset($params['order']) && !empty($params['order'])) {
            $orderBy = $params['orderBy'];
            $order = strtoupper($params['order']);

            $columnMap = [
                'invoiceId' => 'bills.id',
                'id' => 'bills.id',
                'encounter_id' => 'bills.encounter_id',
                'doctorName' => 'doctors.display_name',
                'patientName' => 'patients.display_name',
                'services' => 'bills.id',
                'total_amount' => 'bills.total_amount',
                'discount' => 'bills.discount',
                'actual_amount' => 'bills.actual_amount',
                'date' => 'bills.created_at',
                'status' => 'bills.payment_status',
            ];

            $castColumns = ['total_amount', 'discount', 'actual_amount'];

            if (in_array($orderBy, $castColumns)) {
                $sortColumn = isset($columnMap[$orderBy]) ? $columnMap[$orderBy] : 'bills.id';
                $sortColumn = "CAST($sortColumn AS UNSIGNED)";
            } else {
                $sortColumn = isset($columnMap[$orderBy]) ? $columnMap[$orderBy] : 'bills.id';
            }
            $query->orderBy($sortColumn, $order);
        } else {
            $query->orderBy('bills.id', 'DESC');
        }

        $query->groupBy('bills.id');

        if ($showAll) {
            $per_page = $total > 0 ? $total : 1;
            $page = 1;
            $offset = 0;
        } else {
            $per_page = (int) $perPageParam;
            if ($per_page <= 0) {
                $per_page = 10;
            }
            $offset = ($page - 1) * $per_page;
        }

        if (!$showAll) {
            $query->limit($per_page)->offset($offset);
        }

        $bills = $query->get();
        $export = [];
        foreach ($bills as $bill) {
            // Collect comma-separated service names
            $billItems = KCBillItem::query()
                ->setTableAlias('kc_bill_items')
                ->where('bill_id', $bill->id)
                ->leftJoin(KCService::class, 'item_id', '=', 'services.id', 'services')
                ->select(['services.name as service_name'])
                ->get();
            $serviceNames = [];
            foreach ($billItems as $item) {
                if (!empty($item->service_name)) {
                    $serviceNames[] = $item->service_name;
                }
            }
            $serviceString = implode(', ', array_unique($serviceNames));

            $export[] = [
                'id' => (int) $bill->id,
                'total_amount' => (float) ($bill->totalAmount ?? 0),
                'discount' => !empty($bill->discount) ? (float) $bill->discount : '-',
                'actual_amount' => (float) ($bill->actualAmount ?? 0),
                'encounter_id' => (int) ($bill->encounterId ?? 0),
                'encounter_date' => $bill->encounterDate ?? $bill->createdAt,
                'clinic_id' => (int) ($bill->clinicId ?? 0),
                'doctor_id' => (int) ($bill->doctorId ?? 0),
                'patient_id' => (int) ($bill->patientId ?? 0),
                'appointment_id' => !empty($bill->appointmentId) ? (int) $bill->appointmentId : '-',
                'status' => $bill->paymentStatus ?? $bill->payment_status,
                'doctor_name' => $bill->doctor_name ?? '',
                'patient_name' => $bill->patient_name ?? '',
                'clinic_name' => $bill->clinic_name ?? '',
                'service_name' => $serviceString,
            ];
        }

        return $this->response([
            'bills' => $export,
        ], __('Bills data retrieved successfully', 'kivicare-pro'), true, 200);
    }

    public function emailBill(WP_REST_Request $request): WP_REST_Response
    {
        try {
            $bill_id = $request->get_param('id');
            if (empty($bill_id)) {
                return $this->response(false, __('Bill ID is required', 'kivicare-pro'), false, 400);
            }

            $bill = KCBill::find($bill_id);
            if (!$bill) {
                return $this->response(false, __('Bill not found', 'kivicare-pro'), false, 404);
            }

            $encounter = $bill->getEncounter();
            $clinic = $bill->getClinic();
            $billItems = $bill->getBillItems();
            $patient = $encounter ? $encounter->getPatient() : null;
            $doctor = $encounter ? $encounter->getDoctor() : null;

            if (!$patient || empty($patient->email)) {
                return $this->response(false, __('Patient email not found', 'kivicare-pro'), false, 400);
            }

            // Get currency details
            $currency_details = $this->get_currency_details();
            
            // Get tax items
            $tax_items = $this->get_tax_data_for_bill($bill);
            
            // Get payment method
            $payment_method = 'N/A';
            if ($bill->appointmentId) {
                $payment_method = KCPaymentsAppointmentMapping::getPaymentModeByAppointmentId($bill->appointmentId);
            }

            // Get clinic logo
            $clinicLogo = [
                'id'  => $clinic->clinicLogo,
                'url' => $clinic->clinicLogo ? wp_get_attachment_url($clinic->clinicLogo) : '',
            ];

            // Get patient meta for additional details if needed
            $patient_meta = null;
            if ($patient) {
                $patient_meta = json_decode($patient->getMeta('basic_data'));
            }

            $bill_data = [
                'bill' => [
                    'id' => $bill->id,
                    'invoice_id' => $bill->id,
                    'date' => kcGetFormatedDate(date('Y-m-d', strtotime($bill->createdAt))),
                    'status' => $bill->paymentStatus ?? 'pending',
                    'sub_total' => $bill->totalAmount ?? '0.00',
                    'discount' => $bill->discount ?? '0.00',
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
                'currency_detail' => $currency_details,
                'clinic_logo' => $clinicLogo,
                'payment_method' => $payment_method,
                'tax_items' => $tax_items,
            ];

            $html = $this->renderBillTemplate($bill_data, $billItems);
            $pdf_content = $this->generatePdf($html);
            $temp_file = sys_get_temp_dir() . '/bill_' . $bill_id . '_' . time() . '.pdf';
            file_put_contents($temp_file, $pdf_content);

            $templateManager = KCEmailTemplateManager::getInstance();
            $template = $templateManager->getTemplate(KIVI_CARE_PREFIX . 'patient_invoice');
            
            if ($template) {
                $templateProcessor = new KCEmailTemplateProcessor();
                $emailData = [
                    'patient_name' => $bill_data['patient']['name'],
                    'bill_id' => $bill_id,
                    'total_amount' => '$' . $bill_data['bill']['actual_amount'],
                    'clinic_name' => $bill_data['clinic']['name'] ?? '',
                    'current_date' => current_time('Y-m-d'),
                ];
                $subject = $templateProcessor->processTemplate($template->post_title, $emailData);
                $message = $templateProcessor->processTemplate($template->post_content, $emailData);
            } else {
                $subject = sprintf(__('Bill #%s', 'kivicare-pro'), $bill_id);
                $message = __('Please find attached your bill.', 'kivicare-pro');
            }

            $headers = ['Content-Type: text/html; charset=UTF-8'];
            $sent = wp_mail($bill_data['patient']['email'], $subject, $message, $headers, [$temp_file]);
            @unlink($temp_file);

            if ($sent) {
                return $this->response(true, __('Bill sent successfully', 'kivicare-pro'));
            }
            return $this->response(false, __('Failed to send email', 'kivicare-pro'), false, 500);
        } catch (\Exception $e) {
            return $this->response(false, $e->getMessage(), false, 500);
        }
    }

    private function generatePdf($html): string
    {
        return KCPdfGenerator::generate($html, '', 'S');
    }

    private function renderBillTemplate($bill_data, $billItems): string
    {
        $template_file = $this->getBillTemplateFile();
        if (!file_exists($template_file)) {
            throw new \Exception(__('Bill template not found', 'kivicare-pro'));
        }
        ob_start();
        
        // Extract all data from bill_data array
        extract($bill_data);
        
        // Prepare service items
        $service_items = $billItems ? $billItems->map(function($item) {
            $service = $item->getItem();
            return [
                'name' => $service ? $service->name : 'Service',
                'price' => $item->price ?? '0.00',
                'quantity' => $item->qty ?? 1,
                'discount' => '0.00',
                'total' => $item->getTotal(),
            ];
        })->toArray() : [];
        
        include $template_file;
        return ob_get_clean();
    }

    private function getBillTemplateFile(): string
    {
        $child_theme_path = get_stylesheet_directory() . '/kivicare/KCBillPrintTemplate.php';
        if (file_exists($child_theme_path)) {
            return $child_theme_path;
        }
        $parent_theme_path = get_template_directory() . '/kivicare/KCBillPrintTemplate.php';
        if (file_exists($parent_theme_path)) {
            return $parent_theme_path;
        }
        return KIVI_CARE_PRO_DIR . '/templates/KCBillPrintTemplate.php';
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
}
