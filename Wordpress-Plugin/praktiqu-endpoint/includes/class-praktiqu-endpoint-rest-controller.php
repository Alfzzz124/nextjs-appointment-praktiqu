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

    public function __construct(Service $service, Jobs $jobs, Payments $payments, Media $media)
    {
        $this->service = $service;
        $this->jobs = $jobs;
        $this->payments = $payments;
        $this->media = $media;
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

        // POST /praktiqu/v1/jobs — enqueue a background job (C8 architecture)
        register_rest_route($ns, '/jobs', [
            'methods'             => \WP_REST_Server::CREATABLE,
            'callback'            => [$this, 'handle_enqueue_job'],
            'permission_callback' => [Plugin::class, 'verify_service_token'],
            'args'                => [
                'hook'  => ['required' => true, 'type' => 'string'],
                'runAt' => ['required' => true, 'type' => 'integer'],
                'args'  => ['required' => false, 'type' => 'array', 'default' => []],
            ],
        ]);

        // DELETE /praktiqu/v1/jobs — cancel a previously-enqueued job
        register_rest_route($ns, '/jobs', [
            'methods'             => \WP_REST_Server::DELETABLE,
            'callback'            => [$this, 'handle_cancel_job'],
            'permission_callback' => [Plugin::class, 'verify_service_token'],
            'args'                => [
                'hook'  => ['required' => true, 'type' => 'string'],
                'args'  => ['required' => false, 'type' => 'array', 'default' => []],
            ],
        ]);

        // POST /praktiqu/v1/payments/order — create a WC order (2026-07-14 payment feature)
        register_rest_route($ns, '/payments/order', [
            'methods'             => \WP_REST_Server::CREATABLE,
            'callback'            => [$this, 'handle_create_payment_order'],
            'permission_callback' => [Plugin::class, 'verify_service_token'],
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
}
