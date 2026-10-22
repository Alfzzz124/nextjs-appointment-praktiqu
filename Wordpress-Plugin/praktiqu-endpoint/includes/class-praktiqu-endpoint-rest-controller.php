<?php
/**
 * REST controller — registers and handles the /praktiqu/v1/* endpoints.
 *
 * All endpoints require the `X-PraktiQU-Service-Token` header to be valid
 * (per Plugin::verify_service_token). The token is a shared secret defined
 * in wp-config.php and rotated via deployment.
 *
 * @package PraktiQU\Endpoint
 */

declare(strict_types=1);

namespace PraktiQU\Endpoint;

defined('ABSPATH') || exit;

final class REST_Controller
{
    private Service $service;
    private Jobs $jobs;
    private Payments $payments;
    private Media $media;
    private Patients $patients;
    private Appointments $appointments;
    private Receptionists $receptionists;
    private Doctors $doctors;
    private Encounters $encounters;
    private ClinicalRecords $clinical_records;
    private ClinicAdmins $clinic_admins;

    public function __construct(Service $service, Jobs $jobs, Payments $payments, Media $media, Patients $patients, Appointments $appointments, Receptionists $receptionists, Doctors $doctors, Encounters $encounters, ClinicalRecords $clinical_records, ClinicAdmins $clinic_admins)
    {
        $this->service = $service;
        $this->jobs = $jobs;
        $this->payments = $payments;
        $this->media = $media;
        $this->patients = $patients;
        $this->appointments = $appointments;
        $this->receptionists = $receptionists;
        $this->doctors = $doctors;
        $this->encounters = $encounters;
        $this->clinical_records = $clinical_records;
        $this->clinic_admins = $clinic_admins;
    }

    public function register(): void
    {
        add_action('rest_api_init', [$this, 'register_routes']);
    }

