<?php

if (!defined('ABSPATH')) {
    exit;
}

class WC_Xendit_PG_API
{
    const DEFAULT_TIME_OUT = 70;

    /** @var string $tpi_gateway_domain */
    protected $tpi_gateway_domain = 'https://tpi-gateway.xendit.co';

    /** @var mixed|string $developmentmode */
    protected $developmentmode = '';

    /** @var mixed|string $secret_api_key */
    protected $secret_api_key;

    /** @var mixed|string $public_api_key */
    protected $public_api_key;

    /** @var mixed|string $for_user_id */
    protected $for_user_id;

    /** @var int $expired_duration */
    protected $expired_duration;

    /** @var mixed|string $expired_unit */
    protected $expired_unit;

    /** @var float|int $expired_time */
    protected $expired_time;

    /** @var array|mixed $oauth_data */
    protected $oauth_data;

    /** @var string $environment */
    protected $environment;

    /**
     * Constructor
     */
    public function __construct()
    {
        $main_settings = get_option('woocommerce_xendit_gateway_settings');
        $this->developmentmode = $main_settings['developmentmode'] ?? '';

        // old API keys are not deleted from DB but are hidden & no longer editable from settings
        $this->secret_api_key   = $this->developmentmode == 'yes'
            ? ($main_settings['secret_key_dev'] ?? '') : ($main_settings['secret_key'] ?? '');
        $this->public_api_key   = $this->developmentmode == 'yes'
            ? ($main_settings['api_key_dev'] ?? '') : ($main_settings['api_key'] ?? '');

        $this->for_user_id      = $main_settings['on_behalf_of'] ?? '';
        $this->expired_duration = isset($main_settings['invoice_expire_duration']) ? (int) $main_settings['invoice_expire_duration'] : 0;
        $this->expired_unit     = $main_settings['invoice_expire_unit'] ?? '';

        // Generating the expired time for the payment.
        $this->expired_time     = $this->for_user_id ? WC_Xendit_Expired::generateExpiredTime($this->expired_duration, $this->expired_unit) : 0;

        // since version 2.27.0
        $oauth_data = WC_Xendit_Oauth::getXenditOAuth();

        if (!empty($oauth_data)) {
            $this->oauth_data = $this->developmentmode == 'yes' ? $oauth_data['oauth_data_development'] : $oauth_data['oauth_data_production'];
        } else {
            $this->oauth_data = [];
        }
        $this->environment = $this->developmentmode == 'yes' ? "DEVELOPMENT" : "PRODUCTION";

        if (empty($this->oauth_data["environment"])) {
            $this->oauth_data["environment"] = $this->environment;
        }
    }

    /**
     * @param $body
     * @param $header
     * @return mixed
     * @throws Exception
     */
    public function createInvoice($body, $header)
    {
        $end_point = $this->tpi_gateway_domain.'/tpi/payment/xendit/invoice';

        if ($this->expired_time > 0) {
            $body["invoice_duration"] = $this->expired_time;
        }

        $payload = json_encode($body);
        $default_header = $this->defaultHeader();

        $args = array(
            'headers' => array_merge($default_header, $header),
            'timeout' => WC_Xendit_PG_API::DEFAULT_TIME_OUT,
            'body' => $payload
        );

        try {
            $response = wp_remote_post($end_point, $args);
            $this->handleNetworkError($response);
            return json_decode($response['body'], true);
        } catch (Exception $e) {
            throw new Exception($e->getMessage());
        }
    }

    /**
     * @param $invoice_id
     * @return mixed
     * @throws Exception
     */
    public function getInvoice($invoice_id)
    {
        $end_point = $this->tpi_gateway_domain.'/tpi/payment/xendit/invoice/'.$invoice_id;

        $args = array(
            'headers' => $this->defaultHeader(),
            'timeout' => WC_Xendit_PG_API::DEFAULT_TIME_OUT
        );

        try {
            $response = wp_remote_get($end_point, $args);
            $this->handleNetworkError($response);
            return json_decode($response['body'], true);
        } catch (Exception $e) {
            throw new Exception($e->getMessage());
        }
    }

    /*******************************************************************************
        Credit Cards
     *******************************************************************************/
    /**
     * Send the request to Xendit's API
     *
     * @param array $payload
     * @return object|Exception
     * @throws Exception
     */
    public function createCharge($payload)
    {
        $end_point = $this->tpi_gateway_domain.'/tpi/payment/xendit/credit-card/charges';

        $args = array(
            'headers' => $this->defaultHeader(),
            'timeout' => WC_Xendit_PG_API::DEFAULT_TIME_OUT,
            'body' => json_encode($payload),
            'user-agent' => 'WooCommerce ' . WC()->version
        );

        try {
            $response = wp_remote_post($end_point, $args);
            $this->handleNetworkError($response);
            return json_decode($response['body'], true);
        } catch (Exception $e) {
            throw new Exception($e->getMessage());
        }
    }

