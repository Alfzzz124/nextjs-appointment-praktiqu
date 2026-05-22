<?php

namespace KCProApp\controllers\api;

use App\baseClasses\KCBaseController;
use App\models\KCClinic;
use App\models\KCDoctor;
use App\models\KCService;
use App\models\KCServiceDoctorMapping;
use KCProApp\models\KCPTax;
use App\models\KCUserMeta;

defined('ABSPATH') or die('Something went wrong');

/**
 * Class KCProTaxController
 * 
 * API Controller for Tax-related endpoints
 * 
 * @package App\controllers\api
 */
class KCProTaxController extends KCBaseController
{

    protected $route = 'taxes';
    /**
     * Register routes for this controller
     */
    public function registerRoutes()
    {
        // get taxs
        $this->registerRoute('/' . $this->route, [
            'methods' => 'GET',
            'callback' => [$this, 'getTaxes'],
            'permission_callback' => [$this, 'checkPermission'],
        ]);

        // get single tax
        $this->registerRoute('/' . $this->route . '/(?P<id>\d+)', [
            'methods' => 'GET',
            'callback' => [$this, 'getTax'],
            'permission_callback' => [$this, 'checkPermission'],
            'args' => [
                'id' => [
                    'description' => 'Tax ID',
                    'type' => 'integer',
                    'required' => true,
                    'sanitize_callback' => 'absint',
                    'validate_callback' => function ($param) {
                        return is_numeric($param) && $param > 0;
                    },
                ],
            ],
        ]);

        // Create tax
        $this->registerRoute('/' . $this->route, [
            'methods' => 'POST',
            'callback' => [$this, 'createTax'],
            'permission_callback' => [$this, 'checkCreatePermission'],
            'args' => $this->getCreateEndpointArgs()

        ]);


        // Update tax
        $this->registerRoute('/' . $this->route . '/(?P<id>\d+)', [
            'methods' => 'PUT',
            'callback' => [$this, 'updateTax'],
            'permission_callback' => [$this, 'checkCreatePermission'],
            'args' => $this->getCreateEndpointArgs()
        ]);

        // get single tax
        $this->registerRoute('/' . $this->route . '/(?P<id>\d+)', [
            'methods' => 'DELETE',
            'callback' => [$this, 'deleteTax'],
            'permission_callback' => [$this, 'checkPermission'],
            'args' => [
                'id' => [
                    'description' => 'Tax ID',
                    'type' => 'integer',
                    'required' => true,
                    'sanitize_callback' => 'absint',
                    'validate_callback' => function ($param) {
                        return is_numeric($param) && $param > 0;
                    },
                ],
            ],
        ]);

        //  Single Tax Status Update
        $this->registerRoute('/' . $this->route . '/(?P<id>\d+)/status', [
            'methods' => 'PUT',
            'callback' => [$this, 'updateTaxStatus'],
            'permission_callback' => [$this, 'checkCreatePermission'],
            'args' => [
                'id' => [
                    'description' => 'Tax ID',
                    'type' => 'integer',
                    'required' => true,
                    'sanitize_callback' => 'absint',
                    'validate_callback' => function ($param) {
                        return is_numeric($param) && $param > 0;
                    },
                ],
                'status' => [
                    'description' => 'New status (0 or 1)',
                    'type' => 'integer',
                    'required' => true,
                    'validate_callback' => function ($param) {
                        return in_array((int) $param, [0, 1], true);
                    },
                ],
            ],
        ]);

        //  Bulk Status Update
        $this->registerRoute('/' . $this->route . '/bulk/status', [
            'methods' => 'PUT',
            'callback' => [$this, 'bulkUpdateTaxStatus'],
            'permission_callback' => [$this, 'checkCreatePermission'],
            'args' => [
                'ids' => [
                    'description' => 'Array of tax IDs',
                    'type' => 'array',
                    'items' => ['type' => 'integer'],
                    'required' => true,
                ],
                'status' => [
                    'description' => 'New status (0 or 1)',
                    'type' => 'integer',
                    'required' => true,
                    'validate_callback' => function ($param) {
                        return in_array((int) $param, [0, 1], true);
                    },
                ],
            ],
        ]);

        //  Bulk Delete
        $this->registerRoute('/' . $this->route . '/bulk/delete', [
            'methods' => 'POST',
            'callback' => [$this, 'bulkDeleteTaxes'],
            'permission_callback' => [$this, 'checkCreatePermission'],
            'args' => [
                'ids' => [
                    'description' => 'Array of tax IDs to delete',
                    'type' => 'array',
                    'items' => ['type' => 'integer'],
                    'required' => true,
                ],
            ],
        ]);

        // Export taxes data
        $this->registerRoute('/' . $this->route . '/export', [
            'methods' => 'GET',
            'callback' => [$this, 'exportTaxes'],
            'permission_callback' => [$this, 'checkPermission'],
            'args' => $this->getExportEndpointArgs()
        ]);
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
            'taxName' => [
                'description' => 'Search term for tax name',
                'type' => 'string',
                'sanitize_callback' => 'sanitize_text_field',
            ],
            'status' => [
                'description' => 'Tax status (0 or 1)',
                'type' => 'integer',
                'validate_callback' => function ($param) {
                    return in_array((int)$param, [0, 1], true) || $param === '';
                },
            ],
            'clinic' => [
                'description' => 'Clinic ID',
                'type' => 'integer',
                'sanitize_callback' => 'absint',
            ],
            'doctor' => [
                'description' => 'Doctor ID or array of doctor IDs',
                'type' => 'array',
                'items' => ['type' => 'integer'],
                'validate_callback' => function ($param) {
                    if (is_array($param)) {
                        foreach ($param as $id) {
                            if (!is_numeric($id)) return false;
                        }
                        return true;
                    }
                    return is_numeric($param);
                },
                'sanitize_callback' => function($param) {
                    if (is_array($param)) {
                        return array_map('intval', $param);
                    }
                    return intval($param);
                },
            ],
            'service' => [
                'description' => 'Service ID or array of service IDs',
                'type' => 'array',
                'items' => ['type' => 'integer'],
                'validate_callback' => function ($param) {
                    if (is_array($param)) {
                        foreach ($param as $id) {
                            if (!is_numeric($id)) return false;
                        }
                        return true;
                    }
                    return is_numeric($param);
                },
                'sanitize_callback' => function($param) {
                    if (is_array($param)) {
                        return array_map('intval', $param);
                    }
                    return intval($param);
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
        ];
    }

    /**
     * Get arguments for the create/update tax endpoint
     *
     * @return array
     */
    protected function getCreateEndpointArgs()
    {
        return [
            'name' => [
                'required' => false,
                'type' => 'string',
                'sanitize_callback' => 'sanitize_text_field',
            ],
            'rateType' => [
                'required' => false,
                'type' => 'string',
                'sanitize_callback' => 'sanitize_text_field',
            ],
            'rateValue' => [
                'required' => false,
                'type' => 'string',
                'sanitize_callback' => 'sanitize_text_field',
            ],
            'clinicId' => [
                'required' => false,
                'type' => 'integer',
                'validate_callback' => 'is_numeric',
            ],
            'doctorId' => [
                'required' => false,
                'type' => 'array',
                'items' => ['type' => 'integer'],
                'validate_callback' => function ($value) {
                    if (!is_array($value)) return false;
                    foreach ($value as $id) {
                        if (!is_numeric($id)) return false;
                    }
                    return true;
                },
            ],
            'serviceId' => [
                'required' => false,
                'type' => 'array',
                'items' => ['type' => 'integer'],
                'validate_callback' => function ($value) {
                    if (!is_array($value)) return false;
                    foreach ($value as $id) {
                        if (!is_numeric($id)) return false;
                    }
                    return true;
                },
            ],
            'addedBy' => [
                'required' => false,
                'type' => 'integer',
                'validate_callback' => 'is_numeric',
            ],
            'status' => [
                'required' => false,
                'type' => 'integer',
                'validate_callback' => function ($value) {
                    return in_array((int)$value, [0, 1], true); // Assuming 0 or 1 status
                },
            ],
            'createdAt' => [
                'required' => false,
                'type' => 'string',
                'validate_callback' => function ($value) {
                    return strtotime($value) !== false;
                },
            ],
        ];
    }


    /**
     * Check if user has permission to create an tax
     * 
     * @param \WP_REST_Request $request
     * @return bool
     */
    public function checkCreatePermission($request)
    {
        // Check basic read permission first
        if (!$this->checkCapability('read')) {
            return false;
        }

        // Check tax add permission
        return $this->checkResourceAccess('tax', 'add');
    }

    /**
     * Check if user has permission to access the endpoint
     * 
     * @param \WP_REST_Request $request
     * @return bool
     */
    public function checkPermission($request)
    {
        // Default permission check - can be overridden in child classes
        return current_user_can('read');
    }

    /**
     * Create new tax
     * 
     * @param \WP_REST_Request $request
     * @return \WP_REST_Response|\WP_Error
     */
    public function createTax($request)
    {
        $params = $request->get_params();

        try {
            $rateValue = $params['rateValue'] ?? $params['rate_value'] ?? null;
            $rateType = $params['rateType'] ?? $params['ratetype'] ?? $params['rate_type'] ?? null;

            // Validate tax rate value (do not allow 0 or negative)
            if (empty($rateValue) || !is_numeric($rateValue) || (float)$rateValue <= 0) {
                return new \WP_Error(
                    'kc_tax_invalid_rate',
                    __('Tax rate must be greater than 0.', 'kivicare-pro'),
                    ['rateValue' => $rateValue]
                );
            }

            $clinicId = $params['clinic'] ?? $params['clinic_id'] ?? -1;

            // Extract doctor IDs from array of objects or simple array
            $doctors = [];
            $rawDoctors = $params['doctor'] ?? $params['doctor_id'] ?? [];
            if (is_array($rawDoctors)) {
                foreach ($rawDoctors as $doc) {
                    if (is_array($doc) && isset($doc['value'])) {
                        $doctors[] = (int) $doc['value'];
                    } elseif (is_numeric($doc)) {
                        $doctors[] = (int) $doc;
                    }
                }
            } elseif (is_numeric($rawDoctors)) {
                $doctors = [(int) $rawDoctors];
            }
            $doctors = array_filter($doctors, function($id) { return $id !== -1; });

            // Extract service IDs from array of objects or simple array
            $services = [];
            $rawServices = $params['service'] ?? $params['service_id'] ?? [];
            if (is_array($rawServices)) {
                foreach ($rawServices as $serv) {
                    if (is_array($serv) && isset($serv['value'])) {
                        $services[] = (int) $serv['value'];
                    } elseif (is_array($serv) && isset($serv['id'])) {
                        $services[] = (int) $serv['id'];
                    } elseif (is_numeric($serv)) {
                        $services[] = (int) $serv;
                    }
                }
            } elseif (is_numeric($rawServices)) {
                $services = [(int) $rawServices];
            }
            $services = array_filter($services, function($id) { return $id !== -1; });
            
            $createdTaxes = [];
            $skippedDuplicates = [];

            // If both doctors and services are specified, get valid mappings
            if (!empty($doctors) && !empty($services)) {
                $validMappings = KCServiceDoctorMapping::query()
                    ->whereIn('doctor_id', $doctors)
                    ->whereIn('service_id', $services)
                    ->where('status', 1)
                    ->get();

                foreach ($validMappings as $mapping) {
                    // Check if tax already exists for this combination
                    $query = KCPTax::query()
                        ->where('name', $params['name'] ?? '')
                        ->where('taxType', $rateType ?? '');

                    // Handle clinic_id
                    if (!empty($clinicId) && $clinicId !== -1) {
                        $query->where('clinicId', (int) $clinicId);
                    } else {
                        $query->whereNull('clinicId');
                    }

                    $query->where('doctorId', (int) $mapping->doctorId)
                          ->where('serviceId', (int) $mapping->id);

                    $existing_tax = $query->first();
                    if ($existing_tax) {
                        $skippedDuplicates[] = [
                            'clinic' => $clinicId,
                            'doctor' => $mapping->doctorId,
                            'service' => $mapping->id
                        ];
                        continue;
                    }

                    // Create tax - store mapping ID (required for tax calculations)
                    $tax = new KCPTax();
                    $tax->name = $params['name'] ?? null;
                    $tax->taxType = $rateType;
                    $tax->taxValue = $rateValue;
                    $tax->clinicId = $clinicId;
                    $tax->doctorId = $mapping->doctorId;
                    $tax->serviceId = $mapping->id;
                    $tax->addedBy = get_current_user_id();
                    $tax->status = $params['status'] ?? 1;
                    $tax->createdAt = current_time('mysql');
                    $tax->save();

                    $createdTaxes[] = $tax->id;
                }
            } else {
                // Handle cases where doctors or services are not specified (all combinations)
                $doctorList = !empty($doctors) ? $doctors : [-1];
                $serviceList = !empty($services) ? $services : [-1];

                foreach ($doctorList as $doctorId) {
                    foreach ($serviceList as $serviceId) {
                        // Check if tax already exists for this combination
                        $query = KCPTax::query()
                            ->where('name', $params['name'] ?? '')
                            ->where('taxType', $rateType ?? '');

                        // Handle clinic_id
                        if (!empty($clinicId) && $clinicId !== -1) {
                            $query->where('clinicId', (int) $clinicId);
                        } else {
                            $query->where(function($q) {
                                $q->where('clinicId', -1)
                                  ->orWhereNull('clinicId');
                            });
                        }

                        // Handle doctor_id
                        if ($doctorId !== -1) {
                            $query->where('doctorId', (int) $doctorId);
                        } else {
                            $query->where(function($q) {
                                $q->where('doctorId', -1)
                                  ->orWhereNull('doctorId');
                            });
                        }

                        // Handle service_id
                        if ($serviceId !== -1) {
                            $query->where('serviceId', (int) $serviceId);
                        } else {
                            $query->where(function($q) {
                                $q->where('serviceId', -1)
                                  ->orWhereNull('serviceId');
                            });
                        }

                        $existing_tax = $query->first();

                        if ($existing_tax) {
                            $skippedDuplicates[] = [
                                'clinic' => $clinicId,
                                'doctor' => $doctorId,
                                'service' => $serviceId
                            ];
                            continue;
                        }

                        // Convert service ID to mapping ID if both doctor and service specified
                        if ($doctorId !== -1 && $serviceId !== -1) {
                            $mappingQuery = KCServiceDoctorMapping::query()
                                ->where('doctor_id', $doctorId)
                                ->where('service_id', $serviceId)
                                ->where('status', 1);
                            
                            if (!empty($clinicId) && $clinicId !== -1) {
                                $mappingQuery->where('clinic_id', (int) $clinicId);
                            }
                            
                            $mapping = $mappingQuery->first();
                            if (!$mapping) {
                                continue;
                            }
                            $serviceId = $mapping->id; // Use mapping ID for storage
                        }

                        // Create tax
                        $tax = new KCPTax();
                        $tax->name = $params['name'] ?? null;
                        $tax->taxType = $rateType;
                        $tax->taxValue = $rateValue;
                        $tax->clinicId = $clinicId;
                        $tax->doctorId = $doctorId;
                        $tax->serviceId = $serviceId;
                        $tax->addedBy = get_current_user_id();
                        $tax->status = $params['status'] ?? 1;
                        $tax->createdAt = current_time('mysql');
                        $tax->save();

                        $createdTaxes[] = $tax->id;
                    }
                }
            }

            if (empty($createdTaxes)) {
                return new \WP_Error(
                    'kc_tax_create_failed',
                    __('No taxes could be created. All combinations already exist or have no valid mappings.', 'kivicare-pro')
                );
            }

            $message = __('Tax created successfully', 'kivicare-pro');
            if (!empty($skippedDuplicates)) {
                $message .= sprintf(__(' (%d combinations skipped due to duplicates)', 'kivicare-pro'), count($skippedDuplicates));
            }

            return $this->response([
                'ids' => $createdTaxes,
                'created_count' => count($createdTaxes),
                'skipped_count' => count($skippedDuplicates)
            ], $message);
        } catch (\Exception $e) {
            return new \WP_Error(
                'kc_tax_create_failed',
                __('Failed to create tax.', 'kivicare-pro'),
                ['error' => $e->getMessage()]
            );
        }
    }

    public function getTaxes($request)
    {
        try {
            $currentUserRole = $this->kcbase->getLoginUserRole();
            $currentUserId = get_current_user_id();

            $query = KCPTax::table('t')
                ->select([
                    't.*',
                    'c.name as clinic_name',
                    'c.profile_image as clinic_profile_image',
                    'c.email as clinic_email',
                    'd.display_name as doctor_name',
                    'd.user_email as doctor_email',
                    'um_doctor.meta_value as doctor_profile_image',
                    's.name as service_name',
                    's.id as actual_service_id',  // Fetch actual service ID
                    'k.image as service_image'
                ])
                ->leftJoin(KCClinic::class, 't.clinic_id', '=', 'c.id', 'c')
                ->leftJoin(KCDoctor::class, 't.doctor_id', '=', 'd.id', 'd')
                ->leftJoin(KCServiceDoctorMapping::class, function ($join) {
                    // If t.service_id stores a mapping id, resolve it via k.id.
                    // Do not block this join by doctor_id; otherwise actual service can't be resolved.
                    $join->on('t.service_id', '=', 'k.id');
                }, null, null, 'k')
                ->leftJoin(KCService::class, function ($join) {
                    $join->onRaw('(k.id IS NOT NULL AND s.id = k.service_id) OR (k.id IS NULL AND s.id = t.service_id)');
                }, null, null, 's')
                ->leftJoin(KCUserMeta::class, function ($join) {
                    $join->on('d.id', '=', 'um_doctor.user_id')
                        ->onRaw("um_doctor.meta_key = 'doctor_profile_image'");
                }, null, null, 'um_doctor');

            // Role-based filtering for clinic admin
            if ($currentUserRole === $this->kcbase->getClinicAdminRole()) {
                $query->where(function ($q) use ($currentUserId) {
                    $q->where('c.clinic_admin_id', $currentUserId)
                        ->orWhere('t.clinic_id', -1)
                        ->orWhereNull('t.clinic_id');
                });
            }

            // Apply filters if provided
            if (!empty($request['id'])) {
                $query->where('t.id', (int) $request['id']);
            }

            if (!empty($request['taxName'])) {
                $query->where('t.name', 'LIKE', '%' . esc_sql($request['taxName']) . '%');
            }

            if (isset($request['status']) && $request['status'] !== '') {
                $query->where('t.status', (int) $request['status']);
            }

            if (!empty($request['clinic'])) {
                $clinicId = $request['clinic'];
                if (is_array($clinicId) && isset($clinicId['value'])) {
                    $clinicId = $clinicId['value'];
                }
                $query->where('c.id', (int) $clinicId);
            }

            if (!empty($request['doctor'])) {
                if (is_array($request['doctor'])) {
                    $query->whereIn('d.id', $request['doctor']);
                } else {
                    $doctorId = $request['doctor'];
                    if (is_array($doctorId) && isset($doctorId['value'])) {
                        $doctorId = $doctorId['value'];
                    }
                    $query->where('d.id', (int) $doctorId);
                }
            }

            if (!empty($request['service'])) {
                if (is_array($request['service'])) {
                    // Check if it's an array of objects with 'value' key
                    $serviceIds = [];
                    foreach ($request['service'] as $service) {
                        if (is_array($service) && isset($service['value'])) {
                            $serviceIds[] = (int) $service['value'];
                        } elseif (is_numeric($service)) {
                            $serviceIds[] = (int) $service;
                        }
                    }
                    if (!empty($serviceIds)) {
                        $query->whereIn('t.service_id', $serviceIds);
                    }
                } else {
                    $serviceId = $request['service'];
                    if (is_array($serviceId) && isset($serviceId['value'])) {
                        $serviceId = $serviceId['value'];
                    }
                    $query->where('t.service_id', (int) $serviceId);
                }
            }

            // Apply sorting
            if (!empty($request['orderby'])) {
                $orderby = $request['orderby'];
                $direction = !empty($request['order']) && strtolower($request['order']) === 'desc' ? 'DESC' : 'ASC';

                switch ($orderby) {
                    case 'taxName':
                        $query->orderBy('t.name', $direction);
                        break;
                    case 'taxRate':
                        $query->orderBy("CAST(t.tax_value AS DECIMAL(10,2))", $direction);
                        break;
                    case 'clinicName':
                        $query->orderBy('c.name', $direction);
                        break;
                    case 'doctorName':
                        $query->orderBy('d.display_name', $direction);
                        break;
                    case 'serviceName':
                        $query->orderBy('s.name', $direction);
                        break;
                    case 'status':
                        $query->orderBy('t.status', $direction);
                        break;
                    case 'id':
                    default:
                        $query->orderBy('t.id', $direction);
                        break;
                }
            } else {
                $query->orderBy('t.id', 'DESC');
            }

            $query->groupBy('t.id');

            // Pagination (support perPage=all)
            $page = isset($request['page']) ? max(1, (int) $request['page']) : 1;
            $perPageParam = $request['perPage'] ?? 10;
            $showAll = is_string($perPageParam) && strtolower($perPageParam) === 'all';

            $totalQuery = clone $query;
            if (method_exists($totalQuery, 'removeGroupBy')) {
                $totalQuery->removeGroupBy();
            }
            $total = $totalQuery->countDistinct('t.id');

            if ($showAll) {
                $per_page = $total > 0 ? $total : 1;
                $page = 1;
                $taxes = $query->get();
            } else {
                $per_page = (int) $perPageParam;
                if ($per_page <= 0) {
                    $per_page = 10;
                }
                $offset = ($page - 1) * $per_page;
                $taxes = $query->offset($offset)->limit($per_page)->get();
            }

            $results = $taxes->map(function ($tax) {
                return [
                    'id' => $tax->id,
                    'name' => $tax->name,
                    'taxType' => $tax->taxType,
                    'taxValue' => $tax->taxValue,
                    'clinicId' => $tax->clinicId,
                    'doctorId' => $tax->doctorId,
                    'serviceId' => $tax->serviceId,  // Mapping ID
                    'actual_service_id' => $tax->actual_service_id,  // Actual service ID from wp_kc_services
                    'addedBy' => $tax->addedBy,
                    'status' => $tax->status,
                    'createdAt' => $tax->createdAt,

                    'clinicName' => $tax->clinic_name,
                    'clinic_image_url' => $tax->clinic_profile_image ? wp_get_attachment_url($tax->clinic_profile_image) : '',
                    'clinicEmail' => $tax->clinic_email,

                    'doctorName' => $tax->doctor_name,
                    'doctor_image_url' => $tax->doctor_profile_image ? wp_get_attachment_url($tax->doctor_profile_image) : '',
                    'doctorEmail' => $tax->doctor_email,

                    'serviceName' => $tax->service_name,
                    'service_image_url' => $tax->service_image ? wp_get_attachment_url($tax->service_image) : '',
                ];
            })->toArray();

            return $this->response([
                'taxes'       => $results,
                'page'        => $page,
                'per_page'    => $per_page,
                'total'       => $total,
                'total_pages' => $per_page > 0 ? ceil($total / $per_page) : 1,
            ], __('Taxes retrieved successfully', 'kivicare-pro'));
        } catch (\Exception $e) {
            return new \WP_Error(
                'kc_tax_list_failed',
                __('Failed to fetch taxes.', 'kivicare-pro'),
                ['error' => $e->getMessage()]
            );
        }
    }



    /**
     * Get tax
     * 
     * @param \WP_REST_Request $request
     * @return \WP_REST_Response|\WP_Error
     */
    public function getTax($request)
    {
        $id = isset($request['id']) ? intval($request['id']) : 0;

        $tax = KCPTax::table('t')
            ->select([
                't.*',
                's.id as actual_s_id',
                's.name as service_name',
            ])
            ->leftJoin(KCServiceDoctorMapping::class, 't.service_id', '=', 'k.id', 'k')
            ->leftJoin(KCService::class, function ($join) {
                $join->onRaw('(k.id IS NOT NULL AND s.id = k.service_id) OR (k.id IS NULL AND s.id = t.service_id)');
            }, null, null, 's')
            ->where('t.id', $id)
            ->first();

        if (!$tax) {
            return new \WP_Error('not_found', __('Tax not found.', 'kivicare-pro'));
        }
        // Format the response as an array
        $result = [
            'id' => $tax->id,
            'name' => $tax->name,
            'taxType' => $tax->taxType,
            'taxValue' => $tax->taxValue,
            'clinic_id' => $tax->clinicId,
            'doctor_id' => $tax->doctorId,
            'service_id' => $tax->serviceId,  // Mapping ID
            'service'   => !empty($tax->service_name) ? [
                'id' => $tax->serviceId,
                'name' => $tax->service_name,
            ] : [],
            'actual_service_id' => $tax->actual_s_id ?? null,
            'addedBy' => $tax->addedBy,
            'status' => $tax->status,
            'createdAt' => $tax->createdAt,
        ];

        return $this->response($result, __('Tax detail fetched successfully', 'kivicare-pro'));
    }

    public function updateTax($request)
    {
        $id = isset($request['id']) ? intval($request['id']) : 0;
        if (!$id) {
            return $this->response(null, __('Invalid tax ID.', 'kivicare-pro'), false, 400);
        }
        $params = $request->get_params();

        // Find the tax
        $tax = KCPTax::find($id);
        if (!$tax) {
            return $this->response(null, __('Tax not found', 'kivicare-pro'), false, 404);
        }

        $extractScalar = function ($v, $keys = ['value','id','service_id']) use (&$extractScalar) {
            if (is_numeric($v)) return (int) $v;
        
            if (is_array($v)) {
                foreach ($keys as $k) {
                    if (isset($v[$k]) && is_numeric($v[$k])) return (int) $v[$k];
                }
                return isset($v[0]) ? $extractScalar($v[0], $keys) : null;
            }
        
            return null;
        };
        
        // Normalize
        foreach (['status' => ['value','id'], 'clinic' => ['value','id'], 'doctor' => ['value','id']] as $k => $keys) {
            array_key_exists($k, $params) && $params[$k] = $extractScalar($params[$k], $keys);
        }
        array_key_exists('service', $params) &&
            $params['service'] = $extractScalar($params['service'], ['value','service_id','id']);
        
        // Update fields
        isset($params['name'])      && $tax->name     = $params['name'];
        isset($params['rateType'])  && $tax->taxType  = $params['rateType'];
        if (isset($params['rateValue'])) {
            if (!is_numeric($params['rateValue']) || (float)$params['rateValue'] <= 0) {
                return new \WP_Error(
                    'kc_tax_invalid_rate',
                    __('Tax rate must be greater than 0.', 'kivicare-pro'),
                    ['rateValue' => $params['rateValue']]
                );
            }
            $tax->taxValue = $params['rateValue'];
        }
        isset($params['status'])    && $tax->status   = $params['status'];
        
        // Resolve relations 
        $clinicId  = $params['clinic']  ?? $tax->clinicId;
        $doctorId  = $params['doctor']  ?? $tax->doctorId;
        $serviceIn = $params['service'] ?? $tax->serviceId;
        
        $finalServiceId = $serviceIn;
        if (isset($params['service'], $doctorId) && $serviceIn) {
            $q = KCServiceDoctorMapping::query()
                ->where('doctor_id', (int) $doctorId)
                ->where('service_id', (int) $serviceIn)
                ->where('status', 1);
        
            // Only filter by clinic when a real clinic is selected
            (!empty($clinicId) && (int) $clinicId > 0) && $q->where('clinic_id', (int) $clinicId);
        
            ($m = $q->first()) && $finalServiceId = (int) $m->id;
        }
        
        $tax->clinicId  = $clinicId;
        $tax->doctorId  = $doctorId;
        $tax->serviceId = $finalServiceId;
        
        $result = $tax->save();

        if ($result === false) {
            return $this->response(null, __('Failed to update tax', 'kivicare-pro'), false, 500);
        }

        return $this->response($tax->toArray(), __('Tax updated successfully', 'kivicare-pro'));
    }

    /**
     * Delete tax
     * 
     * @param  $request
     * @return \WP_REST_Response
     */
    public function deleteTax($request)
    {
        try {
            $id = $request->get_param('id');
            if (!$id) {
                return $this->response(null, __('Invalid tax ID.', 'kivicare-pro'), false, 400);
            }
            $tax = KCPTax::find($id);
            if (!$tax) {
                return $this->response(null, __('Tax not found.', 'kivicare-pro'), false, 404);
            }
            $tax->delete();
            return $this->response(null, __('Tax deleted successfully.', 'kivicare-pro'), true, 200);
        } catch (\Exception $e) {
            return $this->response(null, $e->getMessage(), false, 500);
        }
    }

    /**
     * Bulk delete taxes
     * 
     * @param WP_REST_Request $request
     * @return \WP_REST_Response
     */
    public function bulkDeleteTaxes($request)
    {
        try {
            $ids = $request->get_param('ids');
            if (!is_array($ids) || empty($ids)) {
                return $this->response(null, __('No tax IDs provided.', 'kivicare-pro'), false, 400);
            }

            // Fetch all taxes to be deleted
            $taxes = KCPTax::query()->whereIn('id', $ids)->get();
            if ($taxes->isEmpty()) {
                return $this->response(null, __('No taxes found for deletion.', 'kivicare-pro'), false, 404);
            }

            // Delete all found taxes
            $deletedCount = 0;
            foreach ($taxes as $tax) {
                if ($tax->delete()) {
                    $deletedCount++;
                }
            }

            return $this->response(
                null,
                sprintf(__('%d taxes deleted successfully.', 'kivicare-pro'), $deletedCount),
                true,
                200
            );
        } catch (\Exception $e) {
            return $this->response(null, $e->getMessage(), false, 500);
        }
    }

    /**
     * Bulk update taxes status
     * 
     * @param \WP_REST_Request $request
     * @return \WP_REST_Response
     */
    public function bulkUpdateTaxStatus($request)
    {
        try {
            $ids = $request->get_param('ids');
            $status = $request->get_param('status');
            if (!is_array($ids) || empty($ids)) {
                return $this->response(null, __('No tax IDs provided.', 'kivicare-pro'), false, 400);
            }
            if ($status === null) {
                return $this->response(null, __('No status provided.', 'kivicare-pro'), false, 400);
            }

            // Fetch all taxes to be updated
            $taxes = KCPTax::query()->whereIn('id', $ids)->get();
            if ($taxes->isEmpty()) {
                return $this->response(null, __('No taxes found for status update.', 'kivicare-pro'), false, 404);
            }

            // Update status for all found taxes
            $updatedCount = 0;
            foreach ($taxes as $tax) {
                $tax->status = $status;
                if ($tax->save()) {
                    $updatedCount++;
                }
            }

            return $this->response(
                null,
                sprintf(__('%d taxes status updated.', 'kivicare-pro'), $updatedCount),
                true,
                200
            );
        } catch (\Exception $e) {
            return $this->response(null, $e->getMessage(), false, 500);
        }
    }
    /**
     * Single tax status update
     * 
     * @param  $request
     * @return \WP_REST_Response
     */
    public function updateTaxStatus($request)
    {
        try {
            $id = $request->get_param('id');
            $status = $request->get_param('status');
            if (!$id) {
                return $this->response(null, __('Invalid tax ID.', 'kivicare-pro'), false, 400);
            }
            if ($status === null) {
                return $this->response(null, __('No status provided.', 'kivicare-pro'), false, 400);
            }
            $tax = KCPTax::find($id);
            if (!$tax) {
                return $this->response(null, __('Tax not found.', 'kivicare-pro'), false, 404);
            }
            $tax->status = $status;
            $tax->save();
            return $this->response(null, __('Tax status updated.', 'kivicare-pro'), true, 200);
        } catch (\Exception $e) {
            return $this->response(null, $e->getMessage(), false, 500);
        }
    }

    /**
     * Export taxes data with filters
     */
    public function exportTaxes(\WP_REST_Request $request): \WP_REST_Response
    {
        $params = $request->get_params();

        $query = KCPTax::table('t')
            ->select([
                't.*',
                'c.name as clinic_name',
                'd.display_name as doctor_name',
                's.name as service_name',
                's.id as actual_service_id'  // Fetch actual service ID
            ])
            ->leftJoin(KCClinic::class, 't.clinic_id', '=', 'c.id', 'c')
            ->leftJoin(KCDoctor::class, 't.doctor_id', '=', 'd.id', 'd')
            ->leftJoin(KCServiceDoctorMapping::class, 't.service_id', '=', 'k.id', 'k')  // Join to mapping first using t.service_id (mapping ID)
            ->leftJoin(KCService::class, 'k.service_id', '=', 's.id', 's');  // Then join mapping to actual service

        // Apply filters (same as getTaxes)
        if (!empty($params['taxName'])) {
            $query->where('t.name', 'LIKE', '%' . esc_sql($params['taxName']) . '%');
        }

        if (isset($params['status']) && $params['status'] !== '') {
            $query->where('t.status', (int) $params['status']);
        }

        if (!empty($params['clinic'])) {
            $query->where('c.id', (int) $params['clinic']);
        }

        if (!empty($params['doctor'])) {
            if (is_array($params['doctor'])) {
                $query->whereIn('d.id', $params['doctor']);
            } else {
                $query->where('d.id', (int) $params['doctor']);
            }
        }

        if (!empty($params['service'])) {
            if (is_array($params['service'])) {
                $query->whereIn('s.id', $params['service']);
            } else {
                $query->where('s.id', (int) $params['service']);
            }
        }

        // Apply sorting (same as getTaxes)
        if (!empty($params['orderby'])) {
            $orderby = $params['orderby'];
            $direction = !empty($params['order']) && strtolower($params['order']) === 'desc' ? 'DESC' : 'ASC';

            switch ($orderby) {
                case 'taxName':
                    $query->orderBy('t.name', $direction);
                    break;
                case 'taxRate':
                    $query->orderBy("CAST(t.tax_value AS DECIMAL(10,2))", $direction);
                    break;
                case 'clinicName':
                    $query->orderBy('c.name', $direction);
                    break;
                case 'doctorName':
                    $query->orderBy('d.display_name', $direction);
                    break;
                case 'serviceName':
                    $query->orderBy('s.name', $direction);
                    break;
                case 'status':
                    $query->orderBy('t.status', $direction);
                    break;
                case 'id':
                default:
                    $query->orderBy('t.id', $direction);
                    break;
            }
        } else {
            $query->orderBy('t.id', 'DESC');
        }

        // Pagination (support perPage=all)
        $page = isset($params['page']) ? max(1, (int) $params['page']) : 1;
        $perPageParam = $params['perPage'] ?? 10;
        $showAll = is_string($perPageParam) && strtolower($perPageParam) === 'all';

        $totalQuery = clone $query;
        if (method_exists($totalQuery, 'removeGroupBy')) {
            $totalQuery->removeGroupBy();
        }
        $total = $totalQuery->countDistinct('t.id');

        if ($showAll) {
            $per_page = $total > 0 ? $total : 1;
            $page = 1;
            $taxes = $query->get();
        } else {
            $per_page = (int) $perPageParam;
            if ($per_page <= 0) {
                $per_page = 10;
            }
            $offset = ($page - 1) * $per_page;
            $taxes = $query->offset($offset)->limit($per_page)->get();
        }

        $export = [];
        foreach ($taxes as $tax) {
            $taxRate = ($tax->taxType === 'fixed') ? "Fixed " . $tax->taxValue : $tax->taxValue . "%";
            $export[] = [
                'id' => (int) $tax->id,
                'tax_name' => $tax->name ?? '-',
                'tax_rate' => $taxRate,
                'clinic_name' => $tax->clinic_name ?? 'All Clinics',
                'doctor_name' => $tax->doctor_name ?? 'All Doctors',
                'service_name' => $tax->service_name ?? 'All Services',
                'status' => ($tax->status == 1) ? 'Active' : 'Inactive',
                'actual_service_id' => $tax->actual_service_id  // Optionally include in export if needed
            ];
        }

        return $this->response([
            'taxes'       => $export,
            'page'        => $page,
            'per_page'    => $per_page,
            'total'       => $total,
            'total_pages' => $per_page > 0 ? ceil($total / $per_page) : 1,
        ], __('Taxes data retrieved successfully', 'kivicare-pro'), true, 200);
    }
}