    public function register_routes(): void
    {
        $ns = PRAKTIQU_ENDPOINT_REST_NAMESPACE;

        // POST /praktiqu/v1/authenticate — verify email + password
        register_rest_route($ns, '/authenticate', [
            'methods'             => \WP_REST_Server::CREATABLE,
            'callback'            => [$this, 'handle_authenticate'],
            'permission_callback' => [Plugin::class, 'verify_service_token'],
            'args'                => [
                'email'    => ['required' => true,  'type' => 'string', 'format' => 'email'],
                'password' => ['required' => true,  'type' => 'string'],
            ],
        ]);

        // GET /praktiqu/v1/users/{id} — get identity by WP user ID
        register_rest_route($ns, '/users/(?P<id>\d+)', [
            'methods'             => \WP_REST_Server::READABLE,
            'callback'            => [$this, 'handle_get_user'],
            'permission_callback' => [Plugin::class, 'verify_service_token'],
            'args'                => [
                'id' => ['required' => true, 'type' => 'integer', 'sanitize_callback' => 'absint'],
            ],
        ]);

        // POST /praktiqu/v1/users/lookup — get identity by email
        register_rest_route($ns, '/users/lookup', [
            'methods'             => \WP_REST_Server::CREATABLE,
            'callback'            => [$this, 'handle_lookup_user'],
            'permission_callback' => [Plugin::class, 'verify_service_token'],
            'args'                => [
                'email' => ['required' => true, 'type' => 'string', 'format' => 'email'],
            ],
        ]);

        // POST /praktiqu/v1/users/{id}/change-password — change a user's password
        register_rest_route($ns, '/users/(?P<id>\d+)/change-password', [
            'methods'             => \WP_REST_Server::CREATABLE,
            'callback'            => [$this, 'handle_change_password'],
            'permission_callback' => [Plugin::class, 'verify_service_token'],
            'args'                => [
                'id'              => ['required' => true, 'type' => 'integer', 'sanitize_callback' => 'absint'],
                'newPassword'     => ['required' => true, 'type' => 'string'],
                'invalidateTokens' => ['required' => false, 'type' => 'boolean', 'default' => true],
            ],
        ]);

        // POST /praktiqu/v1/patients — create a patient (wp_users + kiviCare_patient)
        //
        // PraktiQU READS patients directly from wp_users, but must write them here:
        // a raw INSERT skips the kc_patient_save listeners (welcome email, KiviCare
        // bookkeeping, Pro custom fields). See docs/architecture/shadow-tables-audit.md §6 D1.
        register_rest_route($ns, '/patients', [
            'methods'             => \WP_REST_Server::CREATABLE,
            'callback'            => [$this, 'handle_create_patient'],
            'permission_callback' => [Plugin::class, 'verify_service_token'],
            'args'                => [
                'email'      => ['required' => true,  'type' => 'string', 'format' => 'email'],
                'first_name' => ['required' => true,  'type' => 'string'],
                'last_name'  => ['required' => false, 'type' => 'string'],
                'clinic_id'  => ['required' => false, 'type' => 'integer', 'sanitize_callback' => 'absint'],
            ],
        ]);

        // PUT/PATCH /praktiqu/v1/patients/{id} — update a patient
        register_rest_route($ns, '/patients/(?P<id>\d+)', [
            'methods'             => \WP_REST_Server::EDITABLE,
            'callback'            => [$this, 'handle_update_patient'],
            'permission_callback' => [Plugin::class, 'verify_service_token'],
            'args'                => [
                'id' => ['required' => true, 'type' => 'integer', 'sanitize_callback' => 'absint'],
            ],
        ]);

        // POST /praktiqu/v1/appointments — create an appointment
        //
        // The hook-densest write in KiviCare: kc_after_create_appointment drives the
        // booking email, Pro custom fields and followup scheduling. It also derives the
        // UTC columns via KCAppointment::save, which a raw INSERT would leave NULL.
        register_rest_route($ns, '/appointments', [
            'methods'             => \WP_REST_Server::CREATABLE,
            'callback'            => [$this, 'handle_create_appointment'],
            'permission_callback' => [Plugin::class, 'verify_service_token'],
            'args'                => [
                'clinic_id'  => ['required' => true, 'type' => 'integer', 'sanitize_callback' => 'absint'],
                'doctor_id'  => ['required' => true, 'type' => 'integer', 'sanitize_callback' => 'absint'],
                'patient_id' => ['required' => true, 'type' => 'integer', 'sanitize_callback' => 'absint'],
                'start_date' => ['required' => true, 'type' => 'string'],
                'start_time' => ['required' => true, 'type' => 'string'],
            ],
        ]);

        // PUT/PATCH /praktiqu/v1/appointments/{id} — reschedule / edit
        register_rest_route($ns, '/appointments/(?P<id>\d+)', [
            'methods'             => \WP_REST_Server::EDITABLE,
            'callback'            => [$this, 'handle_update_appointment'],
            'permission_callback' => [Plugin::class, 'verify_service_token'],
            'args'                => [
                'id' => ['required' => true, 'type' => 'integer', 'sanitize_callback' => 'absint'],
            ],
        ]);

        // POST /praktiqu/v1/appointments/{id}/reschedule — move to a new slot under the
        // professional's schedule lock (Schedule_Write::move), then sync Meet/Calendar
        register_rest_route($ns, '/appointments/(?P<id>\d+)/reschedule', [
            'methods'             => \WP_REST_Server::CREATABLE,
            'callback'            => [$this, 'handle_reschedule_appointment'],
            'permission_callback' => [Plugin::class, 'verify_service_token'],
            'args'                => [
                'id'         => ['required' => true, 'type' => 'integer', 'sanitize_callback' => 'absint'],
                'start_date' => ['required' => true, 'type' => 'string'],
                'start_time' => ['required' => true, 'type' => 'string'],
                'expected'   => ['required' => true, 'type' => 'object'],
            ],
        ]);

        // POST /praktiqu/v1/appointments/{id}/status — change status; 0 cancels
        register_rest_route($ns, '/appointments/(?P<id>\d+)/status', [
            'methods'             => \WP_REST_Server::CREATABLE,
            'callback'            => [$this, 'handle_appointment_status'],
            'permission_callback' => [Plugin::class, 'verify_service_token'],
            'args'                => [
                'id'     => ['required' => true, 'type' => 'integer', 'sanitize_callback' => 'absint'],
                // 0=CANCELLED 1=BOOKED 2=PENDING 3=CHECK_OUT 4=CHECK_IN (KCAppointment.php:41-45)
                'status' => ['required' => true, 'type' => 'integer', 'enum' => [0, 1, 2, 3, 4]],
                // { gateway, wc_order_id, transaction_id } when status 1 confirms a paid
                // booking; makes PENDING → BOOKED fire kc_appointment_payment_completed.
                'payment' => ['required' => false, 'type' => 'object'],
                // Compare-and-set (1.8.4): write only if the row still has this status;
                // 409 praktiqu_status_conflict otherwise. Sent by psychologist approval.
                'expect_status' => ['required' => false, 'type' => 'integer', 'enum' => [0, 1, 2, 3, 4]],
            ],
        ]);

        // ---- Encounters ------------------------------------------------
        //
        // An encounter is the clinical record of one session. Closing it fires
        // kc_encounter_closed, which KiviCare listens for but has never itself
        // fired — see class-praktiqu-endpoint-encounters.php.

        // POST /praktiqu/v1/encounters
        register_rest_route($ns, '/encounters', [
            'methods'             => \WP_REST_Server::CREATABLE,
            'callback'            => [$this, 'handle_create_encounter'],
            'permission_callback' => [Plugin::class, 'verify_service_token'],
            'args'                => [
                'clinic_id'  => ['required' => true, 'type' => 'integer', 'sanitize_callback' => 'absint'],
                'doctor_id'  => ['required' => true, 'type' => 'integer', 'sanitize_callback' => 'absint'],
                'patient_id' => ['required' => true, 'type' => 'integer', 'sanitize_callback' => 'absint'],
            ],
        ]);

        // PUT/PATCH /praktiqu/v1/encounters/{id}
        register_rest_route($ns, '/encounters/(?P<id>\d+)', [
            'methods'             => \WP_REST_Server::EDITABLE,
            'callback'            => [$this, 'handle_update_encounter'],
            'permission_callback' => [Plugin::class, 'verify_service_token'],
            'args'                => [
                'id' => ['required' => true, 'type' => 'integer', 'sanitize_callback' => 'absint'],
            ],
        ]);

        // POST /praktiqu/v1/encounters/{id}/status — 0 closes (and notifies), 1 reopens
        register_rest_route($ns, '/encounters/(?P<id>\d+)/status', [
            'methods'             => \WP_REST_Server::CREATABLE,
            'callback'            => [$this, 'handle_encounter_status'],
            'permission_callback' => [Plugin::class, 'verify_service_token'],
            'args'                => [
                'id'     => ['required' => true, 'type' => 'integer', 'sanitize_callback' => 'absint'],
                'status' => ['required' => true, 'type' => 'integer', 'enum' => [0, 1]],
            ],
        ]);

        // PUT /praktiqu/v1/encounters/{id}/history — replaces the whole set
        register_rest_route($ns, '/encounters/(?P<id>\d+)/history', [
            'methods'             => \WP_REST_Server::EDITABLE,
            'callback'            => [$this, 'handle_replace_history'],
            'permission_callback' => [Plugin::class, 'verify_service_token'],
            'args'                => [
                'id'         => ['required' => true, 'type' => 'integer', 'sanitize_callback' => 'absint'],
                'patient_id' => ['required' => true, 'type' => 'integer', 'sanitize_callback' => 'absint'],
            ],
        ]);

        // PUT /praktiqu/v1/encounters/{id}/prescriptions — replaces the whole set
        register_rest_route($ns, '/encounters/(?P<id>\d+)/prescriptions', [
            'methods'             => \WP_REST_Server::EDITABLE,
            'callback'            => [$this, 'handle_replace_prescriptions'],
            'permission_callback' => [Plugin::class, 'verify_service_token'],
            'args'                => [
                'id'         => ['required' => true, 'type' => 'integer', 'sanitize_callback' => 'absint'],
                'patient_id' => ['required' => true, 'type' => 'integer', 'sanitize_callback' => 'absint'],
            ],
        ]);

        // POST /praktiqu/v1/receptionists — create a receptionist
        //
        // The raw-SQL path in billing/receptionist.service.ts produces an unusable
        // account: no welcome email (kc_receptionist_save never fires) and an invalid
        // password hash, so the receptionist can never log in.
        register_rest_route($ns, '/receptionists', [
            'methods'             => \WP_REST_Server::CREATABLE,
            'callback'            => [$this, 'handle_create_receptionist'],
            'permission_callback' => [Plugin::class, 'verify_service_token'],
            'args'                => [
                'email'     => ['required' => true, 'type' => 'string', 'format' => 'email'],
                'name'      => ['required' => true, 'type' => 'string'],
                'clinic_id' => ['required' => true, 'type' => 'integer', 'sanitize_callback' => 'absint'],
                // Optional; falls back to wp_generate_password. Length is enforced by
                // receptionistCreateSchema upstream — declared here without its own
                // bounds so the two cannot drift apart.
                'password'  => ['required' => false, 'type' => 'string'],
            ],
        ]);

        // POST /praktiqu/v1/clinic-admins — create the admin account of a clinic that has none
        //
        // The Next.js app writes the wp_kc_clinics row itself; the account has to come from
        // wp_insert_user (see ClinicAdmins). Refuses a clinic that already has an admin.
        register_rest_route($ns, '/clinic-admins', [
            'methods'             => \WP_REST_Server::CREATABLE,
            'callback'            => [$this, 'handle_create_clinic_admin'],
            'permission_callback' => [Plugin::class, 'verify_service_token'],
            'args'                => [
                'email'     => ['required' => true, 'type' => 'string', 'format' => 'email'],
                'name'      => ['required' => true, 'type' => 'string'],
                'clinic_id' => ['required' => true, 'type' => 'integer', 'sanitize_callback' => 'absint'],
            ],
        ]);

        // POST /praktiqu/v1/doctors — create a doctor (professional)
        //
        // kc_doctor_save has three listeners: the welcome email, KiviCare's own
        // bookkeeping, and Pro's custom-field persistence. A raw INSERT skips all three.
        register_rest_route($ns, '/doctors', [
            'methods'             => \WP_REST_Server::CREATABLE,
            'callback'            => [$this, 'handle_create_doctor'],
            'permission_callback' => [Plugin::class, 'verify_service_token'],
            'args'                => [
                'email'               => ['required' => true, 'type' => 'string', 'format' => 'email'],
                'first_name'          => ['required' => true, 'type' => 'string'],
                'registration_number' => ['required' => true, 'type' => 'string'],
                'professional_type'   => ['required' => true, 'type' => 'string'],
                'clinic_id'           => ['required' => false, 'type' => 'integer', 'sanitize_callback' => 'absint'],
            ],
        ]);

        // PUT/PATCH /praktiqu/v1/doctors/{id}
        register_rest_route($ns, '/doctors/(?P<id>\d+)', [
            'methods'             => \WP_REST_Server::EDITABLE,
            'callback'            => [$this, 'handle_update_doctor'],
            'permission_callback' => [Plugin::class, 'verify_service_token'],
            'args'                => [
                'id' => ['required' => true, 'type' => 'integer', 'sanitize_callback' => 'absint'],
            ],
        ]);

        // GET /praktiqu/v1/health — liveness probe (also requires service token)
        register_rest_route($ns, '/health', [
            'methods'             => \WP_REST_Server::READABLE,
            'callback'            => [$this, 'handle_health'],
            'permission_callback' => [Plugin::class, 'verify_service_token'],
        ]);

        // POST /praktiqu/v1/media — sideload a file into the WP media library
        register_rest_route($ns, '/media', [
            'methods'             => \WP_REST_Server::CREATABLE,
            'callback'            => [$this, 'handle_media_upload'],
            'permission_callback' => [Plugin::class, 'verify_service_token'],
            'args'                => [
                'context' => [
                    'required' => false,
                    'type'     => 'string',
                    'enum'     => ['medical-report', 'custom-field'],
                    'default'  => 'custom-field',
                ],
            ],
        ]);

        // GET /praktiqu/v1/media/{id} — stream one attachment's bytes
        register_rest_route($ns, '/media/(?P<id>\d+)', [
            'methods'             => \WP_REST_Server::READABLE,
            'callback'            => [$this, 'handle_media_stream'],
            'permission_callback' => [Plugin::class, 'verify_service_token'],
            'args'                => [
                'id' => ['required' => true, 'type' => 'integer', 'sanitize_callback' => 'absint'],
            ],
        ]);

        // POST /praktiqu/v1/jobs — enqueue a background job (C8 architecture)
        register_rest_route($ns, '/jobs', [
            'methods'             => \WP_REST_Server::CREATABLE,
            'callback'            => [$this, 'handle_enqueue_job'],
            'permission_callback' => [Plugin::class, 'verify_service_token'],
            'args'                => [
                'hook'  => ['required' => true, 'type' => 'string'],
                'runAt' => ['required' => true, 'type' => 'integer'],
                // 'object', NOT 'array'. The Next.js jobs client sends named args as a
                // JSON object (`{"wcOrderId":49736,"webhookToken":null}`), and it always
                // spreads webhookToken in, so `args` is never empty. WP REST validates
                // the schema BEFORE the handler runs and rejects an object against
                // 'array' with 400 rest_invalid_param -- so every enqueue failed, 100%
                // of the time, and Action Scheduler never received a single job. The
                // handler below already casts to array, so only the schema was wrong.
                // Measured 2026-09-01: zero praktiqu_payment_auto_cancel actions had
                // ever been scheduled, meaning unpaid PENDING appointments held their
                // slots forever, and session reminders/auto-complete never fired either.
                'args'  => ['required' => false, 'type' => 'object', 'default' => []],
            ],
        ]);

        // DELETE /praktiqu/v1/jobs — cancel a previously-enqueued job
        register_rest_route($ns, '/jobs', [
            'methods'             => \WP_REST_Server::DELETABLE,
            'callback'            => [$this, 'handle_cancel_job'],
            'permission_callback' => [Plugin::class, 'verify_service_token'],
            'args'                => [
                'hook'  => ['required' => true, 'type' => 'string'],
                // 'object' for the same reason as the enqueue route above.
                'args'  => ['required' => false, 'type' => 'object', 'default' => []],
            ],
        ]);

        // POST /praktiqu/v1/payments/order — create a WC order (2026-07-14 payment feature)
        register_rest_route($ns, '/payments/order', [
            'methods'             => \WP_REST_Server::CREATABLE,
            'callback'            => [$this, 'handle_create_payment_order'],
            'permission_callback' => [Plugin::class, 'verify_service_token'],
            'args'                => [
                // Only `charge` is declared (2026-10-06 international clinic design §4), as
                // 'object' -- the jobs-route incident above was 'array' vs 'object' -- and
                // with no nested `properties`: every nested check is done by
                // ChargeValidator in create_order() and fails as our own 400 invalid_charge,
                // never WP's generic rest_invalid_param. Core skips null params, so a JSON
                // `"charge": null` is NOT rejected by this schema: create_order() rejects a
                // present-but-null `charge` itself (400 invalid_charge), and only an absent
                // key is the legacy/xendit path. The legacy keys (items, taxes, method, ...)
                // stay undeclared so their loose handling does not change.
                'charge' => ['type' => 'object', 'required' => false],
            ],
        ]);

        // GET /praktiqu/v1/payments/order/{id} — verify-fallback order status
        register_rest_route($ns, '/payments/order/(?P<id>\d+)', [
            'methods'             => \WP_REST_Server::READABLE,
            'callback'            => [$this, 'handle_get_payment_order'],
            'permission_callback' => [Plugin::class, 'verify_service_token'],
            'args'                => [
                'id' => ['required' => true, 'type' => 'integer', 'sanitize_callback' => 'absint'],
            ],
        ]);

        // GET /praktiqu/v1/clinics/{id}/payment-settings — diagnostics only; Next.js reads
        // the option itself through KcOption (2026-10-06 international clinic design §4)
        register_rest_route($ns, '/clinics/(?P<id>\d+)/payment-settings', [
            'methods'             => \WP_REST_Server::READABLE,
            'callback'            => [$this, 'handle_get_clinic_payment_settings'],
            'permission_callback' => [Plugin::class, 'verify_service_token'],
            'args'                => [
                'id' => ['required' => true, 'type' => 'integer', 'sanitize_callback' => 'absint'],
            ],
        ]);

        // PUT /praktiqu/v1/clinics/{id}/payment-settings — replace one clinic's whole object.
        // Only `id` is declared: the body keys are checked by ClinicPaymentSettings::validate()
        // so every failure is our own invalid_settings / fx_rate_required, never WP's generic
        // rest_invalid_param.
        register_rest_route($ns, '/clinics/(?P<id>\d+)/payment-settings', [
            'methods'             => 'PUT',
            'callback'            => [$this, 'handle_put_clinic_payment_settings'],
            'permission_callback' => [Plugin::class, 'verify_service_token'],
            'args'                => [
                'id' => ['required' => true, 'type' => 'integer', 'sanitize_callback' => 'absint'],
            ],
        ]);
    }