    /**
     * Get CC Setting
     * Note: the return will be arrayed, but if value is boolean (true) json_decode will convert to "1" otherwise if value is boolean (false) json_decode will convert to ""
     *
     * @return array|mixed
     * @throws Exception
     */
    public function getCCSettings()
    {
        $end_point = $this->tpi_gateway_domain.'/tpi/payment/xendit/settings/credit-card';

        $args = array(
          'headers' => $this->defaultHeader(),
          'timeout' => WC_Xendit_PG_API::DEFAULT_TIME_OUT
        );
        $response = wp_remote_get($end_point, $args);

        if (is_wp_error($response) || empty($response['body'])) {
            return array();
        }

        return json_decode($response['body'], true);
    }

    /**
     * @return array|mixed
     * @throws Exception
     */
    public function getMIDSettings()
    {
        $end_point = $this->tpi_gateway_domain.'/tpi/payment/xendit/settings/mid';

        $args = array(
            'headers' => $this->defaultHeader(),
            'timeout' => WC_Xendit_PG_API::DEFAULT_TIME_OUT
        );

        $response = wp_remote_get($end_point, $args);

        if (is_wp_error($response) || empty($response['body'])) {
            return array();
        }

        return json_decode($response['body'], true);
    }


    /**
     * Get invoice settings
     *
     * @return array|mixed
     * @throws Exception
     */
    public function getInvoiceSettings()
    {
        $end_point = $this->tpi_gateway_domain.'/tpi/payment/xendit/settings/invoice';

        $args = array(
            'headers' => $this->defaultHeader(),
            'timeout' => WC_Xendit_PG_API::DEFAULT_TIME_OUT
        );

        $response = wp_remote_get($end_point, $args);

        if (is_wp_error($response) || empty($response['body'])) {
            return array();
        }

        return json_decode($response['body'], true);
    }

    /**
     * Get credit card charge callback data
     *
     * @param string $charge_id
     * @return array
     * @throws Exception
     */
    public function getCharge($charge_id)
    {
        $end_point = $this->tpi_gateway_domain.'/tpi/payment/xendit/credit-card/charges/'.$charge_id;

        $args = array(
            'headers' => $this->defaultHeader(),
            'timeout' => WC_Xendit_PG_API::DEFAULT_TIME_OUT
        );

        try {
            $response = wp_remote_get($end_point, $args);
            $this->handleNetworkError($response);
            return json_decode($response['body'], true);
        } catch (Exception $e) {
            throw new Exception($e->getMessage());
        }
    }

    /**
     * Get credit card token from webhook payload
     *
     * @param string $token
     * @return mixed
     * @throws Exception
     */
    public function getCCToken(string $token)
    {
        $end_point = $this->tpi_gateway_domain.'/tpi/payment/xendit/credit-card/token/'.$token;

        $args = array(
            'headers' => $this->defaultHeader(),
            'timeout' => WC_Xendit_PG_API::DEFAULT_TIME_OUT
        );

        try {
            $response = wp_remote_get($end_point, $args);
            $this->handleNetworkError($response);
            return json_decode($response['body'], true);
        } catch (Exception $e) {
            throw new Exception($e->getMessage());
        }
    }

    /**
     * Get hosted 3DS data
     *
     * @param string $hosted_3ds_id
     * @return object
     * @throws Exception
     */
    public function getHostedThreeDS($hosted_3ds_id)
    {
        $end_point = $this->tpi_gateway_domain.'/tpi/payment/xendit/credit-card/hosted-3ds/' . $hosted_3ds_id;

        $args = array(
            'headers' => $this->defaultHeader(),
            'timeout' => WC_Xendit_PG_API::DEFAULT_TIME_OUT
        );

        try {
            $response = wp_remote_get($end_point, $args);
            $this->handleNetworkError($response);
            return json_decode($response['body'], true);
        } catch (Exception $e) {
            throw new Exception($e->getMessage());
        }
    }

    /**
     * Initiate credit card refund through TPI service
     *
     * @param $payload
     * @param $charge_id
     * @return mixed
     * @throws Exception
     */
    public function createRefund($payload, $charge_id)
    {
        $end_point = $this->tpi_gateway_domain.'/tpi/payment/xendit/credit-card/charges/' . $charge_id . '/refund';

        $args = array(
            'headers' => $this->defaultHeader(),
            'timeout' => WC_Xendit_PG_API::DEFAULT_TIME_OUT,
            'body' => json_encode($payload)
        );
        $response = wp_remote_post($end_point, $args);
        return json_decode($response['body'], true);
    }