    /**
     * POST /praktiqu/v1/authenticate
     */
    public function handle_authenticate(\WP_REST_Request $request): \WP_REST_Response|\WP_Error
    {
        $email    = (string) $request->get_param('email');
        $password = (string) $request->get_param('password');

        $result = $this->service->authenticate($email, $password);
        if (is_wp_error($result)) {
            return $result;
        }
        return new \WP_REST_Response($result, 200);
    }

    /**
     * GET /praktiqu/v1/users/{id}
     */
    public function handle_get_user(\WP_REST_Request $request): \WP_REST_Response|\WP_Error
    {
        $id = (int) $request->get_param('id');
        $result = $this->service->get_user_by_id($id);
        if (is_wp_error($result)) {
            return $result;
        }
        return new \WP_REST_Response($result, 200);
    }

    /**
     * POST /praktiqu/v1/users/lookup
     */
    public function handle_lookup_user(\WP_REST_Request $request): \WP_REST_Response|\WP_Error
    {
        $email = (string) $request->get_param('email');
        $result = $this->service->get_user_by_email($email);
        if (is_wp_error($result)) {
            return $result;
        }
        return new \WP_REST_Response($result, 200);
    }

    /**
     * POST /praktiqu/v1/users/{id}/change-password
     */
    public function handle_change_password(\WP_REST_Request $request): \WP_REST_Response|\WP_Error
    {
        $wp_user_id     = (int) $request->get_param('id');
        $new_password   = (string) $request->get_param('newPassword');

        $result = $this->service->change_password($wp_user_id, $new_password);
        if (is_wp_error($result)) {
            return $result;
        }
        return new \WP_REST_Response($result, 200);
    }