    /**
     * Get credit card charges option for promotion & installment
     *
     * @param $token_id
     * @param $amount
     * @param $currency
     * @return mixed
     * @throws Exception
     */
    public function getChargeOption($token_id, $amount, $currency)
    {
        $end_point = $this->tpi_gateway_domain.'/tpi/payment/xendit/credit-card/option?token_id='.$token_id.'&amount='.$amount.'&currency='.$currency;

        $args = array(
            'headers' => $this->defaultHeader(true),
            'timeout' => WC_Xendit_PG_API::DEFAULT_TIME_OUT
        );

        $response = wp_remote_get($end_point, $args);
        if (is_wp_error($response)) {
            return $response;
        }

        return json_decode($response['body'], true);
    }

    /*******************************************************************************
        Tracking & Logging
     *******************************************************************************/

    /**
     * @param $payload
     * @return array|mixed
     * @throws Exception
     */
    public function trackEvent($payload)
    {
        $end_point = $this->tpi_gateway_domain.'/tpi/payment/xendit/tracking';
        $args = array(
            'headers' => $this->defaultHeader(),
            'timeout' => WC_Xendit_PG_API::DEFAULT_TIME_OUT,
            'body' => json_encode($payload)
        );

        $response = wp_remote_post($end_point, $args);

        if (is_wp_error($response) || empty($response['body'])) {
            return array();
        }

        return json_decode($response['body'], true);
    }

    /**
     * Log metrics to Datadog for monitoring
     *
     * @param $body
     * @return bool
     * @throws Exception
     */
    public function trackMetricCount($body)
    {
        $end_point = $this->tpi_gateway_domain.'/tpi/log/metrics/count';

        $args = array(
            'headers' => $this->defaultHeader(),
            'timeout' => WC_Xendit_PG_API::DEFAULT_TIME_OUT,
            'body' => json_encode($body)
        );

        try {
            $response = wp_remote_post($end_point, $args);
            if (is_wp_error($response)) {
                return false;
            }

            $body = json_decode($response['body'], true);
            if (!empty($body['error_code'])) {
                return false;
            }

            return true;
        } catch (Exception $e) {
            return false;
        }
    }

    /**
     * Log metrics to Datadog for monitoring
     *
     * @param $id
     * @return bool
     * @throws Exception
     */
    public function acknowledge($ip)
    {
        $end_point = $this->tpi_gateway_domain.'/tpi/webhook/acknowledge';

        $args = array(
            'headers' => $this->defaultHeader(),
            'timeout' => WC_Xendit_PG_API::DEFAULT_TIME_OUT,
            'body' => json_encode(array('ip' => $ip))
        );

        try {
            $response = wp_remote_post($end_point, $args);
            if (is_wp_error($response)) {
                return false;
            }

            $body = json_decode($response['body'], true);
            if (!empty($body['error_code'])) {
                return false;
            }

            return $body['acknowledge'];
        } catch (Exception $e) {
            return false;
        }
    }

    /**
     * @param string $name
     * @param array $tags
     * @return array
     */
    public function constructMetricPayload(
        string $name,
        array $tags = []
    ): array {
        return array(
            'name'              => $name,
            'additional_tags'   => array_merge(
                array(
                    'version' => WC_XENDIT_PG_VERSION,
                    'is_live' => $this->developmentmode != 'yes'
                ),
                $tags
            )
        );
    }

    /**
     * Post a site info
     *
     * @param array $body
     * @return array
     * @throws Exception
     */
    public function createPluginInfo($body)
    {
        $end_point = $this->tpi_gateway_domain.'/tpi/log/plugin-info';

        $args = array(
            'headers' => $this->defaultHeader(),
            'timeout' => WC_Xendit_PG_API::DEFAULT_TIME_OUT,
            'body' => json_encode([
                'data' => (object) $body
            ])
        );
        try {
            $response = wp_remote_post($end_point, $args);
            $jsonResponse = json_decode($response['body'], true);

            if (isset($jsonResponse['error_code'])) {
                $jsonResponse['message'] = array($jsonResponse['message']);
                throw new Exception(json_encode($jsonResponse));
            }
        } catch (Exception $e) {
            throw new Exception($e->getMessage());
        }

        return $jsonResponse;
    }

    /*******************************************************************************
     * Xendit OAuth
     *******************************************************************************
     * @throws Exception
     */
    public function getAccessToken($body)
    {
        $end_point = $this->tpi_gateway_domain.'/tpi/authorization/xendit/token';

        $args = array(
          'headers' => array('content-type' => 'application/json'),
          'timeout' => WC_Xendit_PG_API::DEFAULT_TIME_OUT,
          'body' => json_encode($body)
        );

        try {
            $response = wp_remote_post($end_point, $args);
            $this->handleNetworkError($response);
            return json_decode($response['body'], true);
        } catch (Exception $e) {
            throw new Exception($e->getMessage());
        }
    }