    /**
     * POST /praktiqu/v1/patients
     */
    public function handle_create_patient(\WP_REST_Request $request): \WP_REST_Response|\WP_Error
    {
        $result = $this->patients->create((array) $request->get_json_params(), $request);
        if (is_wp_error($result)) {
            return $result;
        }
        return new \WP_REST_Response($result, 201);
    }

    /**
     * PUT/PATCH /praktiqu/v1/patients/{id}
     */
    public function handle_update_patient(\WP_REST_Request $request): \WP_REST_Response|\WP_Error
    {
        $id = (int) $request->get_param('id');
        $result = $this->patients->update($id, (array) $request->get_json_params(), $request);
        if (is_wp_error($result)) {
            return $result;
        }
        return new \WP_REST_Response($result, 200);
    }

    /**
     * POST /praktiqu/v1/appointments
     */
    public function handle_create_appointment(\WP_REST_Request $request): \WP_REST_Response|\WP_Error
    {
        $result = $this->appointments->create((array) $request->get_json_params(), $request);
        if (is_wp_error($result)) {
            return $result;
        }
        return new \WP_REST_Response($result, 201);
    }

    /**
     * PUT/PATCH /praktiqu/v1/appointments/{id}
     */
    public function handle_update_appointment(\WP_REST_Request $request): \WP_REST_Response|\WP_Error
    {
        $id = (int) $request->get_param('id');
        $result = $this->appointments->update($id, (array) $request->get_json_params(), $request);
        if (is_wp_error($result)) {
            return $result;
        }
        return new \WP_REST_Response($result, 200);
    }

    /**
     * POST /praktiqu/v1/appointments/{id}/reschedule
     */
    public function handle_reschedule_appointment(\WP_REST_Request $request): \WP_REST_Response|\WP_Error
    {
        $id = (int) $request->get_param('id');
        $result = $this->appointments->reschedule($id, (array) $request->get_json_params());
        if (is_wp_error($result)) {
            return $result;
        }
        return new \WP_REST_Response($result, 200);
    }

    /**
     * POST /praktiqu/v1/appointments/{id}/status
     */
    public function handle_appointment_status(\WP_REST_Request $request): \WP_REST_Response|\WP_Error
    {
        $id     = (int) $request->get_param('id');
        $status = (int) $request->get_param('status');

        $result = $this->appointments->set_status($id, $status, $request);
        if (is_wp_error($result)) {
            return $result;
        }
        return new \WP_REST_Response($result, 200);
    }

    /**
     * POST /praktiqu/v1/encounters
     */
    public function handle_create_encounter(\WP_REST_Request $request): \WP_REST_Response|\WP_Error
    {
        $result = $this->encounters->create((array) $request->get_json_params(), $request);
        if (is_wp_error($result)) {
            return $result;
        }
        return new \WP_REST_Response($result, 201);
    }

    /**
     * PUT/PATCH /praktiqu/v1/encounters/{id}
     */
    public function handle_update_encounter(\WP_REST_Request $request): \WP_REST_Response|\WP_Error
    {
        $id = (int) $request->get_param('id');
        $result = $this->encounters->update($id, (array) $request->get_json_params(), $request);
        if (is_wp_error($result)) {
            return $result;
        }
        return new \WP_REST_Response($result, 200);
    }