    /**
     * @return mixed
     * @throws Exception
     */
    public function uninstallApp()
    {
        $app_id = '61e12bf5bfd5ff82ab9d6d15';
        if ($this->tpi_gateway_domain !== 'https://tpi-gateway.xendit.co') {
            $app_id = '61e128c1aa83ae905b6ab45a';
        }

        $end_point = $this->tpi_gateway_domain.'/tpi/marketplace/integrations/'.$app_id.'/uninstall';

        $args = array(
            'headers' => $this->defaultHeader(),
            'method' => 'DELETE',
            'timeout' => WC_Xendit_PG_API::DEFAULT_TIME_OUT
        );

        try {
            $response = wp_remote_request($end_point, $args);
            $this->handleNetworkError($response);
            return json_decode($response['body'], true);
        } catch (Exception $e) {
            throw new Exception($e->getMessage());
        }
    }

    /*******************************************************************************
        General
     *******************************************************************************/
    /**
     * Default Header
     *
     * @param $usePublicKey
     * @param $version
     * @return array
     * @throws Exception
     */
    public function defaultHeader($usePublicKey = false, $version = '')
    {
        $default_header = array(
            'content-type' => 'application/json',
            'x-plugin-name' => 'WOOCOMMERCE',
            'x-plugin-version' => WC_XENDIT_PG_VERSION
        );

        if ($usePublicKey) { // prioritize use of public key than oauth data for CC requests
            $default_header['Authorization'] = 'Basic '.base64_encode($this->public_api_key.':');
        } else {
            if (!empty($this->oauth_data['refresh_token'])) {
                $oauthBody = array(
                    "oauth_data" => $this->oauth_data,
                    "platform" => "WOOCOMMERCE"
                );
                $oauth = $this->getAccessToken($oauthBody);

                $default_header['authorization-type'] = "OAuth";
                $default_header['Authorization'] = 'Bearer '.$oauth["access_token"];
            } else {
                $default_header['authorization-type'] = "ApiKey";
                $default_header['Authorization'] = 'Basic '.base64_encode($this->secret_api_key.':');
            }
        }

        if (!empty($version)) {
            $default_header['x-api-version'] = $version;
        }

        if ($this->for_user_id) {
            $default_header['for-user-id'] = $this->for_user_id;
        }
        return $default_header;
    }

    /**
     * @param $response
     * @return void
     * @throws Exception
     */
    public function handleNetworkError($response)
    {
        if (is_wp_error($response) || empty($response['body'])) {
            throw new Exception('We encountered an issue while processing the checkout. Please contact us. Code: 100007');
        }
    }

    /**
     * @return bool
     */
    public function isCredentialExist(): bool
    {
        return (!empty($this->secret_api_key) || !empty($this->oauth_data['refresh_token']));
    }

    /**
     * @param $invoice_id
     * @return array|mixed
     * @throws Exception
     */
    public function expiredInvoice($invoice_id)
    {
        $end_point = $this->tpi_gateway_domain.'/tpi/payment/xendit/invoice/'.$invoice_id.'/expire';
        $args = array(
            'headers' => $this->defaultHeader(),
            'timeout' => WC_Xendit_PG_API::DEFAULT_TIME_OUT,
            'body' => json_encode(array('platform' => 'WOOCOMMERCE'))
        );

        $response = wp_remote_post($end_point, $args);
        if (is_wp_error($response) || empty($response['body'])) {
            return array();
        }

        return json_decode($response['body'], true);
    }

    /**
     * @param $sub_account_id
     * @return array|mixed
     * @throws Exception
     */
    public function getSubAccount($sub_account_id)
    {
        $end_point = $this->tpi_gateway_domain.'/tpi/business/sub_account/'.$sub_account_id;
        $args = array(
            'headers' => $this->defaultHeader(),
            'timeout' => WC_Xendit_PG_API::DEFAULT_TIME_OUT
        );

        $response = wp_remote_get($end_point, $args);
        if (is_wp_error($response) || empty($response['body'])) {
            return array();
        }

        return json_decode($response['body'], true);
    }

    /**
     * @return array|mixed
     * @throws Exception
     */
    public function getMerchant()
    {
        $end_point = $this->tpi_gateway_domain.'/tpi/business';
        $args = array(
            'headers' => $this->defaultHeader(),
            'timeout' => WC_Xendit_PG_API::DEFAULT_TIME_OUT
        );

        $response = wp_remote_get($end_point, $args);
        if (is_wp_error($response) || empty($response['body'])) {
            return array();
        }

        return json_decode($response['body'], true);
    }
}