    /**
     * POST /praktiqu/v1/encounters/{id}/status
     */
    public function handle_encounter_status(\WP_REST_Request $request): \WP_REST_Response|\WP_Error
    {
        $id     = (int) $request->get_param('id');
        $status = (int) $request->get_param('status');

        $result = $this->encounters->set_status($id, $status, $request);
        if (is_wp_error($result)) {
            return $result;
        }
        return new \WP_REST_Response($result, 200);
    }

    /**
     * PUT /praktiqu/v1/encounters/{id}/history
     */
    public function handle_replace_history(\WP_REST_Request $request): \WP_REST_Response|\WP_Error
    {
        $params  = (array) $request->get_json_params();
        $id      = (int) $request->get_param('id');
        $patient = (int) $request->get_param('patient_id');
        $entries = (array) ($params['entries'] ?? []);
        $by      = (int) ($params['added_by'] ?? 0);

        $result = $this->clinical_records->replace_history($id, $patient, $entries, $by);
        if (is_wp_error($result)) {
            return $result;
        }
        return new \WP_REST_Response($result, 200);
    }

    /**
     * PUT /praktiqu/v1/encounters/{id}/prescriptions
     */
    public function handle_replace_prescriptions(\WP_REST_Request $request): \WP_REST_Response|\WP_Error
    {
        $params  = (array) $request->get_json_params();
        $id      = (int) $request->get_param('id');
        $patient = (int) $request->get_param('patient_id');
        $items   = (array) ($params['items'] ?? []);
        $by      = (int) ($params['added_by'] ?? 0);

        $result = $this->clinical_records->replace_prescriptions($id, $patient, $items, $by);
        if (is_wp_error($result)) {
            return $result;
        }
        return new \WP_REST_Response($result, 200);
    }

    /**
     * POST /praktiqu/v1/receptionists
     */
    public function handle_create_receptionist(\WP_REST_Request $request): \WP_REST_Response|\WP_Error
    {
        $result = $this->receptionists->create((array) $request->get_json_params(), $request);
        if (is_wp_error($result)) {
            return $result;
        }
        return new \WP_REST_Response($result, 201);
    }

    /**
     * POST /praktiqu/v1/clinic-admins
     */
    public function handle_create_clinic_admin(\WP_REST_Request $request): \WP_REST_Response|\WP_Error
    {
        $result = $this->clinic_admins->create((array) $request->get_json_params(), $request);
        if (is_wp_error($result)) {
            return $result;
        }
        return new \WP_REST_Response($result, 201);
    }

    /**
     * POST /praktiqu/v1/doctors
     */
    public function handle_create_doctor(\WP_REST_Request $request): \WP_REST_Response|\WP_Error
    {
        $result = $this->doctors->create((array) $request->get_json_params(), $request);
        if (is_wp_error($result)) {
            return $result;
        }
        return new \WP_REST_Response($result, 201);
    }

    /**
     * PUT/PATCH /praktiqu/v1/doctors/{id}
     */
    public function handle_update_doctor(\WP_REST_Request $request): \WP_REST_Response|\WP_Error
    {
        $id = (int) $request->get_param('id');
        $result = $this->doctors->update($id, (array) $request->get_json_params(), $request);
        if (is_wp_error($result)) {
            return $result;
        }
        return new \WP_REST_Response($result, 200);
    }

    /**
     * GET /praktiqu/v1/health
     */
    public function handle_health(): \WP_REST_Response
    {
        return new \WP_REST_Response([
            'status'     => 'ok',
            'version'    => PRAKTIQU_ENDPOINT_VERSION,
            'wpVersion'  => get_bloginfo('version'),
            'phpVersion' => PHP_VERSION,
            'asActive'   => function_exists('as_schedule_single_action'),
        ], 200);
    }

    /**
     * POST /praktiqu/v1/media
     *
     * @return \WP_REST_Response|\WP_Error
     */
    public function handle_media_upload(\WP_REST_Request $request)
    {
        $result = $this->media->sideload($request);
        if (is_wp_error($result)) {
            return $result;
        }
        return rest_ensure_response($result);
    }

    /**
     * GET /praktiqu/v1/media/{id} — streams bytes and exits, so this returns
     * only when something went wrong.
     */
    public function handle_media_stream(\WP_REST_Request $request)
    {
        $result = $this->media->stream($request);
        if (is_wp_error($result)) {
            return $result;
        }
        return rest_ensure_response(null); // unreachable: stream() exits
    }

    /**
     * POST /praktiqu/v1/jobs — enqueue a background job (C8 architecture)
     *
     * PraktiQU posts: { hook: "praktiqu_session_auto_complete", runAt: 1234567890, args: [42] }
     * We register the job in Action Scheduler and return the action id.
     */
    public function handle_enqueue_job(\WP_REST_Request $request): \WP_REST_Response|\WP_Error
    {
        $hook  = (string) $request->get_param('hook');
        $runAt = (int)    $request->get_param('runAt');
        $args  = (array)  $request->get_param('args') ?: [];

        $id = $this->jobs->enqueue($hook, $runAt, $args);
        if ($id === false) {
            return new \WP_Error(
                'job_enqueue_failed',
                'Failed to enqueue job. Is Action Scheduler active?',
                ['status' => 503]
            );
        }
        return new \WP_REST_Response(['actionId' => $id], 201);
    }

    /**
     * DELETE /praktiqu/v1/jobs — cancel a previously-enqueued job
     */
    public function handle_cancel_job(\WP_REST_Request $request): \WP_REST_Response|\WP_Error
    {
        $this->jobs->cancel(
            (string) $request->get_param('hook'),
            (array)  $request->get_param('args') ?: []
        );
        return new \WP_REST_Response(['ok' => true], 200);
    }

    /**
     * POST /praktiqu/v1/payments/order
     */
    public function handle_create_payment_order(\WP_REST_Request $request): \WP_REST_Response|\WP_Error
    {
        $result = $this->payments->create_order($request->get_json_params() ?: []);
        if (is_wp_error($result)) {
            return $result;
        }
        return new \WP_REST_Response($result, 201);
    }

    /**
     * GET /praktiqu/v1/payments/order/{id}
     */
    public function handle_get_payment_order(\WP_REST_Request $request): \WP_REST_Response|\WP_Error
    {
        $result = $this->payments->get_order_status((int) $request->get_param('id'));
        if (is_wp_error($result)) {
            return $result;
        }
        return new \WP_REST_Response($result, 200);
    }

    /**
     * GET /praktiqu/v1/clinics/{id}/payment-settings
     *
     * Diagnostics only. No clinic-existence check, so an option left behind by a deleted
     * clinic is still visible here. `settings` is null when the option is absent or malformed.
     */
    public function handle_get_clinic_payment_settings(\WP_REST_Request $request): \WP_REST_Response
    {
        $clinic_id = (int) $request->get_param('id');
        return new \WP_REST_Response([
            'clinicId' => $clinic_id,
            'settings' => ClinicPaymentSettings::get($clinic_id),
        ], 200);
    }

    /**
     * PUT /praktiqu/v1/clinics/{id}/payment-settings
     *
     * Body (storage keys): { international, fx_rate, markup_percent, fixed_fee_idr, updated_by }.
     * updated_by is stored exactly as received: get_current_user_id() is always 0 on a
     * service-token request, so the plugin never stamps the editor itself.
     */
    public function handle_put_clinic_payment_settings(\WP_REST_Request $request): \WP_REST_Response|\WP_Error
    {
        $clinic_id = (int) $request->get_param('id');
        if (!ClinicPaymentSettings::clinic_exists($clinic_id)) {
            return new \WP_Error(
                'clinic_not_found',
                sprintf('Clinic %d does not exist', $clinic_id),
                ['status' => 404]
            );
        }

        $checked = ClinicPaymentSettings::validate(
            (array) $request->get_json_params(),
            get_option(ClinicPaymentSettings::GLOBAL_RATE_OPTION, '')
        );
        if (!$checked['ok']) {
            return new \WP_Error(
                $checked['code'],
                $checked['message'],
                [
                    'status' => $checked['code'] === 'fx_rate_required' ? 422 : 400,
                    'field'  => $checked['field'],
                ]
            );
        }

        // save() returns false on a failed write and throws when the JSON encode fails;
        // both are the same "could not be saved" to the caller.
        try {
            $saved = ClinicPaymentSettings::save($clinic_id, $checked['data']);
        } catch (\Throwable $e) {
            $saved = false;
        }
        if (!$saved) {
            return new \WP_Error(
                'save_failed',
                sprintf('Payment settings for clinic %d could not be saved', $clinic_id),
                ['status' => 500]
            );
        }

        return new \WP_REST_Response([
            'clinicId' => $clinic_id,
            'settings' => ClinicPaymentSettings::get($clinic_id),
        ], 200);
    }
}
